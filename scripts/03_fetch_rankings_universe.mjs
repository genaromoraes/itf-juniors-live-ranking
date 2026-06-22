import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const DEFAULT_UNIVERSE_MAX_PER_GENDER = 5000;
const DEFAULT_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10000;
const BLOCK_DELAY_MS = 15000;
const IS_CI = process.env.CI === "true";

const OUT_DIR_RAW = path.resolve("data/raw/rankings_universe");
const OUT_DIR_CLEAN = path.resolve("data/clean");
const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

const STATUS_NOT_STARTED = "NOT_STARTED";
const STATUS_COLLECTING = "COLLECTING";
const STATUS_PARTIAL = "PARTIAL";
const STATUS_BLOCKED = "BLOCKED";
const STATUS_COMPLETE = "COMPLETE";
const STATUS_INVALID = "INVALID";

const GENDERS = [
  { label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" },
  { label: "girls", gender: "F", itfCode: "G", manifestKey: "girls" },
];

export const COLUMNS = [
  "ranking_date",
  "gender",
  "rank",
  "player_id",
  "player_name",
  "country",
  "country_name",
  "birth_year",
  "official_points",
  "profile_url",
  "source_url",
  "collected_at",
];

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getLimitPerGender() {
  const cliValue = toNumber(getArg("limit-per-gender"));
  const envValue = toNumber(process.env.UNIVERSE_MAX_PER_GENDER);
  return cliValue || envValue || DEFAULT_UNIVERSE_MAX_PER_GENDER;
}

function getOutputFile() {
  const outputFile = getArg("output-file");
  return outputFile
    ? path.resolve(outputFile)
    : path.join(OUT_DIR_CLEAN, "rankings_universe.csv");
}

function getPageSize() {
  return toNumber(getArg("page-size")) || DEFAULT_PAGE_SIZE;
}

function getSelectedGenders() {
  const gender = cleanText(getArg("gender")).toUpperCase();
  if (!gender) return GENDERS;
  return GENDERS.filter((item) => item.gender === gender);
}

function getCollectionWindow(maxPerGender) {
  const startRank = toNumber(getArg("start-rank", "1")) || 1;
  const endRank = toNumber(getArg("end-rank", String(maxPerGender))) || maxPerGender;
  if (startRank < 1 || endRank < startRank) {
    throw new Error(`Faixa invalida: start-rank=${startRank} end-rank=${endRank}`);
  }
  return { startRank, endRank };
}

function getDelayMs() {
  return toNumber(getArg("delay-ms")) || toNumber(process.env.UNIVERSE_DELAY_MS) || 3000;
}

function getMaxPagesPerRun() {
  return toNumber(getArg("max-pages-per-run"));
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return null;
}

function findArraysDeep(value, arrays = []) {
  if (!value) return arrays;
  if (Array.isArray(value)) {
    arrays.push(value);
    for (const item of value) findArraysDeep(item, arrays);
    return arrays;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) findArraysDeep(child, arrays);
  }
  return arrays;
}

function looksLikeRankingRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const keys = Object.keys(row).map((key) => key.toLowerCase());
  const hasRank = ["rank", "ranking", "rankposition", "position"].some((key) =>
    keys.includes(key)
  );
  const hasPoints = ["points", "rankingpoints", "totalpoints"].some((key) =>
    keys.includes(key)
  );
  const hasPlayer = [
    "playerid",
    "id",
    "playername",
    "fullname",
    "name",
    "givenname",
    "familyname",
    "playergivenname",
    "playerfamilyname",
  ].some((key) => keys.includes(key));
  return hasRank && hasPoints && hasPlayer;
}

