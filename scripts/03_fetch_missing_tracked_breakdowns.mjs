import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  TRACKED_BASE_LIMIT_PER_GENDER,
} from "./lib/ranking_limits.mjs";
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
const RAW_DIR = path.resolve("data/raw/breakdowns");
const PLAYERS_FILE = path.join(CLEAN_DIR, "players.csv");
const SNAPSHOT_FILE = path.join(CLEAN_DIR, "rankings_snapshot.csv");
const LEDGER_FILE = path.join(CLEAN_DIR, "points_ledger.csv");
const SUMMARY_FILE = path.join(CLEAN_DIR, "breakdown_summary.csv");
const ERRORS_FILE = path.join(CLEAN_DIR, "breakdown_errors.csv");
const CHECKPOINT_FILE = path.resolve("data/raw/breakdowns_missing_checkpoint.json");
const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

const IS_CI = process.env.CI === "true";
const REQUEST_TIMEOUT_MS = 30000;
const DELAY_MS = toNumber(process.env.ITF_BREAKDOWN_DELAY_MS) || 5000;
const DEFAULT_LIMIT = toNumber(process.env.ITF_BREAKDOWN_MAX_PER_RUN) || 10;

const SUMMARY_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "rank",
  "official_points",
  "rows_found",
  "source_url",
  "collected_at",
];

const ERROR_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "rank",
  "error_message",
  "collected_at",
];

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

async function readCsv(filePath, { optional = false } = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parse(content, { columns: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    if (optional && err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

function removeRowsForPlayer(rows, playerId) {
  return rows.filter((row) => cleanText(row.player_id) !== cleanText(playerId));
}

function getLimit() {
  const limit = toNumber(getArg("limit"));
  return limit > 0 ? limit : DEFAULT_LIMIT;
}

function getRankBounds() {
  return {
    startRank: toNumber(getArg("start-rank", "1")) || 1,
    endRank:
      toNumber(getArg("end-rank", String(TRACKED_BASE_LIMIT_PER_GENDER))) ||
      TRACKED_BASE_LIMIT_PER_GENDER,
    gender: cleanText(getArg("gender")).toUpperCase(),
  };
}

function getRankingDate(snapshotRows) {
  return cleanText(snapshotRows.find((row) => cleanText(row.ranking_date))?.ranking_date);
}

function buildDoneSet(ledgerRows) {
  return new Set(ledgerRows.map((row) => cleanText(row.player_id)).filter(Boolean));
}

function selectMissingPlayers({ playersRows, snapshotRows, ledgerRows }) {
  const done = buildDoneSet(ledgerRows);
  const { startRank, endRank, gender } = getRankBounds();
  const snapshotById = new Map(
    snapshotRows.map((row) => [cleanText(row.player_id), row])
  );

  return playersRows
    .map((player) => {
      const snapshot = snapshotById.get(cleanText(player.player_id)) || {};
      return {
        ...player,
        current_rank: cleanText(player.current_rank || snapshot.rank),
        current_points: cleanText(player.current_points || snapshot.official_points),
      };
    })
    .filter((player) => !done.has(cleanText(player.player_id)))
    .filter((player) => !gender || cleanText(player.gender).toUpperCase() === gender)
    .filter((player) => {
      const rank = toNumber(player.current_rank);
      return rank >= startRank && rank <= endRank;
    })
    .sort((a, b) => toNumber(a.current_rank) - toNumber(b.current_rank));
}

async function writeCheckpoint(value) {
  await fs.mkdir(path.dirname(CHECKPOINT_FILE), { recursive: true });
  await fs.writeFile(CHECKPOINT_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchBreakdown(page, player, rankingDate) {
  const cached = await readCachedBreakdown({
    rawDir: RAW_DIR,
    rankingDate,
    player,
  });
  if (cached) {
    return {
      fromCache: true,
      rawFile: cached.rawFile,
      sourceUrl: cached.sourceUrl,
      rows: extractLedgerRowsFromRankingPoints(cached.json, player, cached.sourceUrl, {
        status: "confirmed_from_missing_tracked_breakdown",
      }),
    };
  }

  const url = buildRankingPointsUrl(player.player_id);
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
    sourceUrl: url,
    rows: extractLedgerRowsFromRankingPoints(result.json, player, url, {
      status: "confirmed_from_missing_tracked_breakdown",
    }),
  };
}

async function main() {
  const limit = getLimit();
  const playersRows = await readCsv(PLAYERS_FILE);
  const snapshotRows = await readCsv(SNAPSHOT_FILE);
  let ledgerRows = await readCsv(LEDGER_FILE, { optional: true });
  let summaryRows = await readCsv(SUMMARY_FILE, { optional: true });
  let errorRows = await readCsv(ERRORS_FILE, { optional: true });
  const rankingDate = getRankingDate(snapshotRows);
  const missingPlayers = selectMissingPlayers({
    playersRows,
    snapshotRows,
    ledgerRows,
  }).slice(0, limit);

  console.log(`Jogadores faltantes selecionados: ${missingPlayers.length}`);
  console.log(`Limite desta execucao: ${limit}`);
  console.log(`Delay entre jogadores: ${DELAY_MS / 1000}s`);

  if (!missingPlayers.length) return;

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

    for (const player of missingPlayers) {
      console.log(`Buscando breakdown: ${player.gender} #${player.current_rank} ${player.player_name}`);

      try {
        const result = await fetchBreakdown(page, player, rankingDate);
        ledgerRows = removeRowsForPlayer(ledgerRows, player.player_id);
        ledgerRows.push(...result.rows);
        summaryRows = removeRowsForPlayer(summaryRows, player.player_id);
        summaryRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: player.current_rank,
          official_points: player.current_points,
          rows_found: result.rows.length,
          source_url: result.sourceUrl,
          collected_at: new Date().toISOString(),
        });
        errorRows = removeRowsForPlayer(errorRows, player.player_id);
        console.log(`OK: ${result.rows.length} linhas ${result.fromCache ? "(cache)" : ""}`);
      } catch (err) {
        errorRows = removeRowsForPlayer(errorRows, player.player_id);
        errorRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: player.current_rank,
          error_message: err.message,
          collected_at: new Date().toISOString(),
        });
        console.log(`ERRO: ${err.message}`);
        if (err.isBlocked) break;
      }

      await writeCsv(LEDGER_FILE, ledgerRows, LEDGER_COLUMNS);
      await writeCsv(SUMMARY_FILE, summaryRows, SUMMARY_COLUMNS);
      await writeCsv(ERRORS_FILE, errorRows, ERROR_COLUMNS);
      await writeCheckpoint({
        last_player_id: player.player_id,
        last_rank: player.current_rank,
        updated_at: new Date().toISOString(),
      });
      await page.waitForTimeout(DELAY_MS);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

