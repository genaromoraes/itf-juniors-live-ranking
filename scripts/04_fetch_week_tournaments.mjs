import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";
import { pathToFileURL } from "url";

const DEFAULT_OUT_DIR_RAW = path.resolve("data/raw");
const DEFAULT_OUT_DIR_CLEAN = path.resolve("data/clean");
const IS_CI = process.env.CI === "true";

const TODAY = new Date().toISOString().slice(0, 10);

const CALENDAR_PAGE =
  "https://www.itftennis.com/en/tournament-calendar/world-tennis-tour-juniors-calendar/";

const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = Number(process.env.ITF_RESULTS_RETRY_DELAY_MS) || 10000;
const BLOCK_DELAY_MS = Number(process.env.ITF_RESULTS_BLOCK_DELAY_MS) || 15000;
const MAX_RETRIES = Number(process.env.ITF_RESULTS_MAX_RETRIES) || 2;
const ITF_HOME_URL = "https://www.itftennis.com/en/";

const TOURNAMENT_COLUMNS = [
  "week_start",
  "week_end",
  "search_start",
  "search_end",
  "tournament_id",
  "tournament_key",
  "tournament_name",
  "promotional_name",
  "category",
  "host_nation",
  "host_nation_code",
  "location",
  "venue",
  "start_date",
  "end_date",
  "dates_raw",
  "surface",
  "surface_code",
  "indoor_outdoor",
  "tournament_link",
  "live_link",
  "source_url",
  "collected_at",
  "raw_json",
];