function extractRankingRows(json) {
  const candidates = findArraysDeep(json)
    .map((arr) => ({ arr, score: arr.filter(looksLikeRankingRow).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.arr.filter(looksLikeRankingRow) || [];
}

function normalizeProfileUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;
  return raw;
}

function resolveRankingDate(json, fallback) {
  const direct = getFirst(json, [
    "rankingDate",
    "rankDate",
    "publishedDate",
    "date",
    "RankingDate",
  ]);
  const text = cleanText(direct);
  if (text.match(/^\d{4}-\d{2}-\d{2}/)) return text.slice(0, 10);
  return fallback || new Date().toISOString().slice(0, 10);
}

function normalizePlayer(row, genderInfo, sourceUrl, rankingDate) {
  const firstName = getFirst(row, [
    "firstName",
    "FirstName",
    "givenName",
    "GivenName",
    "playerGivenName",
    "PlayerGivenName",
  ]);
  const lastName = getFirst(row, [
    "lastName",
    "LastName",
    "familyName",
    "FamilyName",
    "playerFamilyName",
    "PlayerFamilyName",
  ]);
  const fullName =
    getFirst(row, [
      "fullName",
      "FullName",
      "playerName",
      "PlayerName",
      "name",
      "Name",
      "displayName",
      "DisplayName",
    ]) || [firstName, lastName].filter(Boolean).join(" ");
  const birthDate = getFirst(row, ["birthDate", "BirthDate", "dateOfBirth"]);
  const birthYearRaw = getFirst(row, ["birthYear", "BirthYear", "yearOfBirth"]);
  const birthYearFromDate = cleanText(birthDate).match(/\b(19|20)\d{2}\b/)?.[0];

  return {
    ranking_date: rankingDate,
    gender: genderInfo.gender,
    rank: toNumber(getFirst(row, ["rank", "Rank", "ranking", "Ranking", "position"])),
    player_id: cleanText(
      getFirst(row, ["playerId", "PlayerId", "playerID", "id", "Id"])
    ),
    player_name: cleanText(fullName),
    country: cleanText(
      getFirst(row, [
        "nationCode",
        "NationCode",
        "nationality",
        "playerNationalityCode",
        "countryCode",
        "country",
      ])
    ),
    country_name: cleanText(
      getFirst(row, [
        "playerNationality",
        "nationalityName",
        "countryName",
        "CountryName",
      ])
    ),
    birth_year: toNumber(birthYearRaw) || birthYearFromDate || "",
    official_points: toNumber(
      getFirst(row, ["points", "Points", "rankingPoints", "totalPoints"])
    ),
    profile_url: normalizeProfileUrl(
      getFirst(row, ["profileLink", "profileUrl", "playerUrl", "url", "href"])
    ),
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
  };
}

function buildRankingUrl(genderInfo, take, skip) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    playerTypeCode: genderInfo.itfCode,
    ageCategoryCode: "",
    juniorRankingType: "itf",
    take: String(take),
    skip: String(skip),
    isOrderAscending: "true",
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetPlayerRankings?${params.toString()}`;
}

function looksBlockedOrHtml(result) {
  const contentType = String(result?.contentType || "").toLowerCase();
  const textStart = String(result?.textStart || "").toLowerCase();
  return (
    contentType.includes("text/html") ||
    textStart.includes("_incapsula_resource") ||
    textStart.includes("incapsula") ||
    textStart.includes("imperva") ||
    textStart.includes("<html")
  );
}

export function shouldTreatFetchFailureAsBlocked(result) {
  const status = Number(result?.status || 0);

  if (looksBlockedOrHtml(result)) return true;
  if (result?.timedOut) return true;
  if (status === 0) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500) return true;

  return false;
}

async function fetchJsonInsideBrowser(page, url) {
  return await page.evaluate(
    async ({ url, timeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
          headers: { accept: "application/json, text/plain, */*" },
        });
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        let json = null;

        try {
          json = JSON.parse(text);
        } catch {
          return {
            ok: response.ok,
            status: response.status,
            contentType,
            textStart: text.slice(0, 500),
            json: null,
            timedOut: false,
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          contentType,
          textStart: "",
          json,
          timedOut: false,
        };
      } catch (err) {
        const timedOut = err?.name === "AbortError";
        return {
          ok: false,
          status: 0,
          contentType: "",
          textStart: timedOut
            ? `Request timeout after ${timeoutMs}ms`
            : String(err?.message || err),
          json: null,
          timedOut,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { url, timeoutMs: REQUEST_TIMEOUT_MS }
  );
}

async function fetchRankingPage(page, genderInfo, take, skip) {
  const url = buildRankingUrl(genderInfo, take, skip);
  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    lastResult = await fetchJsonInsideBrowser(page, url);

    if (lastResult.ok && lastResult.json) {
      return {
        url,
        json: lastResult.json,
        rows: extractRankingRows(lastResult.json),
      };
    }

    if (attempt < MAX_RETRIES) {
      await page.waitForTimeout(
        looksBlockedOrHtml(lastResult) ? BLOCK_DELAY_MS : RETRY_DELAY_MS
      );
    }
  }

  const error = new Error(
    `Falha buscando universo ${genderInfo.label} skip=${skip}. HTTP ${lastResult?.status}. Content-Type: ${lastResult?.contentType}. ${lastResult?.textStart}`
  );
  error.isBlocked = shouldTreatFetchFailureAsBlocked(lastResult);
  error.result = lastResult;
  throw error;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, filePath);
}

async function writeCsvAtomic(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(
    tmpFile,
    stringify(rows, { header: true, columns: COLUMNS }),
    "utf8"
  );
  await fs.rename(tmpFile, filePath);
}

async function readCsv(filePath) {
  if (!(await exists(filePath))) return [];
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
}

function pageFile(rawDir, gender, skip) {
  return path.join(rawDir, "pages", `${gender}_skip_${String(skip).padStart(4, "0")}.json`);
}

function partialFile(rawDir, gender) {
  return path.join(rawDir, `partial_${gender}.csv`);
}

function manifestFile(rawDir) {
  return path.join(rawDir, "collection_manifest.json");
}

function oldCheckpointFile(rawDir) {
  return path.join(rawDir, "checkpoint.json");
}

function archiveDir(rawDir, timestamp) {
  return path.join(rawDir, "archive", timestamp);
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function archivePreviousCollection(rawDir, reason) {
  const names = [
    "collection_manifest.json",
    "checkpoint.json",
    "partial_M.csv",
    "partial_F.csv",
    "pages",
  ];
  const present = [];
  for (const name of names) {
    if (await exists(path.join(rawDir, name))) present.push(name);
  }
  if (present.length === 0) return null;
  const target = archiveDir(rawDir, `${timestampForPath()}_${reason}`);
  await fs.mkdir(target, { recursive: true });
  for (const name of present) {
    await fs.rename(path.join(rawDir, name), path.join(target, name));
  }
  return target;
}

function buildInitialManifest({
  targetPerGender,
  pageSize,
  startRank,
  endRank,
  rankingDate,
}) {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    collection_id: `ranking_universe_${now}`,
    ranking_date: rankingDate,
    expected_ranking_date: rankingDate,
    target_per_gender: targetPerGender,
    start_rank: startRank,
    end_rank: endRank,
    page_size: pageSize,
    status: STATUS_NOT_STARTED,
    started_at: now,
    updated_at: now,
    blocked_at: "",
    blocked_gender: "",
    blocked_skip: "",
    last_error: "",
    boys: { rows_collected: 0, completed_pages: [], next_skip: startRank - 1, complete: false },
    girls: { rows_collected: 0, completed_pages: [], next_skip: startRank - 1, complete: false },
  };
}

function manifestCompatible(manifest, options) {
  if (!manifest) return false;
  return (
    Number(manifest.schema_version) === 1 &&
    Number(manifest.target_per_gender) === Number(options.targetPerGender) &&
    Number(manifest.page_size) === Number(options.pageSize) &&
    Number(manifest.start_rank) === Number(options.startRank) &&
    Number(manifest.end_rank) === Number(options.endRank) &&
    cleanText(manifest.expected_ranking_date || manifest.ranking_date) ===
      cleanText(options.rankingDate)
  );
}

function genderManifestKey(genderInfo) {
  return genderInfo.manifestKey;
}

function getSkips({ startRank, endRank, pageSize }) {
  const firstSkip = startRank - 1;
  const skips = [];
  for (let skip = firstSkip; skip <= endRank - 1; skip += pageSize) {
    skips.push(skip);
  }
  return skips;
}

function pageTake(skip, endRank, pageSize) {
  return Math.min(pageSize, endRank - skip);
}

async function rebuildPartialFromPages({ rawDir, genderInfo, rankingDate, endRank }) {
  const pagesDir = path.join(rawDir, "pages");
  if (!(await exists(pagesDir))) return [];
  const files = (await fs.readdir(pagesDir))
    .filter((name) => name.startsWith(`${genderInfo.gender}_skip_`) && name.endsWith(".json"))
    .sort();
  const rows = [];
  const seen = new Set();
  for (const file of files) {
    const payload = await readJson(path.join(pagesDir, file));
    const pageRows = (payload?.normalized_rows || []).filter(
      (row) => toNumber(row.rank) <= endRank
    );
    for (const row of pageRows) {
      const key = cleanText(row.player_id) || `${row.gender}-${row.rank}-${row.player_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...row, ranking_date: cleanText(row.ranking_date) || rankingDate });
    }
  }
  rows.sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  await writeCsvAtomic(partialFile(rawDir, genderInfo.gender), rows);
  return rows;
}

