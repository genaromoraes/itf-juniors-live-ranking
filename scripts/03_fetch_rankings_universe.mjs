import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";

const DEFAULT_UNIVERSE_MAX_PER_GENDER = 5000;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10000;
const BLOCK_DELAY_MS = 15000;
const IS_CI = process.env.CI === "true";

const OUT_DIR_RAW = path.resolve("data/raw/rankings_universe");
const OUT_DIR_CLEAN = path.resolve("data/clean");
const OUTPUT_FILE = path.join(OUT_DIR_CLEAN, "rankings_universe.csv");
const CHECKPOINT_FILE = path.join(OUT_DIR_RAW, "checkpoint.json");
const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

const GENDERS = [
  { label: "boys", gender: "M", itfCode: "B" },
  { label: "girls", gender: "F", itfCode: "G" },
];

const COLUMNS = [
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

function getLimitPerGender() {
  const cliValue = toNumber(getArg("limit-per-gender"));
  const envValue = toNumber(process.env.UNIVERSE_MAX_PER_GENDER);
  return cliValue || envValue || DEFAULT_UNIVERSE_MAX_PER_GENDER;
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

function normalizePlayer(row, genderInfo, sourceUrl) {
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
    ranking_date: new Date().toISOString().slice(0, 10),
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
  error.isBlocked = looksBlockedOrHtml(lastResult);
  throw error;
}

async function writeCheckpoint(value) {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.writeFile(CHECKPOINT_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function collectGender(page, genderInfo, maxPerGender) {
  const rows = [];
  const seenIds = new Set();

  for (let skip = 0; skip < maxPerGender; skip += PAGE_SIZE) {
    const take = Math.min(PAGE_SIZE, maxPerGender - skip);
    const pageResult = await fetchRankingPage(page, genderInfo, take, skip);
    const normalized = pageResult.rows
      .map((row) => normalizePlayer(row, genderInfo, pageResult.url))
      .filter((row) => row.player_id || row.player_name);
    const newRows = normalized.filter((row) => {
      if (!row.player_id) return true;
      if (seenIds.has(row.player_id)) return false;
      seenIds.add(row.player_id);
      return true;
    });

    rows.push(...newRows);
    await writeCheckpoint({
      gender: genderInfo.gender,
      skip,
      rows_collected: rows.length,
      updated_at: new Date().toISOString(),
    });

    if (normalized.length === 0 || normalized.length < take || newRows.length === 0) {
      break;
    }

    await page.waitForTimeout(300);
  }

  return rows
    .sort((a, b) => toNumber(a.rank) - toNumber(b.rank))
    .slice(0, maxPerGender);
}

function validateUniverse(rows) {
  const errors = [];
  const ids = rows.map((row) => cleanText(row.player_id)).filter(Boolean);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  if (rows.length === 0) errors.push("rankings_universe.csv ficaria vazio.");
  if (duplicates.length > 0) {
    errors.push(`IDs duplicados no universo: ${[...new Set(duplicates)].slice(0, 10).join(", ")}.`);
  }

  return errors;
}

async function main() {
  const maxPerGender = getLimitPerGender();
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });

  console.log(`Coletando universo leve: max ${maxPerGender} por genero.`);

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

    const rows = [];
    for (const genderInfo of GENDERS) {
      rows.push(...(await collectGender(page, genderInfo, maxPerGender)));
    }

    const errors = validateUniverse(rows);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    const tmpFile = `${OUTPUT_FILE}.tmp`;
    await fs.writeFile(
      tmpFile,
      stringify(rows, { header: true, columns: COLUMNS }),
      "utf8"
    );
    await fs.rename(tmpFile, OUTPUT_FILE);

    console.log(`Universo gerado: ${rows.length} jogadores.`);
    console.log(`Arquivo: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err?.message || err);
  process.exit(1);
});