function getArg(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function parseIsoDateUtc(value, label) {
  const text = cleanText(value);

  if (!isIsoDate(text)) {
    throw new Error(`${label} invalida. Use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} invalida. Use YYYY-MM-DD.`);
  }

  return parsed;
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function getMondayUtc(date) {
  const current = new Date(date.getTime());
  current.setUTCHours(0, 0, 0, 0);

  const day = current.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setUTCDate(current.getUTCDate() + diff);

  return current;
}

export function parseArgs(argv = process.argv.slice(2)) {
  return {
    weekStart: cleanText(getArg("week-start", argv)),
    weekEnd: cleanText(getArg("week-end", argv)),
    outputDir: cleanText(getArg("output-dir", argv)),
    searchStart: cleanText(getArg("search-start", argv)),
    searchEnd: cleanText(getArg("search-end", argv)),
    manualFile: cleanText(getArg("manual-file", argv)),
  };
}

export function buildWeekWindow(args = parseArgs(), now = new Date()) {
  const hasWeekStart = Boolean(args.weekStart);
  const hasWeekEnd = Boolean(args.weekEnd);

  if (hasWeekStart !== hasWeekEnd) {
    throw new Error(
      "Informe --week-start=YYYY-MM-DD e --week-end=YYYY-MM-DD juntos."
    );
  }

  if (!hasWeekStart) {
    const monday = getMondayUtc(now);
    const sunday = addUtcDays(monday, 6);

    return {
      week_start: toIsoDateUtc(monday),
      week_end: toIsoDateUtc(sunday),
      search_start: toIsoDateUtc(addUtcDays(monday, -2)),
      search_end: toIsoDateUtc(sunday),
    };
  }

  const weekStartDate = parseIsoDateUtc(args.weekStart, "week-start");
  const weekEndDate = parseIsoDateUtc(args.weekEnd, "week-end");

  if (weekStartDate.getTime() > weekEndDate.getTime()) {
    throw new Error("week-start nao pode ser posterior a week-end.");
  }

  const searchStartDate = args.searchStart
    ? parseIsoDateUtc(args.searchStart, "search-start")
    : addUtcDays(weekStartDate, -2);
  const searchEndDate = args.searchEnd
    ? parseIsoDateUtc(args.searchEnd, "search-end")
    : weekEndDate;

  if (searchStartDate.getTime() > searchEndDate.getTime()) {
    throw new Error("search-start nao pode ser posterior a search-end.");
  }

  return {
    week_start: toIsoDateUtc(weekStartDate),
    week_end: toIsoDateUtc(weekEndDate),
    search_start: toIsoDateUtc(searchStartDate),
    search_end: toIsoDateUtc(searchEndDate),
  };
}

export function resolveOutputPaths(args = parseArgs()) {
  if (!args.outputDir) {
    return {
      rawDir: DEFAULT_OUT_DIR_RAW,
      cleanDir: DEFAULT_OUT_DIR_CLEAN,
      rawOutputFile: path.join(DEFAULT_OUT_DIR_RAW, `week_tournaments_${TODAY}.json`),
      cleanOutputFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_tournaments.csv"),
      debugAllFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_tournaments_debug_all.csv"),
      outputLabel: "default",
    };
  }

  const outputDir = path.resolve(args.outputDir);

  return {
    rawDir: path.join(outputDir, "raw"),
    cleanDir: outputDir,
    rawOutputFile: path.join(outputDir, "raw", "week_tournaments.json"),
    cleanOutputFile: path.join(outputDir, "week_tournaments.csv"),
    debugAllFile: path.join(outputDir, "week_tournaments_debug_all.csv"),
    outputLabel: outputDir,
  };
}

async function ensureDirs(paths) {
  await fs.mkdir(paths.rawDir, { recursive: true });
  await fs.mkdir(paths.cleanDir, { recursive: true });
}

function normalizeUrl(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return null;
}

function parseDateFlexible(value) {
  if (!value) return "";

  const text = String(value).trim();

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function parseDatesRange(value) {
  if (!value) {
    return {
      start_date: "",
      end_date: "",
    };
  }

  const text = String(value).trim();
  const rangeMatch = text.match(
    /(\d{1,2})\s+([A-Za-z]{3,})\s+to\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/
  );

  if (rangeMatch) {
    const [, d1, m1, d2, m2, year] = rangeMatch;

    const start = new Date(`${d1} ${m1} ${year}`);
    const end = new Date(`${d2} ${m2} ${year}`);

    return {
      start_date: Number.isNaN(start.getTime()) ? "" : start.toISOString().slice(0, 10),
      end_date: Number.isNaN(end.getTime()) ? "" : end.toISOString().slice(0, 10),
    };
  }

  const parsed = parseDateFlexible(text);

  return {
    start_date: parsed,
    end_date: "",
  };
}

function extractTournamentRows(json) {
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.Items)) return json.Items;
  return [];
}

function normalizeTournament(row, sourceUrl, weekWindow) {
  const tournamentKey = getFirst(row, ["tournamentKey", "TournamentKey"]);
  const tournamentIdRaw = getFirst(row, [
    "tournamentId",
    "TournamentId",
    "id",
    "Id",
    "eventId",
    "EventId",
  ]);

  const tournamentId =
    tournamentIdRaw && String(tournamentIdRaw) !== "0" ? tournamentIdRaw : "";

  const name = getFirst(row, ["tournamentName", "TournamentName", "name", "Name"]);
  const promotionalName = getFirst(row, ["promotionalName", "PromotionalName"]);
  const category = getFirst(row, [
    "category",
    "Category",
    "grade",
    "Grade",
    "tourCode",
    "TourCode",
    "tournamentType",
    "TournamentType",
  ]);
  const hostNationCode = getFirst(row, [
    "hostNationCode",
    "HostNationCode",
    "nationCode",
    "NationCode",
    "countryCode",
    "CountryCode",
  ]);
  const hostNation = getFirst(row, [
    "hostNation",
    "HostNation",
    "nation",
    "Nation",
    "country",
    "Country",
    "countryName",
    "CountryName",
  ]);
  const location = getFirst(row, ["location", "Location", "city", "City", "venue", "Venue"]);
  const venue = getFirst(row, ["venue", "Venue"]);
  const startDateRaw = getFirst(row, [
    "startDate",
    "StartDate",
    "dateFrom",
    "DateFrom",
    "tournamentStartDate",
    "TournamentStartDate",
  ]);
  const endDateRaw = getFirst(row, [
    "endDate",
    "EndDate",
    "dateTo",
    "DateTo",
    "tournamentEndDate",
    "TournamentEndDate",
  ]);
  const datesRaw = getFirst(row, ["dates", "Dates", "date", "Date"]);

  let startDate = parseDateFlexible(startDateRaw);
  let endDate = parseDateFlexible(endDateRaw);

  if ((!startDate || !endDate) && datesRaw) {
    const parsedRange = parseDatesRange(datesRaw);

    if (!startDate) startDate = parsedRange.start_date;
    if (!endDate) endDate = parsedRange.end_date;
  }

  const surface = getFirst(row, ["surfaceDesc", "SurfaceDesc", "surface", "Surface"]);
  const surfaceCode = getFirst(row, ["surfaceCode", "SurfaceCode"]);
  const indoorOutdoor = getFirst(row, ["indoorOrOutDoor", "IndoorOrOutDoor"]);
  const tournamentLink = getFirst(row, [
    "tournamentLink",
    "TournamentLink",
    "link",
    "Link",
    "url",
    "Url",
  ]);
  const liveLink = getFirst(row, ["liveLink", "LiveLink"]);

  return {
    week_start: weekWindow.week_start,
    week_end: weekWindow.week_end,
    search_start: weekWindow.search_start,
    search_end: weekWindow.search_end,
    tournament_id: cleanText(tournamentId),
    tournament_key: cleanText(tournamentKey),
    tournament_name: cleanText(name),
    promotional_name: cleanText(promotionalName),
    category: cleanText(category),
    host_nation: cleanText(hostNation),
    host_nation_code: cleanText(hostNationCode),
    location: cleanText(location),
    venue: cleanText(venue),
    start_date: cleanText(startDate),
    end_date: cleanText(endDate),
    dates_raw: cleanText(datesRaw),
    surface: cleanText(surface),
    surface_code: cleanText(surfaceCode),
    indoor_outdoor: cleanText(indoorOutdoor),
    tournament_link: normalizeUrl(tournamentLink),
    live_link: normalizeUrl(liveLink),
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
    raw_json: JSON.stringify(row),
  };
}

function isCancelledTournament(tournament) {
  const name = String(tournament.tournament_name || "").toLowerCase();
  const promo = String(tournament.promotional_name || "").toLowerCase();

  return name.includes("cancelled") || promo.includes("cancelled");
}

export function tournamentBelongsToOfficialWeek(tournament, weekWindow) {
  const start = tournament.start_date;
  const end = tournament.end_date || tournament.start_date;

  if (!start || !start.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return false;
  }

  const effectiveEnd = end && end.match(/^\d{4}-\d{2}-\d{2}$/) ? end : start;

  if (!(effectiveEnd >= weekWindow.week_start && start <= weekWindow.week_end)) {
    return false;
  }

  if (start === weekWindow.week_end && effectiveEnd > weekWindow.week_end) {
    return false;
  }

  return true;
}

function titleCaseSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function parseTournamentUrl(value) {
  const url = normalizeUrl(value);
  const match = url.match(
    /\/en\/tournament\/([^/]+)\/([^/]+)\/(\d{4})\/([^/?#]+)\/?/i
  );

  if (!match) {
    throw new Error(`URL de torneio ITF invalida: ${value}`);
  }

  const [, slug, nationCode, year, key] = match;
  const categoryMatch = slug.match(/^(j\d+|ja|jgs|jga|jgb)/i);
  const category = categoryMatch ? categoryMatch[1].toUpperCase() : "";
  const locationSlug = category ? slug.slice(category.length).replace(/^-/, "") : slug;
  const location = titleCaseSlug(locationSlug);

  return {
    url,
    slug,
    nation_code: nationCode.toUpperCase(),
    year,
    key: key.toUpperCase(),
    category,
    location,
    name: cleanText([category, location].filter(Boolean).join(" ")),
  };
}

function buildCalendarUrl({ skip, take, dateFrom, dateTo }) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    searchString: "",
    skip: String(skip),
    take: String(take),
    nationCodes: "",
    zoneCodes: "",
    dateFrom,
    dateTo,
    indoorOutdoor: "",
    categories: "",
    isOrderAscending: "true",
    orderField: "startDate",
    surfaceCodes: "",
    singlesDrawFormat: "",
  });

  return `https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?${params.toString()}`;
}