async function writeOutputIfComplete({ rawDir, outputFile, manifest }) {
  if (!manifest.boys.complete || !manifest.girls.complete) return false;
  const rows = [
    ...(await readCsv(partialFile(rawDir, "M"))),
    ...(await readCsv(partialFile(rawDir, "F"))),
  ];
  const ids = rows.map((row) => cleanText(row.player_id)).filter(Boolean);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (rows.length === 0 || duplicates.length > 0) {
    manifest.status = STATUS_INVALID;
    manifest.last_error = duplicates.length
      ? `IDs duplicados: ${[...new Set(duplicates)].slice(0, 10).join(", ")}`
      : "Universo vazio.";
    return false;
  }
  await writeCsvAtomic(outputFile, rows);
  manifest.status = STATUS_COMPLETE;
  return true;
}

async function initializeCollection(options) {
  await fs.mkdir(options.rawDir, { recursive: true });
  if (options.restart) {
    await archivePreviousCollection(options.rawDir, "restart");
  } else {
    const manifest = await readJson(manifestFile(options.rawDir), null);
    if (manifest && !manifestCompatible(manifest, options)) {
      manifest.status = STATUS_INVALID;
      manifest.last_error = "Manifesto incompativel com os parametros/ranking_date atuais. Use --restart.";
      await writeJsonAtomic(manifestFile(options.rawDir), manifest);
      return manifest;
    }
    const checkpoint = oldCheckpointFile(options.rawDir);
    const pagesDir = path.join(options.rawDir, "pages");
    if (!manifest && (await exists(checkpoint)) && !(await exists(pagesDir))) {
      await archivePreviousCollection(options.rawDir, "legacy_checkpoint_without_pages");
    }
    if (manifest) return manifest;
  }

  const manifest = buildInitialManifest(options);
  await writeJsonAtomic(manifestFile(options.rawDir), manifest);
  return manifest;
}

