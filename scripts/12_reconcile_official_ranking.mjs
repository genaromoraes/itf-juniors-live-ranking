import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const TOP_LIMIT = 500;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 90000;
const REQUEST_DELAY_MS = 300;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;
const CHECKPOINT_EVERY = 5;

const OUT_DIR_RAW = path.resolve("data/raw/official_reconciliation");
const OUT_DIR_CLEAN = path.resolve("data/clean");

const PLAYERS_FILE = path.join(OUT_DIR_CLEAN, "players.csv");
const RANKINGS_SNAPSHOT_FILE = path.join(OUT_DIR_CLEAN, "rankings_snapshot.csv");
const POINTS_LEDGER_FILE = path.join(OUT_DIR_CLEAN, "points_ledger.csv");
const BREAKDOWN_SUMMARY_FILE = path.join(OUT_DIR_CLEAN, "breakdown_summary.csv");
const BREAKDOWN_ERRORS_FILE = path.join(OUT_DIR_CLEAN, "breakdown_errors.csv");
const LIVE_RANKING_FILE = path.join(OUT_DIR_CLEAN, "live_ranking_with_drops.csv");
const REPORT_FILE = path.join(OUT_DIR_CLEAN, "official_reconciliation_report.csv");

const TODAY = new Date().toISOString().slice(0, 10);

const GENDERS = [
  { label: "boys", gender: "M", itfCode: "B" },
  { label: "girls", gender: "F", itfCode: "G" },
];

const PLAYER_COLUMNS = [
  "player_id",
  "player_name",
  "first_name",
  "last_name",
  "gender",
  "itf_gender_code",
  "country",
  "country_name",
  "birth_date",
  "birth_year",
  "junior_last_year",
  "active_junior",
  "profile_url",
  "current_rank",
  "current_points",
  "first_seen_date",
  "last_seen_date",
  "raw_json",
];

const SNAPSHOT_COLUMNS = [
  "ranking_date",
  "gender",
  "rank",
  "player_id",
  "player_name",
  "country",
  "country_name",
  "birth_year",
  "official_points",
  "source_url",
  "collected_at",
];

const LEDGER_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "country",
  "country_name",
  "birth_year",
  "event_type",
  "countable_status",
  "tournament_name",
  "category",
  "draw_type",
  "host_nation",
  "host_nation_code",
  "surface",
  "surface_code",
  "start_date",
  "drop_date_calculated",
  "round",
  "points",
  "tournament_link",
  "is_countable_at_collection",
  "is_live",
  "status",
  "source_url",
  "collected_at",
  "raw_json",
];

const SUMMARY_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "rank",
  "official_points",
  "total_label",
  "total_value",
  "singles_countable_total",
  "singles_non_countable_total",
  "doubles_countable_total",
  "doubles_non_countable_total",
  "calculated_total",
  "difference_vs_official",
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

const REPORT_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_rank",
  "official_points",
  "live_rank",
  "live_points",
  "point_diff",
  "reason",
  "action",
  "rows_found",
  "error_message",
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

function getMode() {
  const mode = cleanText(getArg("mode", process.env.RECONCILE_MODE || "diff"));

  if (mode === "all" || mode === "diff") return mode;

  throw new Error("Modo invalido. Use --mode=diff ou --mode=all.");
}

function getLiveSourceFile() {
  return path.resolve(
    getArg("live-file", process.env.RECONCILE_LIVE_FILE || LIVE_RANKING_FILE)
  );
}

function getLimit() {
  const limit = toNumber(getArg("limit", process.env.RECONCILE_LIMIT || ""));
  return limit > 0 ? limit : 0;
}

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