async function fetchJsonInsideBrowser(page, url) {
  return await page.evaluate(
    async ({ url: requestUrl, timeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(requestUrl, {
          method: "GET",
          credentials: "include",
          headers: {
            accept: "application/json, text/plain, */*",
          },
          signal: controller.signal,
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

function looksBlockedOrHtml(result) {
  const contentType = String(result?.contentType || "").toLowerCase();
  const textStart = String(result?.textStart || "").toLowerCase();

  if (contentType.includes("text/html")) return true;
  if (textStart.includes("incapsula")) return true;
  if (textStart.includes("imperva")) return true;
  if (textStart.includes("_incapsula_resource")) return true;
  if (textStart.includes("<html")) return true;

  return false;
}

async function recoverBrowserSessionAfterBlock(page, attempt) {
  try {
    await page.context().clearCookies();
    await page.goto(ITF_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(Math.min(5000, 1500 * attempt));
  } catch (error) {
    console.log(`Recuperacao da sessao falhou: ${error?.message || error}`);
  }
}

async function fetchJsonWithRetry(page, url, label = "calendar request") {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${MAX_RETRIES}: ${label}`);

      const result = await fetchJsonInsideBrowser(page, url);

      if (result.ok && result.json) {
        return result;
      }

      const errorPrefix = result.timedOut ? "Request timeout" : `HTTP ${result.status}`;
      const error = new Error(
        `${errorPrefix}. Content-Type: ${result.contentType}. Text: ${result.textStart}`
      );

      error.isBlocked = !result.timedOut && looksBlockedOrHtml(result);
      error.timedOut = result.timedOut;
      throw error;
    } catch (err) {
      lastError = err;

      if (attempt >= MAX_RETRIES) {
        throw lastError;
      }

      if (err.isBlocked) {
        await recoverBrowserSessionAfterBlock(page, attempt);
        const delay = BLOCK_DELAY_MS * attempt;
        console.log(
          `Possivel bloqueio/HTML detectado. Esperando ${delay / 1000}s antes da proxima tentativa...`
        );
        await sleep(delay);
      } else {
        console.log(`Erro temporario. Esperando ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

async function fetchCalendarAllPages(page, weekWindow) {
  const take = 100;
  let skip = 0;
  const all = [];

  while (true) {
    const url = buildCalendarUrl({
      skip,
      take,
      dateFrom: weekWindow.search_start,
      dateTo: weekWindow.search_end,
    });

    console.log("");
    console.log(`Buscando calendario skip=${skip}, take=${take}`);
    console.log(url);

    const result = await fetchJsonWithRetry(page, url, `GetCalendar skip=${skip}, take=${take}`);

    if (!result.ok || !result.json) {
      throw new Error(
        `Falha no calendario. HTTP ${result.status}. ${result.contentType}. ${result.textStart}`
      );
    }

    const rows = extractTournamentRows(result.json);

    console.log(`Linhas recebidas: ${rows.length}`);

    all.push({
      url,
      rows_count: rows.length,
      total_items: result.json?.totalItems ?? "",
      json: result.json,
      rows,
    });

    if (rows.length < take) break;

    skip += take;

    if (skip > 1000) {
      console.log("Parando por seguranca em skip > 1000.");
      break;
    }

    await page.waitForTimeout(500);
  }

  return all;
}

function dedupeTournaments(rows) {
  const map = new Map();

  for (const row of rows) {
    const key =
      row.tournament_key ||
      row.tournament_link ||
      `${row.tournament_name}|${row.host_nation_code}|${row.start_date}`;

    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return [...map.values()];
}

function getManualList(config, names) {
  for (const name of names) {
    if (Array.isArray(config?.[name])) return config[name];
  }

  return [];
}

function normalizeManualEntry(entry) {
  if (typeof entry === "string") return { url: entry };
  if (entry && typeof entry === "object") return entry;
  return { url: "" };
}

function buildManualTournamentRows(entries, weekWindow, sourceUrl, collectedAt) {
  const seen = new Map();
  const duplicateKeys = new Map();

  for (const rawEntry of entries) {
    const entry = normalizeManualEntry(rawEntry);
    const parsed = parseTournamentUrl(entry.url || entry.tournament_link);
    const key = cleanText(entry.tournament_key || parsed.key);

    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);

    if (seen.has(key)) continue;

    const category = cleanText(entry.category || parsed.category);
    const location = cleanText(entry.location || parsed.location);
    const name = cleanText(entry.name || entry.tournament_name || parsed.name);

    seen.set(key, {
      week_start: weekWindow.week_start,
      week_end: weekWindow.week_end,
      search_start: weekWindow.search_start,
      search_end: weekWindow.search_end,
      tournament_id: cleanText(entry.tournament_id),
      tournament_key: key,
      tournament_name: name,
      promotional_name: cleanText(entry.promotional_name),
      category,
      host_nation: cleanText(entry.host_nation),
      host_nation_code: cleanText(entry.host_nation_code || parsed.nation_code),
      location,
      venue: cleanText(entry.venue),
      start_date: cleanText(entry.start_date || weekWindow.week_start),
      end_date: cleanText(entry.end_date || weekWindow.week_end),
      dates_raw: cleanText(entry.dates_raw),
      surface: cleanText(entry.surface),
      surface_code: cleanText(entry.surface_code),
      indoor_outdoor: cleanText(entry.indoor_outdoor),
      tournament_link: parsed.url,
      live_link: cleanText(entry.live_link),
      source_url: sourceUrl,
      collected_at: collectedAt,
      raw_json: JSON.stringify(rawEntry),
    });
  }

  return {
    rows: [...seen.values()],
    duplicate_keys: [...duplicateKeys.entries()]
      .filter(([, count]) => count > 1)
      .map(([tournament_key, count]) => ({ tournament_key, count })),
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function resolveManualTournamentFile(
  weekStart,
  explicitManualFile = "",
  cwd = process.cwd()
) {
  if (cleanText(explicitManualFile)) {
    return path.resolve(cwd, explicitManualFile);
  }

  const automaticFile = path.resolve(
    cwd,
    "data/config",
    `weekly_tournaments_${weekStart}.json`
  );

  try {
    await fs.access(automaticFile);
    return automaticFile;
  } catch {
    return "";
  }
}

function validateManualWeek(config, weekWindow) {
  const weekStart = cleanText(config.week_start || config.weekStart);
  const weekEnd = cleanText(config.week_end || config.weekEnd);

  if (weekStart && weekStart !== weekWindow.week_start) {
    throw new Error(
      `manual-file usa week_start=${weekStart}, mas a execucao usa ${weekWindow.week_start}.`
    );
  }

  if (weekEnd && weekEnd !== weekWindow.week_end) {
    throw new Error(
      `manual-file usa week_end=${weekEnd}, mas a execucao usa ${weekWindow.week_end}.`
    );
  }
}

async function writeManualTournamentArtifacts(manualFile, weekWindow, outputPaths) {
  const manualPath = path.resolve(manualFile);
  const config = await readJsonFile(manualPath);
  const sourceUrl = `manual-file:${manualPath}`;
  const collectedAt = new Date().toISOString();

  validateManualWeek(config, weekWindow);

  const currentEntries = getManualList(config, [
    "current_tournaments",
    "currentTournaments",
    "week_tournaments",
    "weekTournaments",
  ]);
  const droppingEntries = getManualList(config, [
    "dropping_tournaments",
    "droppingTournaments",
    "drop_tournaments",
    "dropTournaments",
  ]);

  const current = buildManualTournamentRows(
    currentEntries,
    weekWindow,
    sourceUrl,
    collectedAt
  );
  const dropping = buildManualTournamentRows(
    droppingEntries,
    weekWindow,
    sourceUrl,
    collectedAt
  );

  const tournaments = current.rows.sort((a, b) => {
    const categoryCompare = String(a.category).localeCompare(String(b.category));
    if (categoryCompare !== 0) return categoryCompare;

    return String(a.tournament_name).localeCompare(String(b.tournament_name));
  });

  await fs.writeFile(
    outputPaths.rawOutputFile,
    JSON.stringify(
      {
        week_window: weekWindow,
        source: sourceUrl,
        manual_tournaments_count: tournaments.length,
        manual_dropping_tournaments_count: dropping.rows.length,
        duplicate_current_tournament_keys: current.duplicate_keys,
        duplicate_dropping_tournament_keys: dropping.duplicate_keys,
        tournaments,
        dropping_tournaments: dropping.rows,
      },
      null,
      2
    ),
    "utf8"
  );

  await writeCsv(outputPaths.cleanOutputFile, tournaments, TOURNAMENT_COLUMNS);
  await writeCsv(outputPaths.debugAllFile, tournaments, TOURNAMENT_COLUMNS);

  return {
    tournaments,
    droppingTournaments: dropping.rows,
    duplicateCurrentKeys: current.duplicate_keys,
    duplicateDroppingKeys: dropping.duplicate_keys,
  };
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

export async function main(cliArgs = parseArgs()) {
  const weekWindow = buildWeekWindow(cliArgs);
  const outputPaths = resolveOutputPaths(cliArgs);
  const manualFile = await resolveManualTournamentFile(
    weekWindow.week_start,
    cliArgs.manualFile
  );

  await ensureDirs(outputPaths);

  console.log("");
  console.log("Semana oficial:");
  console.log({
    week_start: weekWindow.week_start,
    week_end: weekWindow.week_end,
  });

  console.log("");
  console.log("Janela de busca na API:");
  console.log({
    search_start: weekWindow.search_start,
    search_end: weekWindow.search_end,
  });

  if (manualFile) {
    console.log("");
    console.log(`Usando lista manual: ${manualFile}`);

    const result = await writeManualTournamentArtifacts(
      manualFile,
      weekWindow,
      outputPaths
    );

    console.log("");
    console.log("Finalizado.");
    console.log(`Torneios manuais da semana oficial: ${result.tournaments.length}`);
    console.log(
      `Torneios manuais caindo nesta semana: ${result.droppingTournaments.length}`
    );

    if (result.duplicateCurrentKeys.length || result.duplicateDroppingKeys.length) {
      console.log("");
      console.log("Duplicatas ignoradas:");
      for (const duplicate of [
        ...result.duplicateCurrentKeys,
        ...result.duplicateDroppingKeys,
      ]) {
        console.log(`${duplicate.tournament_key}: ${duplicate.count} ocorrencias`);
      }
    }

    console.log("");
    console.log("Arquivos gerados:");
    console.log(outputPaths.cleanOutputFile);
    console.log(outputPaths.debugAllFile);
    console.log(outputPaths.rawOutputFile);

    return;
  }

  const browser = await chromium.launch({
    headless: IS_CI ? true : false,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 900,
    },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log("");
    console.log("Criando sessao com a ITF...");

    await page.goto(CALENDAR_PAGE, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(3000);

    const results = await fetchCalendarAllPages(page, weekWindow);
    const allTournaments = [];

    for (const result of results) {
      for (const row of result.rows) {
        allTournaments.push(normalizeTournament(row, result.url, weekWindow));
      }
    }

    const debugAll = dedupeTournaments(allTournaments).sort((a, b) => {
      const dateCompare = String(a.start_date).localeCompare(String(b.start_date));
      if (dateCompare !== 0) return dateCompare;

      return String(a.tournament_name).localeCompare(String(b.tournament_name));
    });

    const tournaments = debugAll
      .filter((tournament) => !isCancelledTournament(tournament))
      .filter((tournament) => tournamentBelongsToOfficialWeek(tournament, weekWindow))
      .sort((a, b) => {
        const dateCompare = String(a.start_date).localeCompare(String(b.start_date));
        if (dateCompare !== 0) return dateCompare;

        return String(a.tournament_name).localeCompare(String(b.tournament_name));
      });

    await fs.writeFile(
      outputPaths.rawOutputFile,
      JSON.stringify(
        {
          week_window: weekWindow,
          sources: results.map((result) => ({
            url: result.url,
            rows_count: result.rows_count,
            total_items: result.total_items,
          })),
          all_tournaments_count: debugAll.length,
          week_tournaments_count: tournaments.length,
          tournaments,
          all_tournaments: debugAll,
        },
        null,
        2
      ),
      "utf8"
    );

    await writeCsv(outputPaths.cleanOutputFile, tournaments, TOURNAMENT_COLUMNS);
    await writeCsv(outputPaths.debugAllFile, debugAll, TOURNAMENT_COLUMNS);

    console.log("");
    console.log("Finalizado.");
    console.log(`Torneios retornados pela API: ${debugAll.length}`);
    console.log(`Torneios da semana oficial: ${tournaments.length}`);
    console.log("");
    console.log("Arquivos gerados:");
    console.log(outputPaths.cleanOutputFile);
    console.log(outputPaths.debugAllFile);
    console.log(outputPaths.rawOutputFile);

    if (tournaments.length > 0) {
      console.log("");
      console.log("Torneios da semana oficial:");
      for (const tournament of tournaments) {
        console.log(
          `${tournament.start_date} ate ${tournament.end_date} | ${tournament.category} | ${tournament.tournament_name} | ${tournament.host_nation_code} | ${tournament.tournament_key}`
        );
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err);
    process.exit(1);
  });
}