async function persistPage({ rawDir, genderInfo, skip, url, json, normalizedRows }) {
  const filePath = pageFile(rawDir, genderInfo.gender, skip);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(
    tmpFile,
    `${JSON.stringify(
      {
        gender: genderInfo.gender,
        skip,
        url,
        saved_at: new Date().toISOString(),
        raw_json: json,
        normalized_rows: normalizedRows,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.rename(tmpFile, filePath);
}

function completePagesFor(manifest, genderInfo) {
  return new Set(manifest[genderManifestKey(genderInfo)].completed_pages.map(Number));
}

function firstMissingSkip(manifest, genderInfo, options) {
  const completed = completePagesFor(manifest, genderInfo);
  return getSkips(options).find((skip) => !completed.has(skip));
}

async function updateGenderProgress({ rawDir, manifest, genderInfo, options }) {
  const rows = await rebuildPartialFromPages({
    rawDir,
    genderInfo,
    rankingDate: options.rankingDate,
    endRank: options.endRank,
  });
  const key = genderManifestKey(genderInfo);
  const next = firstMissingSkip(manifest, genderInfo, options);
  manifest[key].rows_collected = rows.length;
  manifest[key].next_skip = next ?? options.endRank;
  manifest[key].complete = next === undefined;
  manifest.updated_at = new Date().toISOString();
}

export async function collectRankingUniverseIncremental({
  rawDir = OUT_DIR_RAW,
  outputFile = path.join(OUT_DIR_CLEAN, "rankings_universe.csv"),
  targetPerGender = DEFAULT_UNIVERSE_MAX_PER_GENDER,
  pageSize = DEFAULT_PAGE_SIZE,
  startRank = 1,
  endRank = targetPerGender,
  genders = GENDERS,
  rankingDate = new Date().toISOString().slice(0, 10),
  restart = false,
  maxPagesPerRun = 0,
  delayMs = 3000,
  fetchPage,
  wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const options = { rawDir, outputFile, targetPerGender, pageSize, startRank, endRank, rankingDate, restart };
  const manifest = await initializeCollection(options);
  if (manifest.status === STATUS_INVALID) {
    return { status: STATUS_INVALID, manifest, pagesFetched: 0 };
  }

  let pagesFetched = 0;
  manifest.status = STATUS_COLLECTING;
  manifest.last_error = "";
  await writeJsonAtomic(manifestFile(rawDir), manifest);

  for (const genderInfo of genders) {
    await updateGenderProgress({ rawDir, manifest, genderInfo, options });
    while (!manifest[genderManifestKey(genderInfo)].complete) {
      if (maxPagesPerRun > 0 && pagesFetched >= maxPagesPerRun) {
        manifest.status = STATUS_PARTIAL;
        await writeJsonAtomic(manifestFile(rawDir), manifest);
        return { status: STATUS_PARTIAL, manifest, pagesFetched };
      }

      const skip = firstMissingSkip(manifest, genderInfo, options);
      const take = pageTake(skip, endRank, pageSize);
      let pageResult;
      try {
        pageResult = await fetchPage(genderInfo, take, skip);
      } catch (err) {
        manifest.status = err.isBlocked ? STATUS_BLOCKED : STATUS_INVALID;
        manifest.blocked_at = err.isBlocked ? new Date().toISOString() : "";
        manifest.blocked_gender = err.isBlocked ? genderInfo.gender : "";
        manifest.blocked_skip = err.isBlocked ? String(skip) : "";
        manifest.last_error = err.message;
        manifest.updated_at = new Date().toISOString();
        await writeJsonAtomic(manifestFile(rawDir), manifest);
        return { status: manifest.status, manifest, pagesFetched, error: err };
      }
      const pageRankingDate = resolveRankingDate(pageResult.json, rankingDate);
      if (cleanText(pageRankingDate) !== cleanText(rankingDate)) {
        manifest.status = STATUS_INVALID;
        manifest.last_error = `ranking_date incompativel: esperado ${rankingDate}, recebido ${pageRankingDate}`;
        await writeJsonAtomic(manifestFile(rawDir), manifest);
        return { status: STATUS_INVALID, manifest, pagesFetched };
      }
      const normalizedRows = pageResult.rows
        .map((row) => normalizePlayer(row, genderInfo, pageResult.url, rankingDate))
        .filter((row) => row.player_id || row.player_name)
        .filter((row) => toNumber(row.rank) >= startRank && toNumber(row.rank) <= endRank);

      await persistPage({
        rawDir,
        genderInfo,
        skip,
        url: pageResult.url,
        json: pageResult.json,
        normalizedRows,
      });
      const key = genderManifestKey(genderInfo);
      manifest[key].completed_pages = [...completePagesFor(manifest, genderInfo), skip].sort((a, b) => a - b);
      await updateGenderProgress({ rawDir, manifest, genderInfo, options });
      pagesFetched += 1;
      await writeJsonAtomic(manifestFile(rawDir), manifest);
      if (delayMs > 0) await wait(delayMs);
    }
  }

  await writeOutputIfComplete({ rawDir, outputFile, manifest });
  if (manifest.status !== STATUS_COMPLETE) manifest.status = STATUS_PARTIAL;
  await writeJsonAtomic(manifestFile(rawDir), manifest);
  return { status: manifest.status, manifest, pagesFetched };
}

async function main() {
  const maxPerGender = getLimitPerGender();
  const outputFile = getOutputFile();
  const pageSize = getPageSize();
  const { startRank, endRank } = getCollectionWindow(maxPerGender);
  const targetPerGender = endRank - startRank + 1;
  const genders = getSelectedGenders();
  const delayMs = getDelayMs();
  const maxPagesPerRun = getMaxPagesPerRun();
  const rankingDate = cleanText(getArg("ranking-date")) || new Date().toISOString().slice(0, 10);

  console.log(
    `Coletando universo incremental: ranks ${startRank}-${endRank}, page-size ${pageSize}.`
  );

  const browser = await chromium.launch({ headless: IS_CI ? true : false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();

  try {
    await page.goto(RANKING_PAGE, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(3000);

    const result = await collectRankingUniverseIncremental({
      rawDir: OUT_DIR_RAW,
      outputFile,
      targetPerGender,
      pageSize,
      startRank,
      endRank,
      genders,
      rankingDate,
      restart: hasFlag("restart"),
      maxPagesPerRun,
      delayMs,
      wait: (ms) => page.waitForTimeout(ms),
      fetchPage: (genderInfo, take, skip) => fetchRankingPage(page, genderInfo, take, skip),
    });

    console.log(`Status da coleta: ${result.status}`);
    console.log(`Paginas novas nesta execucao: ${result.pagesFetched}`);
    console.log(`Masculino: ${result.manifest.boys.rows_collected}/${targetPerGender}`);
    console.log(`Feminino: ${result.manifest.girls.rows_collected}/${targetPerGender}`);
    console.log(`Proxima pagina M: ${result.manifest.boys.next_skip}`);
    console.log(`Proxima pagina F: ${result.manifest.girls.next_skip}`);
    if (result.status === STATUS_BLOCKED) {
      console.log("Bloqueio detectado. Retome depois com:");
      console.log("npm.cmd run base:top1000:prepare -- --resume --max-pages-per-run=1");
    }
    if (result.error && !result.error.isBlocked) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err?.message || err);
    process.exit(1);
  });
}