async function readCsvIfExists(filePath) {
  try {
    const csv = await fs.readFile(filePath, "utf8");
    return parse(csv, { columns: true, skip_empty_lines: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, { header: true, columns });
  await fs.writeFile(filePath, csv, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json, text/plain, */*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        },
      });

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (!response.ok || contentType.toLowerCase().includes("text/html")) {
        throw new Error(
          `HTTP ${response.status}. Content-Type: ${contentType}. Text: ${text.slice(0, 120)}`
        );
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err;

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function parseRankingDate(value) {
  const text = cleanText(value);
  const parsed = new Date(`${text} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return TODAY;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseItfDate(value) {
  const text = cleanText(value);
  if (!text) return "";

  const parsed = new Date(`${text} UTC`);
  if (Number.isNaN(parsed.getTime())) return text;

  return parsed.toISOString().slice(0, 10);
}

function calculateDropDate(startDateRaw) {
  const normalized = parseItfDate(startDateRaw);

  if (!normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return "";
  }

  const date = new Date(`${normalized}T00:00:00Z`);
  date.setDate(date.getDate() + 364);

  return date.toISOString().slice(0, 10);
}

function normalizeUrl(value) {
  const raw = cleanText(value);

  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
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

function buildRankingPointsUrl(playerId) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    matchTypeCode: "S",
    playerId: String(playerId),
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetRankingPoints?${params.toString()}`;
}

function normalizePlayer(row, genderInfo, existingPlayer, rankingDate) {
  const firstName = cleanText(row.playerGivenName || row.givenName || row.firstName);
  const lastName = cleanText(row.playerFamilyName || row.familyName || row.lastName);
  const birthYear = toNumber(row.birthYear || existingPlayer?.birth_year);

  return {
    player_id: cleanText(row.playerId || row.id),
    player_name: cleanText(row.fullName || [firstName, lastName].filter(Boolean).join(" ")),
    first_name: firstName,
    last_name: lastName,
    gender: genderInfo.gender,
    itf_gender_code: genderInfo.itfCode,
    country: cleanText(row.playerNationalityCode || row.nationCode),
    country_name: cleanText(row.playerNationality || row.nationalityName),
    birth_date: cleanText(existingPlayer?.birth_date),
    birth_year: birthYear || "",
    junior_last_year: birthYear ? birthYear + 18 : "",
    active_junior: cleanText(existingPlayer?.active_junior),
    profile_url: normalizeUrl(row.profileLink || existingPlayer?.profile_url),
    current_rank: toNumber(row.rank),
    current_points: toNumber(row.points),
    first_seen_date: cleanText(existingPlayer?.first_seen_date) || rankingDate,
    last_seen_date: rankingDate,
    raw_json: JSON.stringify(row),
  };
}

async function fetchOfficialRankings(existingPlayersById) {
  const players = [];
  const snapshots = [];
  let rankingDate = TODAY;

  for (const genderInfo of GENDERS) {
    console.log(`Buscando ranking oficial ${genderInfo.label}...`);

    for (let skip = 0; skip < TOP_LIMIT; skip += PAGE_SIZE) {
      const take = Math.min(PAGE_SIZE, TOP_LIMIT - skip);
      const url = buildRankingUrl(genderInfo, take, skip);
      const json = await fetchJson(url);
      const items = Array.isArray(json.items) ? json.items : [];

      rankingDate = parseRankingDate(json.rankDate || rankingDate);

      for (const item of items) {
        const player = normalizePlayer(
          item,
          genderInfo,
          existingPlayersById.get(String(item.playerId)),
          rankingDate
        );

        players.push(player);
        snapshots.push({
          ranking_date: rankingDate,
          gender: player.gender,
          rank: player.current_rank,
          player_id: player.player_id,
          player_name: player.player_name,
          country: player.country,
          country_name: player.country_name,
          birth_year: player.birth_year,
          official_points: player.current_points,
          source_url: url,
          collected_at: new Date().toISOString(),
        });
      }

      console.log(
        `${genderInfo.label}: posicoes ${skip + 1}-${skip + take}, ${items.length} linhas`
      );

      if (items.length === 0) break;
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return {
    rankingDate,
    players,
    snapshots,
  };
}

async function readLiveRankingRows(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");

    if (filePath.toLowerCase().endsWith(".html")) {
      const prefix = "const rankingData = ";
      const start = text.indexOf(prefix);
      const end = text.indexOf(";\n    const", start);

      if (start === -1 || end === -1) {
        throw new Error(`Nao encontrei rankingData em ${filePath}`);
      }

      return JSON.parse(text.slice(start + prefix.length, end));
    }

    return parse(text, { columns: true, skip_empty_lines: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function buildLiveMap(rows) {
  return new Map(
    rows
      .filter((row) => cleanText(row.player_id))
      .map((row) => [
        cleanText(row.player_id),
        {
          live_rank: toNumber(row.live_rank),
          live_points: toNumber(row.live_points),
        },
      ])
  );
}

function buildSelection({
  mode,
  officialPlayers,
  liveMap,
  ledgerPlayerIds,
  summaryByPlayerId,
}) {
  return officialPlayers
    .map((player) => {
      const live = liveMap.get(player.player_id);
      const officialPoints = toNumber(player.current_points);
      const livePoints = live ? toNumber(live.live_points) : 0;
      const pointDiff = Number((livePoints - officialPoints).toFixed(2));
      const missingLedger = !ledgerPlayerIds.has(player.player_id);
      const hasPointDiff = !live || Math.abs(pointDiff) >= 0.01;
      const summary = summaryByPlayerId.get(player.player_id);
      const missingSummary = !summary;
      const summaryMatchesOfficial =
        summary &&
        !missingLedger &&
        Math.abs(toNumber(summary.calculated_total) - officialPoints) < 0.01 &&
        Math.abs(toNumber(summary.official_points) - officialPoints) < 0.01;

      let reason = "";

      if (mode === "all") {
        reason = "refresh_all";
      } else if (summaryMatchesOfficial) {
        reason = "";
      } else if (missingSummary) {
        reason = "missing_breakdown_summary";
      } else if (missingLedger) {
        reason = "missing_initial_breakdown";
      } else if (hasPointDiff) {
        reason = "point_difference";
      } else {
        reason = "official_breakdown_mismatch";
      }

      return {
        player,
        live,
        officialPoints,
        livePoints,
        pointDiff,
        reason,
      };
    })
    .filter((item) => item.reason);
}

function getSection(json, name) {
  const sections = json?.countable || [];

  return sections.find((section) =>
    cleanText(section.title).toLowerCase().includes(name)
  );
}

function normalizeBreakdownRow({ player, sectionTitle, countableStatus, item, sourceUrl }) {
  const eventType = sectionTitle.toLowerCase().includes("double")
    ? "doubles"
    : "singles";

  const startDate = parseItfDate(item.startDate);

  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    event_type: eventType,
    countable_status: countableStatus,
    tournament_name: cleanText(item.tournamentName),
    category: cleanText(item.category),
    draw_type: cleanText(item.drawType),
    host_nation: cleanText(item.hostNation),
    host_nation_code: cleanText(item.hostNationCode),
    surface: cleanText(item.surfaceDesc),
    surface_code: cleanText(item.surfaceCode),
    start_date: startDate,
    drop_date_calculated: calculateDropDate(item.startDate),
    round: cleanText(item.round),
    points: toNumber(item.points),
    tournament_link: normalizeUrl(item.tournamentLink),
    is_countable_at_collection: countableStatus === "countable" ? "true" : "false",
    is_live: "false",
    status: "confirmed_from_official_reconciliation",
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
    raw_json: JSON.stringify(item),
  };
}

function extractLedgerRowsFromBreakdown(json, player, sourceUrl) {
  const rows = [];
  const sections = json?.countable || [];

  for (const section of sections) {
    const sectionTitle = cleanText(section.title);
    const countable = section?.countablePoints?.pointsBreakdown || [];
    const nonCountable = section?.nonCountablePoints?.pointsBreakdown || [];

    for (const item of countable) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "countable",
          item,
          sourceUrl,
        })
      );
    }

    for (const item of nonCountable) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "non_countable",
          item,
          sourceUrl,
        })
      );
    }
  }

  return rows;
}

function extractSummaryFromBreakdown(json, player, sourceUrl, rows) {
  const singlesSection = getSection(json, "single");
  const doublesSection = getSection(json, "double");
  const singlesCountable = toNumber(singlesSection?.countablePoints?.totalPoints);
  const doublesCountable = toNumber(doublesSection?.countablePoints?.totalPoints);
  const calculatedTotal = Number((singlesCountable + doublesCountable / 4).toFixed(2));
  const officialPoints = toNumber(player.current_points);

  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    rank: player.current_rank,
    official_points: player.current_points,
    total_label: cleanText(json?.Value?.label),
    total_value: cleanText(json?.Value?.Value),
    singles_countable_total: singlesSection?.countablePoints?.totalPoints ?? "",
    singles_non_countable_total: singlesSection?.nonCountablePoints?.totalPoints ?? "",
    doubles_countable_total: doublesSection?.countablePoints?.totalPoints ?? "",
    doubles_non_countable_total: doublesSection?.nonCountablePoints?.totalPoints ?? "",
    calculated_total: calculatedTotal,
    difference_vs_official: Number((calculatedTotal - officialPoints).toFixed(2)),
    rows_found: rows.length,
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
  };
}

async function fetchPlayerBreakdown(player) {
  const sourceUrl = buildRankingPointsUrl(player.player_id);
  const json = await fetchJson(sourceUrl);
  const rawFile = path.join(
    OUT_DIR_RAW,
    `${player.gender}_${player.current_rank}_${player.player_id}_${TODAY}.json`
  );

  await fs.writeFile(
    rawFile,
    JSON.stringify({ player, source_url: sourceUrl, json }, null, 2),
    "utf8"
  );

  const rows = extractLedgerRowsFromBreakdown(json, player, sourceUrl);
  const summary = extractSummaryFromBreakdown(json, player, sourceUrl, rows);

  return { rows, summary };
}

function removeRowsForPlayerIds(rows, playerIds) {
  const ids = new Set(playerIds.map(String));
  return rows.filter((row) => !ids.has(String(row.player_id)));
}

async function writeReconciliationFiles({
  official,
  ledgerRows,
  summaryRows,
  errorRows,
  reportRows,
}) {
  await writeCsv(PLAYERS_FILE, official.players, PLAYER_COLUMNS);
  await writeCsv(RANKINGS_SNAPSHOT_FILE, official.snapshots, SNAPSHOT_COLUMNS);
  await writeCsv(POINTS_LEDGER_FILE, ledgerRows, LEDGER_COLUMNS);
  await writeCsv(BREAKDOWN_SUMMARY_FILE, summaryRows, SUMMARY_COLUMNS);
  await writeCsv(BREAKDOWN_ERRORS_FILE, errorRows, ERROR_COLUMNS);
  await writeCsv(REPORT_FILE, reportRows, REPORT_COLUMNS);
}

async function main() {
  await ensureDirs();

  const mode = getMode();
  const liveFile = getLiveSourceFile();
  const limit = getLimit();

  console.log("");
  console.log("Reconciliacao pos-ranking oficial ITF");
  console.log(`Modo: ${mode}`);
  console.log(`Live usado para comparacao: ${liveFile}`);
  if (limit) console.log(`Limite desta execucao: ${limit}`);

  const existingPlayers = await readCsvIfExists(PLAYERS_FILE);
  const existingPlayersById = new Map(
    existingPlayers.map((player) => [String(player.player_id), player])
  );

  const existingLedger = await readCsvIfExists(POINTS_LEDGER_FILE);
  const existingSummary = await readCsvIfExists(BREAKDOWN_SUMMARY_FILE);
  const existingErrors = await readCsvIfExists(BREAKDOWN_ERRORS_FILE);
  const liveRows = await readLiveRankingRows(liveFile);
  const liveMap = buildLiveMap(liveRows);
  const summaryByPlayerId = new Map(
    existingSummary
      .filter((row) => cleanText(row.player_id))
      .map((row) => [cleanText(row.player_id), row])
  );

  const ledgerPlayerIds = new Set(
    existingLedger.map((row) => cleanText(row.player_id)).filter(Boolean)
  );

  const official = await fetchOfficialRankings(existingPlayersById);
  const allSelected = buildSelection({
    mode,
    officialPlayers: official.players,
    liveMap,
    ledgerPlayerIds,
    summaryByPlayerId,
  });
  const selected = limit ? allSelected.slice(0, limit) : allSelected;

  console.log("");
  console.log(`Ranking oficial: ${official.rankingDate}`);
  console.log(`Jogadores oficiais carregados: ${official.players.length}`);
  console.log(`Jogadores pendentes para breakdown: ${allSelected.length}`);
  console.log(`Jogadores selecionados nesta execucao: ${selected.length}`);

  const officialPlayerIds = new Set(
    official.players.map((player) => player.player_id)
  );

  let ledgerRows = existingLedger.filter((row) =>
    officialPlayerIds.has(cleanText(row.player_id))
  );
  let summaryRows = existingSummary.filter((row) =>
    officialPlayerIds.has(cleanText(row.player_id))
  );
  let errorRows = existingErrors.filter((row) =>
    officialPlayerIds.has(cleanText(row.player_id))
  );
  const reportRows = [];

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const player = item.player;

    console.log(
      `[${i + 1}/${selected.length}] ${player.gender} #${player.current_rank} ${player.player_name} (${item.reason})`
    );

    try {
      const result = await fetchPlayerBreakdown(player);

      ledgerRows = removeRowsForPlayerIds(ledgerRows, [player.player_id]);
      ledgerRows.push(...result.rows);

      summaryRows = removeRowsForPlayerIds(summaryRows, [player.player_id]);
      summaryRows.push(result.summary);

      errorRows = removeRowsForPlayerIds(errorRows, [player.player_id]);

      reportRows.push({
        player_id: player.player_id,
        player_name: player.player_name,
        gender: player.gender,
        official_rank: player.current_rank,
        official_points: player.current_points,
        live_rank: item.live?.live_rank || "",
        live_points: item.live ? item.livePoints : "",
        point_diff: item.live ? item.pointDiff : "",
        reason: item.reason,
        action: "breakdown_refreshed",
        rows_found: result.rows.length,
        error_message: "",
      });
    } catch (err) {
      const message = err?.message || String(err);

      errorRows = removeRowsForPlayerIds(errorRows, [player.player_id]);
      errorRows.push({
        player_id: player.player_id,
        player_name: player.player_name,
        gender: player.gender,
        rank: player.current_rank,
        error_message: message,
        collected_at: new Date().toISOString(),
      });

      reportRows.push({
        player_id: player.player_id,
        player_name: player.player_name,
        gender: player.gender,
        official_rank: player.current_rank,
        official_points: player.current_points,
        live_rank: item.live?.live_rank || "",
        live_points: item.live ? item.livePoints : "",
        point_diff: item.live ? item.pointDiff : "",
        reason: item.reason,
        action: "error",
        rows_found: 0,
        error_message: message,
      });
    }

    await sleep(REQUEST_DELAY_MS);

    if ((i + 1) % CHECKPOINT_EVERY === 0) {
      await writeReconciliationFiles({
        official,
        ledgerRows,
        summaryRows,
        errorRows,
        reportRows,
      });

      console.log(`Checkpoint salvo (${i + 1}/${selected.length}).`);
    }
  }

  await writeReconciliationFiles({
    official,
    ledgerRows,
    summaryRows,
    errorRows,
    reportRows,
  });

  const refreshed = reportRows.filter((row) => row.action === "breakdown_refreshed").length;
  const errors = reportRows.filter((row) => row.action === "error").length;

  console.log("");
  console.log("Reconciliacao concluida.");
  console.log(`Breakdowns atualizados: ${refreshed}`);
  console.log(`Erros: ${errors}`);
  console.log("");
  console.log("Arquivos atualizados:");
  console.log("data/clean/players.csv");
  console.log("data/clean/rankings_snapshot.csv");
  console.log("data/clean/points_ledger.csv");
  console.log("data/clean/breakdown_summary.csv");
  console.log("data/clean/breakdown_errors.csv");
  console.log("data/clean/official_reconciliation_report.csv");
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});
