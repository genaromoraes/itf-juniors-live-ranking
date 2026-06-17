import path from "node:path";
import { chromium } from "playwright";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  loadStaging,
  writeCsvAtomic,
  writeStagingStatus,
} from "./lib/top1000_migration.mjs";
import {
  buildRankingPointsUrl,
  cleanText,
  detectBlockedHtml,
  extractLedgerRowsFromRankingPoints,
  fetchJsonInsideBrowser,
  readCachedBreakdown,
  saveRawBreakdown,
  toNumber,
} from "./lib/player_breakdown.mjs";

const RAW_DIR = path.resolve("data/raw/breakdowns");
const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";
const IS_CI = process.env.CI === "true";
const REQUEST_TIMEOUT_MS = 30000;
const DELAY_MS = toNumber(process.env.ITF_BREAKDOWN_DELAY_MS) || 5000;

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
  return limit > 0 ? limit : 10;
}

function removeRowsForPlayer(rows, playerId) {
  return rows.filter((row) => cleanText(row.player_id) !== cleanText(playerId));
}

function playerFromRow(row) {
  return {
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    gender: cleanText(row.gender),
    country: cleanText(row.country),
    country_name: cleanText(row.country_name),
    birth_year: cleanText(row.birth_year),
  };
}

function buildQueue(playersRows, summaryRows) {
  const gender = cleanText(getArg("gender")).toUpperCase();
  const startRank = toNumber(getArg("start-rank", "501")) || 501;
  const endRank = toNumber(getArg("end-rank", "1000")) || 1000;
  const force = hasFlag("force");
  const fetchedIds = new Set(
    summaryRows
      .filter((row) => cleanText(row.status) === "fetched")
      .map((row) => cleanText(row.player_id))
  );

  return playersRows.filter((row) => {
    const rank = toNumber(row.current_rank);
    if (gender && cleanText(row.gender).toUpperCase() !== gender) return false;
    if (rank < startRank || rank > endRank) return false;
    if (!force && fetchedIds.has(cleanText(row.player_id))) return false;
    return true;
  });
}

async function getBreakdown(page, player, rankingDate, force) {
  const url = buildRankingPointsUrl(player.player_id);
  if (!force) {
    const cached = await readCachedBreakdown({ rawDir: RAW_DIR, rankingDate, player });
    if (cached) {
      return {
        fromCache: true,
        rawFile: cached.rawFile,
        rows: extractLedgerRowsFromRankingPoints(cached.json, player, cached.sourceUrl),
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
    rows: extractLedgerRowsFromRankingPoints(result.json, player, url),
  };
}

async function persist(paths, ledgerRows, summaryRows, errorRows) {
  await writeCsvAtomic(paths.staging.ledger, ledgerRows, LEDGER_COLUMNS);
  await writeCsvAtomic(paths.staging.summary, summaryRows, BREAKDOWN_SUMMARY_COLUMNS);
  await writeCsvAtomic(paths.staging.errors, errorRows, BREAKDOWN_ERROR_COLUMNS);
  await writeStagingStatus();
}

async function main() {
  const limit = getLimit();
  const force = hasFlag("force");
  const loaded = await loadStaging();
  let { ledgerRows, summaryRows, errorRows } = loaded;
  const queue = buildQueue(loaded.playersRows, summaryRows).slice(0, limit);
  const rankingDate = cleanText(loaded.snapshotRows[0]?.ranking_date);

  console.log(`Fila de breakdowns Top 1000: ${queue.length}`);
  console.log(`Limite: ${limit}`);
  console.log(`Delay: ${DELAY_MS / 1000}s`);

  if (!queue.length) {
    await persist(loaded.paths, ledgerRows, summaryRows, errorRows);
    return;
  }

  const browser = await chromium.launch({ headless: IS_CI ? true : false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();

  try {
    await page.goto(RANKING_PAGE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);

    for (const row of queue) {
      const player = playerFromRow(row);
      console.log(`Buscando breakdown staging: ${player.player_name} (${player.player_id})`);
      try {
        const result = await getBreakdown(page, player, rankingDate, force);
        ledgerRows = removeRowsForPlayer(ledgerRows, player.player_id);
        ledgerRows.push(...result.rows);
        summaryRows = removeRowsForPlayer(summaryRows, player.player_id);
        summaryRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: row.current_rank,
          ranking_date: rankingDate,
          status: "fetched",
          ledger_rows: String(result.rows.length),
          updated_at: new Date().toISOString(),
        });
        errorRows = removeRowsForPlayer(errorRows, player.player_id);
        console.log(`OK: ${result.rows.length} linhas ${result.fromCache ? "(cache)" : ""}`);
      } catch (err) {
        errorRows = removeRowsForPlayer(errorRows, player.player_id);
        errorRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: row.current_rank,
          ranking_date: rankingDate,
          error_message: err.message,
          updated_at: new Date().toISOString(),
        });
        console.log(`ERRO: ${err.message}`);
        await persist(loaded.paths, ledgerRows, summaryRows, errorRows);
        if (err.isBlocked) break;
      }

      await persist(loaded.paths, ledgerRows, summaryRows, errorRows);
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
