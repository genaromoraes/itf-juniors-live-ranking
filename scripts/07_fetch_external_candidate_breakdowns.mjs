import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  EXTERNAL_CANDIDATE_COLUMNS,
  STATUS_BLOCKED,
  STATUS_FETCHED,
  STATUS_FETCH_ERROR,
  STATUS_FETCH_REQUIRED,
  cleanText,
  readCsv,
  writeCsv,
} from "./lib/external_candidates.mjs";
import {
  LEDGER_COLUMNS,
  buildRankingPointsUrl,
  detectBlockedHtml,
  extractLedgerRowsFromRankingPoints,
  fetchJsonInsideBrowser,
  readCachedBreakdown,
  saveRawBreakdown,
  toNumber,
} from "./lib/player_breakdown.mjs";

const CLEAN_DIR = path.resolve("data", "clean");
const RAW_DIR = path.resolve("data/raw/external_candidate_breakdowns");
const CANDIDATES_FILE = path.join(CLEAN_DIR, "external_candidates.csv");
const LEDGER_FILE = path.join(CLEAN_DIR, "external_candidate_ledger.csv");
const ERRORS_FILE = path.join(CLEAN_DIR, "external_candidate_errors.csv");
const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

const IS_CI = process.env.CI === "true";
const REQUEST_TIMEOUT_MS = 30000;
const DELAY_MS = toNumber(process.env.ITF_CANDIDATE_DELAY_MS) || 5000;
const DEFAULT_LIMIT = toNumber(process.env.ITF_CANDIDATE_MAX_PER_RUN) || 10;

const ERROR_COLUMNS = [
  "player_id",
  "player_name",
  "candidate_status",
  "error_message",
  "updated_at",
];

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getLimit() {
  const limit = toNumber(getArg("limit"));
  return limit > 0 ? limit : DEFAULT_LIMIT;
}

function getRankingDate(candidates) {
  return (
    cleanText(candidates.find((row) => cleanText(row.updated_at))?.updated_at).slice(0, 10) ||
    new Date().toISOString().slice(0, 10)
  );
}

async function readCsvIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parse(content, { columns: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeLedger(rows) {
  await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
  await fs.writeFile(
    LEDGER_FILE,
    stringify(rows, { header: true, columns: LEDGER_COLUMNS }),
    "utf8"
  );
}

async function writeErrors(rows) {
  await fs.mkdir(path.dirname(ERRORS_FILE), { recursive: true });
  await fs.writeFile(
    ERRORS_FILE,
    stringify(rows, { header: true, columns: ERROR_COLUMNS }),
    "utf8"
  );
}

function removeRowsForPlayer(rows, playerId) {
  return rows.filter((row) => cleanText(row.player_id) !== cleanText(playerId));
}

function updateCandidate(candidates, playerId, patch) {
  const index = candidates.findIndex(
    (row) => cleanText(row.player_id) === cleanText(playerId)
  );
  if (index >= 0) {
    candidates[index] = {
      ...candidates[index],
      ...patch,
      updated_at: new Date().toISOString(),
    };
  }
}

function candidateToPlayer(candidate) {
  return {
    player_id: cleanText(candidate.player_id),
    player_name: cleanText(candidate.player_name),
    gender: cleanText(candidate.gender),
    country: cleanText(candidate.country),
    country_name: "",
    birth_year: "",
    current_rank: cleanText(candidate.official_rank),
    current_points: cleanText(candidate.official_points),
  };
}

async function getBreakdown(page, candidate, rankingDate, force) {
  const player = candidateToPlayer(candidate);
  const url = buildRankingPointsUrl(player.player_id);

  if (!force) {
    const cached = await readCachedBreakdown({
      rawDir: RAW_DIR,
      rankingDate,
      player,
    });
    if (cached) {
      return {
        fromCache: true,
        rawFile: cached.rawFile,
        rows: extractLedgerRowsFromRankingPoints(cached.json, player, cached.sourceUrl, {
          status: "confirmed_external_candidate_breakdown",
        }),
      };
    }
  }

  const result = await fetchJsonInsideBrowser(page, url, REQUEST_TIMEOUT_MS);

  if (!result.ok || !result.json) {
    const error = new Error(
      `HTTP ${result.status}. Content-Type: ${result.contentType}. Text: ${result.textStart}`
    );
    error.isBlocked = detectBlockedHtml(result);
    throw error;
  }

  const rawFile = await saveRawBreakdown({
    rawDir: RAW_DIR,
    rankingDate,
    player,
    sourceUrl: url,
    json: result.json,
  });

  return {
    fromCache: false,
    rawFile,
    rows: extractLedgerRowsFromRankingPoints(result.json, player, url, {
      status: "confirmed_external_candidate_breakdown",
    }),
  };
}

async function main() {
  const limit = getLimit();
  const force = hasFlag("force");
  const candidates = await readCsv(CANDIDATES_FILE);
  let ledgerRows = await readCsvIfExists(LEDGER_FILE);
  let errorRows = await readCsvIfExists(ERRORS_FILE);
  const rankingDate = getRankingDate(candidates);
  const queue = candidates
    .filter((row) => cleanText(row.candidate_status) === STATUS_FETCH_REQUIRED)
    .slice(0, limit);

  console.log(`Candidatos FETCH_REQUIRED na fila: ${queue.length}`);
  console.log(`Limite desta execucao: ${limit}`);
  console.log(`Delay entre jogadores: ${DELAY_MS / 1000}s`);

  if (!queue.length) {
    await writeLedger(ledgerRows);
    await writeErrors(errorRows);
    return;
  }

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

    for (const candidate of queue) {
      console.log(`Buscando candidato externo: ${candidate.player_name} (${candidate.player_id})`);

      try {
        const result = await getBreakdown(page, candidate, rankingDate, force);
        ledgerRows = removeRowsForPlayer(ledgerRows, candidate.player_id);
        ledgerRows.push(...result.rows);
        errorRows = removeRowsForPlayer(errorRows, candidate.player_id);
        updateCandidate(candidates, candidate.player_id, {
          candidate_status: STATUS_FETCHED,
          breakdown_required: "false",
          breakdown_fetched: "true",
          breakdown_cache_file: path.relative(process.cwd(), result.rawFile),
          reason: "breakdown_fetched",
        });
        console.log(`OK: ${result.rows.length} linhas ${result.fromCache ? "(cache)" : ""}`);
      } catch (err) {
        const status = err.isBlocked ? STATUS_BLOCKED : STATUS_FETCH_ERROR;
        updateCandidate(candidates, candidate.player_id, {
          candidate_status: status,
          breakdown_required: status === STATUS_BLOCKED ? "true" : "false",
          breakdown_fetched: "false",
          reason: err.isBlocked ? "blocked_by_itf" : "breakdown_fetch_error",
        });
        errorRows = removeRowsForPlayer(errorRows, candidate.player_id);
        errorRows.push({
          player_id: candidate.player_id,
          player_name: candidate.player_name,
          candidate_status: status,
          error_message: err.message,
          updated_at: new Date().toISOString(),
        });
        console.log(`ERRO: ${err.message}`);
        if (err.isBlocked) break;
      }

      await writeCsv(CANDIDATES_FILE, candidates, EXTERNAL_CANDIDATE_COLUMNS);
      await writeLedger(ledgerRows);
      await writeErrors(errorRows);
      await page.waitForTimeout(DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  await writeCsv(CANDIDATES_FILE, candidates, EXTERNAL_CANDIDATE_COLUMNS);
  await writeLedger(ledgerRows);
  await writeErrors(errorRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

