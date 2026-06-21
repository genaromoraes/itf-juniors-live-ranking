import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  STAGED_POLICY,
  buildSnapshotMap,
  calculateLedgerPoints,
  cleanText,
  compareCalculatedAgainstSnapshot,
  normalizeGender,
} from "./lib/official_ledger_validation.mjs";
import { LEDGER_COLUMNS } from "./lib/weekly_ledger.mjs";
import { summarizeWeekCompletion } from "./lib/week_completion.mjs";
import {
  buildTrackedRankingRows,
  mergeLedgersWithDrops,
} from "./08_calculate_live_ranking_with_drops.mjs";
import {
  DISPLAY_LIMIT_PER_GENDER,
  getActiveBaseLimitPerGender,
  getActiveBaseTotal,
} from "./lib/ranking_limits.mjs";

const ACTION_STATUS = "status";
const ACTION_CLOSE = "close";
const ACTION_START = "start";

const MODE_DRY_RUN = "dry-run";
const MODE_APPLY = "apply";

export const STATUS_WEEK_IN_PROGRESS = "WEEK_IN_PROGRESS";
export const STATUS_WEEK_COMPLETE_WAITING_END_DATE =
  "WEEK_COMPLETE_WAITING_END_DATE";
export const STATUS_WEEK_ENDED_WITH_PENDING_RESULTS =
  "WEEK_ENDED_WITH_PENDING_RESULTS";
export const STATUS_WEEK_CLOSE_BLOCKED = "WEEK_CLOSE_BLOCKED";
export const STATUS_WEEK_READY_TO_CLOSE = "WEEK_READY_TO_CLOSE";
export const STATUS_WEEK_CLOSED_WAITING_OFFICIAL_RANKING =
  "WEEK_CLOSED_WAITING_OFFICIAL_RANKING";
export const STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START =
  "OFFICIAL_BASE_UPDATED_READY_TO_START";
export const STATUS_NEW_WEEK_READY = "NEW_WEEK_READY";
export const STATUS_INVALID = "INVALID_STATE";

const WEEK_TOURNAMENTS_COLUMNS = [
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

const WEEK_MATCHES_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "start_date",
  "end_date",
  "tournament_id",
  "event_id",
  "player_type_code",
  "player_type_desc",
  "match_type_code",
  "match_type_desc",
  "event_classification_code",
  "event_classification_desc",
  "drawsheet_structure_code",
  "drawsheet_structure_desc",
  "group_name",
  "round_name",
  "round_order",
  "match_id",
  "play_status_code",
  "play_status_desc",
  "result_status_code",
  "result_status_desc",
  "team1_player_ids",
  "team1_names",
  "team1_nationalities",
  "team1_seed",
  "team1_entry_status",
  "team2_player_ids",
  "team2_names",
  "team2_nationalities",
  "team2_seed",
  "team2_entry_status",
  "winner_side",
  "winner_names",
  "score",
  "h2h_link",
  "live_scores_link",
  "raw_json",
  "collected_at",
];

const WEEK_PLAYER_RESULTS_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "start_date",
  "end_date",
  "player_id",
  "player_name",
  "nationality",
  "player_type_code",
  "player_type_desc",
  "match_type_code",
  "match_type_desc",
  "event_classification_code",
  "event_classification_desc",
  "matches_played",
  "wins",
  "losses",
  "highest_round_order",
  "highest_round_name",
  "last_match_id",
  "last_match_status",
  "status",
  "live_points",
  "collected_at",
];

const WEEK_RESULTS_SUMMARY_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "events_found",
  "matches_found",
  "errors_found",
  "raw_file",
  "from_cache",
  "collected_at",
];

const WEEK_RESULTS_ERRORS_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "player_type_code",
  "player_type_desc",
  "match_type_code",
  "match_type_desc",
  "event_classification_code",
  "event_classification_desc",
  "drawsheet_structure_code",
  "error_message",
  "collected_at",
];

const WEEK_LIVE_POINTS_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "start_date",
  "end_date",
  "player_id",
  "player_name",
  "nationality",
  "player_type_code",
  "player_type_desc",
  "event_type",
  "event_classification",
  "matches_played",
  "wins",
  "losses",
  "highest_round_order",
  "highest_round_name",
  "total_rounds_in_draw",
  "calculated_round_label",
  "status",
  "live_points_raw",
  "live_points_weighted",
  "collected_at",
];

const WEEK_LIVE_LEDGER_COLUMNS = LEDGER_COLUMNS;

function nowIso(date = new Date()) {
  return date.toISOString();
}

export function todayIso(date = new Date()) {
  return nowIso(date).slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentMonday(dateText = todayIso()) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getArg(name, argv = process.argv.slice(2), fallback = "") {
  const prefix = `--${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const action = cleanText(getArg("action", argv)).toLowerCase();
  const mode = cleanText(getArg("mode", argv, MODE_DRY_RUN)).toLowerCase();
  const confirm =
    cleanText(getArg("confirm", argv, "false")).toLowerCase() === "true";

  if (![ACTION_STATUS, ACTION_CLOSE, ACTION_START].includes(action)) {
    throw new Error(
      "Use --action=status, --action=close ou --action=start."
    );
  }

  if (![MODE_DRY_RUN, MODE_APPLY].includes(mode)) {
    throw new Error("Use --mode=dry-run ou --mode=apply.");
  }

  return {
    action,
    weekStart: cleanText(getArg("week-start", argv)),
    weekEnd: cleanText(getArg("week-end", argv)),
    mode,
    confirm,
  };
}

export function resolvePaths(cwd = process.cwd()) {
  const cleanDir = path.join(cwd, "data", "clean");
  const exportsDir = path.join(cwd, "data", "exports");
  const auditDir = path.join(cwd, "data", "audit");
  const stagingDir = path.join(cwd, "data", "staging", "weekly_operation");

  return {
    cleanDir,
    exportsDir,
    auditDir,
    stagingDir,
    players: path.join(cleanDir, "players.csv"),
    snapshot: path.join(cleanDir, "rankings_snapshot.csv"),
    ledger: path.join(cleanDir, "points_ledger.csv"),
    weekTournaments: path.join(cleanDir, "week_tournaments.csv"),
    weekMatches: path.join(cleanDir, "week_matches.csv"),
    weekPlayerResults: path.join(cleanDir, "week_player_results.csv"),
    weekResultsErrors: path.join(cleanDir, "week_results_errors.csv"),
    weekResultsSummary: path.join(cleanDir, "week_results_summary.csv"),
    weekLivePoints: path.join(cleanDir, "week_live_points.csv"),
    weekLiveLedger: path.join(cleanDir, "week_live_ledger_rows.csv"),
    liveRanking: path.join(cleanDir, "live_ranking_with_drops.csv"),
    liveTop500: path.join(cleanDir, "live_ranking_with_drops_top500.csv"),
    liveChanges: path.join(cleanDir, "live_ranking_with_drops_changes.csv"),
    liveCombined: path.join(cleanDir, "live_combined_ledger_with_drops.csv"),
    liveDropped: path.join(cleanDir, "live_dropped_points.csv"),
    liveExternalPlayersIgnored: path.join(
      cleanDir,
      "live_external_players_ignored.csv"
    ),
    liveExternalLedgerIgnored: path.join(
      cleanDir,
      "live_external_ledger_rows_ignored.csv"
    ),
    externalCandidates: path.join(cleanDir, "external_candidates.csv"),
    externalCandidateLedger: path.join(cleanDir, "external_candidate_ledger.csv"),
    externalCandidateErrors: path.join(cleanDir, "external_candidate_errors.csv"),
    liveExternalPlayersIncluded: path.join(
      cleanDir,
      "live_external_players_included.csv"
    ),
    html: path.join(exportsDir, "live_ranking.html"),
    auditSummary: path.join(auditDir, "player_audit_summary.csv"),
    lastOperation: path.join(stagingDir, "last_operation.json"),
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

async function readCsvIfExists(filePath) {
  if (!(await fileExists(filePath))) return [];
  return readCsv(filePath);
}

async function writeCsv(filePath, rows, columns) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function nonEmptyTournamentRows(rows) {
  return rows.filter(
    (row) =>
      cleanText(row.tournament_id) ||
      cleanText(row.tournament_key) ||
      cleanText(row.tournament_name)
  );
}

function validatePlayersBase(playersRows) {
  const expectedTotal = getActiveBaseTotal();
  const expectedPerGender = getActiveBaseLimitPerGender();
  const ids = playersRows.map((row) => cleanText(row.player_id));
  const uniqueIds = new Set(ids.filter(Boolean));
  const genderCounts = playersRows.reduce((acc, row) => {
    const gender = normalizeGender(row.gender);
    acc[gender] = (acc[gender] || 0) + 1;
    return acc;
  }, {});
  const errors = [];

  if (playersRows.length !== expectedTotal) {
    errors.push(`players.csv possui ${playersRows.length} linhas.`);
  }
  if (uniqueIds.size !== playersRows.length) {
    errors.push("players.csv possui IDs vazios ou duplicados.");
  }
  if (
    (genderCounts.M || 0) !== expectedPerGender ||
    (genderCounts.F || 0) !== expectedPerGender
  ) {
    errors.push(
      `players.csv precisa ter ${expectedPerGender} M e ${expectedPerGender} F, mas possui M=${genderCounts.M || 0} e F=${genderCounts.F || 0}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    count: playersRows.length,
    trackedPlayerIds: uniqueIds,
  };
}

function validateSnapshotBase(playersRows, snapshotRows, expectedRankingDate) {
  const expectedTotal = getActiveBaseTotal();
  const expectedPerGender = getActiveBaseLimitPerGender();
  const playerIds = new Set(
    playersRows.map((row) => cleanText(row.player_id)).filter(Boolean)
  );
  const snapshotIds = snapshotRows.map((row) => cleanText(row.player_id));
  const uniqueSnapshotIds = new Set(snapshotIds.filter(Boolean));
  const genderCounts = snapshotRows.reduce((acc, row) => {
    const gender = normalizeGender(row.gender);
    acc[gender] = (acc[gender] || 0) + 1;
    return acc;
  }, {});
  const errors = [];

  if (snapshotRows.length !== expectedTotal) {
    errors.push(`rankings_snapshot.csv possui ${snapshotRows.length} linhas.`);
  }
  if (uniqueSnapshotIds.size !== snapshotRows.length) {
    errors.push("rankings_snapshot.csv possui IDs vazios ou duplicados.");
  }
  if ([...uniqueSnapshotIds].some((playerId) => !playerIds.has(playerId))) {
    errors.push("rankings_snapshot.csv contem jogadores fora de players.csv.");
  }
  if (
    (genderCounts.M || 0) !== expectedPerGender ||
    (genderCounts.F || 0) !== expectedPerGender
  ) {
    errors.push(
      `rankings_snapshot.csv precisa ter ${expectedPerGender} M e ${expectedPerGender} F, mas possui M=${genderCounts.M || 0} e F=${genderCounts.F || 0}.`
    );
  }
  for (const gender of ["M", "F"]) {
    const ranks = snapshotRows
      .filter((row) => normalizeGender(row.gender) === gender)
      .map((row) => Number(cleanText(row.rank)))
      .sort((a, b) => a - b);
    if (ranks.length !== expectedPerGender) continue;
    for (let index = 0; index < ranks.length; index += 1) {
      if (ranks[index] !== index + 1) {
        errors.push(`rankings_snapshot.csv possui ranks invalidos para ${gender}.`);
        break;
      }
    }
  }
  if (
    snapshotRows.some(
      (row) => cleanText(row.ranking_date) !== cleanText(expectedRankingDate)
    )
  ) {
    errors.push(`rankings_snapshot.csv possui ranking_date diferente de ${expectedRankingDate}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    countsByGender: genderCounts,
  };
}

function validateLedgerBase(ledgerRows, trackedPlayerIds) {
  const expectedTotal = getActiveBaseTotal();
  const playerIds = new Set(
    ledgerRows.map((row) => cleanText(row.player_id)).filter(Boolean)
  );
  const errors = [];

  if (ledgerRows.length === 0) {
    errors.push("points_ledger.csv esta vazio.");
  }
  if (playerIds.size !== expectedTotal) {
    errors.push(`points_ledger.csv possui ${playerIds.size} jogadores unicos.`);
  }
  if ([...playerIds].some((playerId) => !trackedPlayerIds.has(playerId))) {
    errors.push("points_ledger.csv contem jogadores fora da base oficial.");
  }

  return {
    valid: errors.length === 0,
    errors,
    rows: ledgerRows.length,
    uniquePlayers: playerIds.size,
    rowsData: ledgerRows,
  };
}

function validateLiveRanking(rankingRows, trackedPlayerIds) {
  const expectedTotal = getActiveBaseTotal();
  const expectedPerGender = getActiveBaseLimitPerGender();
  const ids = rankingRows.map((row) => cleanText(row.player_id));
  const uniqueIds = new Set(ids.filter(Boolean));
  const genderCounts = rankingRows.reduce((acc, row) => {
    const gender = normalizeGender(row.gender);
    acc[gender] = (acc[gender] || 0) + 1;
    return acc;
  }, {});
  const externalRows = rankingRows.filter(
    (row) => !trackedPlayerIds.has(cleanText(row.player_id))
  );
  const errors = [];

  if (rankingRows.length < expectedTotal) {
    errors.push(`live_ranking_with_drops.csv possui ${rankingRows.length} linhas.`);
  }
  if (uniqueIds.size !== rankingRows.length) {
    errors.push("Ranking live possui IDs vazios ou duplicados.");
  }
  if (
    (genderCounts.M || 0) < expectedPerGender ||
    (genderCounts.F || 0) < expectedPerGender
  ) {
    errors.push(
      `Ranking live precisa ter ao menos ${expectedPerGender} M e ${expectedPerGender} F, mas possui M=${genderCounts.M || 0} e F=${genderCounts.F || 0}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    count: rankingRows.length,
    externalRows,
  };
}

function detectWeekWindow(weekTournamentRows) {
  const weekStarts = unique(
    weekTournamentRows.map((row) => cleanText(row.week_start))
  );
  const weekEnds = unique(
    weekTournamentRows.map((row) => cleanText(row.week_end))
  );

  return {
    weekStart: weekStarts.length === 1 ? weekStarts[0] : "",
    weekEnd: weekEnds.length === 1 ? weekEnds[0] : "",
  };
}

function buildCompletionInfo(facts, today) {
  return summarizeWeekCompletion({
    weekTournamentRows: facts.week.rows.tournaments,
    weekMatchesRows: facts.week.rows.matches,
    weekResultsSummaryRows: facts.week.rows.summary,
    weekResultsErrorsRows: facts.week.rows.errors,
    currentDate: today,
    weekEnd: facts.week.weekEnd,
    liveRankingValid: facts.liveRanking.valid,
    officialBaseValid:
      facts.players.valid && facts.snapshot.valid && facts.ledger.valid,
  });
}

export function buildStatusSummary(facts, today = todayIso()) {
  const mondayToday = currentMonday(today);
  const officialDate = facts.officialRankingDate;
  const weekStart = facts.week.weekStart;
  const weekEnd = facts.week.weekEnd;
  const hasLoadedWeek = Boolean(weekStart && weekEnd);

  if (!facts.players.valid || !facts.snapshot.valid || !facts.ledger.valid) {
    return {
      status: STATUS_INVALID,
      nextAction: "Corrija a base oficial antes de continuar.",
      errors: [
        ...facts.players.errors,
        ...facts.snapshot.errors,
        ...facts.ledger.errors,
      ],
      warnings: [],
    };
  }

  if (!officialDate) {
    return {
      status: STATUS_INVALID,
      nextAction: "Corrija rankings_snapshot.csv antes de continuar.",
      errors: ["Nao foi possivel identificar a data da base oficial."],
      warnings: [],
    };
  }

  if (hasLoadedWeek && weekStart === officialDate) {
    if (facts.week.matches === 0 && facts.week.results === 0 && facts.week.liveResults === 0) {
      return {
        status: STATUS_NEW_WEEK_READY,
        nextAction: "Durante a semana, use npm run update.",
        errors: [],
        warnings: [],
      };
    }

    if (today <= weekEnd) {
      if (facts.completion.all_events_complete) {
        return {
          status: STATUS_WEEK_COMPLETE_WAITING_END_DATE,
          nextAction:
            "Aguarde o fim oficial da semana. Continue usando npm run update para capturar eventuais correcoes.",
          errors: [],
          warnings: [],
        };
      }

      return {
        status: STATUS_WEEK_IN_PROGRESS,
        nextAction: "Durante a semana, use npm run update.",
        errors: [],
        warnings: [],
      };
    }

    if (
      facts.completion.results_errors > 0 ||
      facts.completion.events_review_required > 0 ||
      (facts.completion.blocking_missing_events ?? facts.completion.missing_events) > 0
    ) {
      return {
        status: STATUS_WEEK_CLOSE_BLOCKED,
        nextAction: "Revise os eventos indicados antes do fechamento.",
        errors: [],
        warnings: [],
      };
    }

    if (facts.completion.safe_to_close) {
      return {
        status: STATUS_WEEK_READY_TO_CLOSE,
        nextAction: `npm run weekly:close -- --week-start=${weekStart} --week-end=${weekEnd} --mode=dry-run`,
        errors: [],
        warnings: [],
      };
    }

    if (
      facts.completion.events_pending > 0 ||
      facts.completion.pending_matches > 0
    ) {
      return {
        status: STATUS_WEEK_ENDED_WITH_PENDING_RESULTS,
        nextAction:
          "Execute npm run update e consulte novamente o status. Nao feche a semana ainda.",
        errors: [],
        warnings: [],
      };
    }

    return {
      status: STATUS_WEEK_CLOSE_BLOCKED,
      nextAction: "Revise os eventos indicados antes do fechamento.",
      errors: [],
      warnings: [],
    };
  }

  if (officialDate === mondayToday) {
    return {
      status: STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START,
      nextAction: `npm run weekly:start -- --week-start=${officialDate} --week-end=${addDays(officialDate, 6)} --mode=dry-run`,
      errors: [],
      warnings: [],
    };
  }

  if (
    hasLoadedWeek &&
    weekStart < mondayToday &&
    officialDate < mondayToday &&
    today > weekEnd
  ) {
    return {
      status: STATUS_WEEK_CLOSED_WAITING_OFFICIAL_RANKING,
      nextAction:
        "Aguarde o ranking oficial de segunda-feira e execute a validacao oficial no GitHub Actions.",
      errors: [],
      warnings: [],
    };
  }

  return {
    status: STATUS_INVALID,
    nextAction: "Nao foi possivel determinar a proxima acao com seguranca.",
    errors: [
      `Base oficial: ${officialDate || "(vazia)"}. Semana carregada: ${
        hasLoadedWeek ? `${weekStart} a ${weekEnd}` : "(nenhuma)"
      }.`,
    ],
    warnings: [],
  };
}

export async function gatherFacts({ cwd = process.cwd(), today = todayIso() } = {}) {
  const paths = resolvePaths(cwd);
  const playersRows = await readCsvIfExists(paths.players);
  const snapshotRows = await readCsvIfExists(paths.snapshot);
  const ledgerRows = await readCsvIfExists(paths.ledger);
  const weekTournamentRows = await readCsvIfExists(paths.weekTournaments);
  const weekMatchesRows = await readCsvIfExists(paths.weekMatches);
  const weekPlayerResultsRows = await readCsvIfExists(paths.weekPlayerResults);
  const weekLiveLedgerRows = await readCsvIfExists(paths.weekLiveLedger);
  const weekResultsErrorsRows = await readCsvIfExists(paths.weekResultsErrors);
  const weekResultsSummaryRows = await readCsvIfExists(paths.weekResultsSummary);
  const ignoredExternalPlayersRows = await readCsvIfExists(
    paths.liveExternalPlayersIgnored
  );
  const liveRankingRows = await readCsvIfExists(paths.liveRanking);

  const playersValidation = validatePlayersBase(playersRows);
  const trackedPlayerIds = playersValidation.trackedPlayerIds;
  const snapshotValidation = validateSnapshotBase(
    playersRows,
    snapshotRows,
    cleanText(snapshotRows[0]?.ranking_date)
  );
  const ledgerValidation = validateLedgerBase(ledgerRows, trackedPlayerIds);
  const liveRankingValidation = validateLiveRanking(
    liveRankingRows,
    trackedPlayerIds
  );
  const weekWindow = detectWeekWindow(weekTournamentRows);
  const officialRankingDate = cleanText(snapshotRows[0]?.ranking_date);
  const weekTournamentsCount = nonEmptyTournamentRows(weekTournamentRows).length;

  const facts = {
    cwd,
    today,
    paths,
    officialRankingDate,
    playersRows,
    snapshotRows,
    players: playersValidation,
    snapshot: {
      valid: snapshotValidation.valid,
      errors: snapshotValidation.errors,
      count: snapshotRows.length,
    },
    ledger: ledgerValidation,
    week: {
      weekStart: weekWindow.weekStart,
      weekEnd: weekWindow.weekEnd,
      tournaments: weekTournamentsCount,
      matches: weekMatchesRows.length,
      results: weekPlayerResultsRows.length,
      liveResults: weekLiveLedgerRows.length,
      errors: weekResultsErrorsRows.length,
      rows: {
        tournaments: weekTournamentRows,
        matches: weekMatchesRows,
        results: weekPlayerResultsRows,
        live: weekLiveLedgerRows,
        errors: weekResultsErrorsRows,
        summary: weekResultsSummaryRows,
      },
    },
    liveRanking: {
      valid: liveRankingValidation.valid,
      errors: liveRankingValidation.errors,
      count: liveRankingValidation.count,
      externalRows: liveRankingValidation.externalRows,
      rows: liveRankingRows,
    },
    ignoredExternalPlayers: ignoredExternalPlayersRows.length,
  };

  facts.completion = buildCompletionInfo(facts, today);

  const summary = buildStatusSummary(facts, today);
  facts.status = summary.status;
  facts.nextAction = summary.nextAction;
  facts.statusErrors = summary.errors;
  facts.statusWarnings = summary.warnings;

  return facts;
}

function buildConsoleSummary({
  status,
  officialRankingDate,
  weekStart,
  weekEnd,
  playersCount,
  errors,
  nextAction,
}) {
  return [
    "---",
    "",
    `STATUS: ${status}`,
    `Base oficial: ${officialRankingDate || "(nao encontrada)"}`,
    `Semana: ${
      weekStart && weekEnd ? `${weekStart} a ${weekEnd}` : "(nao carregada)"
    }`,
    `Jogadores: ${playersCount}`,
    `Erros: ${errors.length}`,
    "",
    "Proxima acao:",
    nextAction,
    "------------------------------------------------------------------------------------",
  ].join("\n");
}

function buildPendingItemsText(items, limit = 10) {
  if (!items.length) return "";

  const lines = ["", "Pendencias:"];
  for (const item of items.slice(0, limit)) {
    lines.push(
      `- ${item.tournament_name || "(sem torneio)"} | ${item.event_id || "(sem event_id)"} | ${item.player_type_desc || "-"} | ${item.match_type_desc || "-"} | ${item.reason}`
    );
  }

  if (items.length > limit) {
    lines.push(`- ... ${items.length - limit} pendencias adicionais omitidas`);
  }

  return lines.join("\n");
}

async function defaultRunNodeScript({ cwd, scriptPath, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }

      reject(
        new Error(
          `Script ${scriptPath} falhou com codigo ${code}.\n${stderr || stdout}`
        )
      );
    });
  });
}

export async function validateOfficialReconciliationReady(facts, rankingDate) {
  const calculatedRows = calculateLedgerPoints(facts.ledger.rowsData, {
    policy: STAGED_POLICY,
    dropCutoff: addDays(rankingDate, -1),
  });
  const baseline = compareCalculatedAgainstSnapshot(
    calculatedRows,
    facts.snapshotRows,
    { baselinePolicy: STAGED_POLICY }
  );

  return {
    valid: baseline.valid && baseline.exact === facts.snapshotRows.length,
    exact: baseline.exact,
    total: baseline.total,
    baseline,
  };
}

function assertWeekArgs(args) {
  if (!isIsoDate(args.weekStart) || !isIsoDate(args.weekEnd)) {
    throw new Error(
      "Informe --week-start=YYYY-MM-DD e --week-end=YYYY-MM-DD."
    );
  }
}

async function readCloseReport(cwd, weekEnd) {
  const reportFile = path.join(
    cwd,
    "data",
    "staging",
    `week_close_${weekEnd}`,
    "close_week_report.json"
  );
  return JSON.parse(await fs.readFile(reportFile, "utf8"));
}

async function initializeNewWeekArtifacts(paths, weekStart, weekEnd) {
  const searchStart = addDays(weekStart, -2);
  const collectedAt = nowIso();

  await writeCsv(
    paths.weekTournaments,
    [
      {
        week_start: weekStart,
        week_end: weekEnd,
        search_start: searchStart,
        search_end: weekEnd,
        tournament_id: "",
        tournament_key: "",
        tournament_name: "",
        promotional_name: "",
        category: "",
        host_nation: "",
        host_nation_code: "",
        location: "",
        venue: "",
        start_date: weekStart,
        end_date: weekEnd,
        dates_raw: "",
        surface: "",
        surface_code: "",
        indoor_outdoor: "",
        tournament_link: "",
        live_link: "",
        source_url: "",
        collected_at: collectedAt,
        raw_json: "{}",
      },
    ],
    WEEK_TOURNAMENTS_COLUMNS
  );
  await writeCsv(paths.weekMatches, [], WEEK_MATCHES_COLUMNS);
  await writeCsv(paths.weekPlayerResults, [], WEEK_PLAYER_RESULTS_COLUMNS);
  await writeCsv(paths.weekResultsSummary, [], WEEK_RESULTS_SUMMARY_COLUMNS);
  await writeCsv(paths.weekResultsErrors, [], WEEK_RESULTS_ERRORS_COLUMNS);
  await writeCsv(paths.weekLivePoints, [], WEEK_LIVE_POINTS_COLUMNS);
  await writeCsv(paths.weekLiveLedger, [], WEEK_LIVE_LEDGER_COLUMNS);
}

async function runInitialLiveCalculation(paths, weekEnd) {
  const playersRows = await readCsv(paths.players);
  const snapshotRows = await readCsv(paths.snapshot);
  const ledgerRows = await readCsv(paths.ledger);
  const snapshotMap = buildSnapshotMap(snapshotRows);
  const { activeRows, droppedRows } = mergeLedgersWithDrops(
    ledgerRows,
    [],
    weekEnd
  );
  const rankingRows = buildTrackedRankingRows({
    playersRows,
    snapshotMap,
    activeRows,
    droppedRows,
  });
  const top500Rows = rankingRows.filter(
    (row) => toNumber(row.live_rank) <= DISPLAY_LIMIT_PER_GENDER
  );
  const changesRows = rankingRows.filter(
    (row) =>
      cleanText(row.has_live_result) === "true" ||
      cleanText(row.has_dropped_result) === "true"
  );

  await writeCsv(paths.liveCombined, activeRows, [
    ...LEDGER_COLUMNS,
    "source_type",
  ]);
  await writeCsv(paths.liveDropped, droppedRows, [
    ...LEDGER_COLUMNS,
    "drop_cutoff_date",
    "drop_reason",
    "source_type",
  ]);
  await writeCsv(paths.liveRanking, rankingRows, Object.keys(rankingRows[0] || {}));
  await writeCsv(paths.liveTop500, top500Rows, Object.keys(rankingRows[0] || {}));
  await writeCsv(paths.liveChanges, changesRows, Object.keys(changesRows[0] || {}));
  await writeCsv(paths.liveExternalPlayersIgnored, [], [
    "player_id",
    "player_name",
    "gender",
    "country",
    "week_rows",
    "singles_rows",
    "doubles_rows",
    "raw_live_points",
    "tournaments",
    "ignore_reason",
  ]);
  await writeCsv(paths.liveExternalLedgerIgnored, [], WEEK_LIVE_LEDGER_COLUMNS);
  await writeCsv(paths.externalCandidates, [], [
    "player_id",
    "player_name",
    "gender",
    "country",
    "official_rank",
    "official_points",
    "guaranteed_upper_bound",
    "maximum_upper_bound",
    "top500_cutoff_points",
    "investigation_cutoff_points",
    "candidate_status",
    "breakdown_required",
    "breakdown_fetched",
    "reason",
    "updated_at",
  ]);
  await writeCsv(paths.externalCandidateLedger, [], LEDGER_COLUMNS);
  await writeCsv(paths.externalCandidateErrors, [], [
    "player_id",
    "player_name",
    "candidate_status",
    "error_message",
    "updated_at",
  ]);
  await writeCsv(paths.liveExternalPlayersIncluded, [], [
    "player_id",
    "player_name",
    "gender",
    "official_rank",
    "official_points",
    "live_rank",
    "live_points",
    "rank_change",
    "entered_top500",
    "candidate_status",
    "tournaments",
  ]);
}

export async function runStatusAction({ facts }) {
  const output = [
    `Base oficial atual: ${facts.officialRankingDate || "(nao encontrada)"}`,
    `Jogadores na base: ${facts.players.count}`,
    `Linhas no ledger: ${facts.ledger.rows}`,
    `Semana carregada: ${
      facts.week.weekStart && facts.week.weekEnd
        ? `${facts.week.weekStart} a ${facts.week.weekEnd}`
        : "(nenhuma)"
    }`,
    `Torneios: ${facts.week.tournaments}`,
    `Partidas: ${facts.week.matches}`,
    `Resultados: ${facts.week.results}`,
    `Resultados live: ${facts.week.liveResults}`,
    `Ranking live valido: ${facts.liveRanking.valid ? "sim" : "nao"}`,
    `Jogadores externos ignorados: ${facts.ignoredExternalPlayers}`,
    `Torneios concluidos: ${facts.completion.tournaments_completed}/${facts.completion.tournaments_total}`,
    `Eventos concluidos: ${facts.completion.events_completed}/${facts.completion.events_total}`,
    `Campeoes identificados: ${facts.completion.champions_found}`,
    `Eventos pendentes: ${facts.completion.events_pending}`,
    `Eventos para revisao: ${facts.completion.events_review_required}`,
    `Eventos ausentes: ${facts.completion.missing_events}`,
    `Eventos ausentes tolerados: ${facts.completion.tolerated_missing_events || 0}`,
    `Partidas pendentes: ${facts.completion.pending_matches}`,
    `Erros de coleta: ${facts.completion.results_errors}`,
    `Pronto para fechamento: ${facts.completion.safe_to_close ? "sim" : "nao"}`,
    `Proxima acao recomendada: ${facts.nextAction}`,
  ].join("\n");

  return {
    status: facts.status,
    output: `${output}${buildPendingItemsText(facts.completion.pending_items)}`,
    validationPassed: facts.statusErrors.length === 0,
    errors: facts.statusErrors,
    warnings: facts.statusWarnings,
    officialRankingDate: facts.officialRankingDate,
    weekStart: facts.week.weekStart,
    weekEnd: facts.week.weekEnd,
    nextAction: facts.nextAction,
    completion: facts.completion,
  };
}

export async function runCloseAction({ args, facts, runNodeScript }) {
  assertWeekArgs(args);
  const errors = [];

  if (facts.week.weekStart !== args.weekStart || facts.week.weekEnd !== args.weekEnd) {
    errors.push(
      `A semana informada (${args.weekStart} a ${args.weekEnd}) nao corresponde a week_tournaments.csv (${facts.week.weekStart} a ${facts.week.weekEnd}).`
    );
  }
  if (!facts.completion.safe_to_close) {
    errors.push(
      `Fechamento bloqueado: safe_to_close=false. Pendencias: eventos_pendentes=${facts.completion.events_pending}, eventos_revisao=${facts.completion.events_review_required}, eventos_ausentes_bloqueantes=${facts.completion.blocking_missing_events ?? facts.completion.missing_events}, partidas_pendentes=${facts.completion.pending_matches}, erros_coleta=${facts.completion.results_errors}.`
    );
  }
  if (!(await fileExists(facts.paths.weekPlayerResults))) {
    errors.push("week_player_results.csv nao existe.");
  }
  if (!(await fileExists(facts.paths.weekLiveLedger))) {
    errors.push("week_live_ledger_rows.csv nao existe.");
  }
  if (facts.week.errors > 0) {
    errors.push(`week_results_errors.csv possui ${facts.week.errors} linhas.`);
  }
  if (!facts.players.valid) {
    errors.push(...facts.players.errors);
  }
  if (!facts.snapshot.valid) {
    errors.push(...facts.snapshot.errors);
  }
  if (!facts.ledger.valid) {
    errors.push(...facts.ledger.errors);
  }
  if (!facts.liveRanking.valid) {
    errors.push(...facts.liveRanking.errors);
  }
  if (facts.liveRanking.externalRows.length > 0) {
    errors.push("Nenhuma linha externa pode entrar no ranking live.");
  }
  if (args.mode === MODE_APPLY && !args.confirm) {
    errors.push("Apply bloqueado. Use --confirm=true.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await runNodeScript({
    cwd: facts.cwd,
    scriptPath: "scripts/16_close_week.mjs",
    args: [
      "--source-dir=data/clean",
      `--week-start=${args.weekStart}`,
      `--week-end=${args.weekEnd}`,
      `--mode=${args.mode}`,
      `--confirm-closed-week=${args.mode === MODE_APPLY && args.confirm ? "true" : "false"}`,
    ],
  });

  const report = await readCloseReport(facts.cwd, args.weekEnd);
  const nextAction =
    args.mode === MODE_APPLY
      ? "Semana fechada. Agora aguarde/publicar o ranking oficial de segunda-feira e execute a validacao oficial no GitHub Actions."
      : report.mode_safe_for_apply
        ? `npm run weekly:close -- --week-start=${args.weekStart} --week-end=${args.weekEnd} --mode=apply --confirm=true`
        : "Corrija os bloqueios do fechamento antes do apply.";

  return {
    status: facts.status,
    output: [
      `Linhas da semana: ${report.live_rows_received}`,
      `Linhas aceitas: ${report.tracked_rows_eligible}`,
      `Externos ignorados: ${report.untracked_rows_rejected}`,
      `Jogadores afetados: ${report.players_affected}`,
      `Linhas que serao adicionadas: ${report.rows_added}`,
      `Validacao: ${report.validation_passed ? "OK" : "FALHOU"}`,
      `Seguranca para apply: ${report.mode_safe_for_apply ? "SIM" : "NAO"}`,
    ].join("\n"),
    validationPassed: report.validation_passed,
    errors: [...(report.safety_errors || []), ...(report.validation_errors || [])],
    warnings: report.warnings || [],
    officialRankingDate: facts.officialRankingDate,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    nextAction,
    completion: facts.completion,
  };
}

export async function runStartAction({ args, facts, runNodeScript }) {
  assertWeekArgs(args);
  const errors = [];

  if (facts.officialRankingDate !== args.weekStart) {
    errors.push(
      `rankings_snapshot.csv esta em ${facts.officialRankingDate}, mas a nova semana informada comeca em ${args.weekStart}.`
    );
  }
  if (addDays(args.weekStart, 6) !== args.weekEnd) {
    errors.push("week-end precisa ser a data de domingo da semana informada.");
  }
  if (!facts.players.valid) {
    errors.push(...facts.players.errors);
  }
  if (!facts.snapshot.valid) {
    errors.push(...facts.snapshot.errors);
  }
  if (!facts.ledger.valid) {
    errors.push(...facts.ledger.errors);
  }

  const reconciliation = await validateOfficialReconciliationReady(
    facts,
    args.weekStart
  );

  if (!reconciliation.valid) {
    const expectedTotal = getActiveBaseTotal();
    errors.push(
      `A base oficial nao reconciliou ${expectedTotal}/${expectedTotal} (${reconciliation.exact}/${reconciliation.total}).`
    );
  }
  if (
    facts.status === STATUS_WEEK_READY_TO_CLOSE ||
    facts.status === STATUS_WEEK_CLOSE_BLOCKED ||
    facts.status === STATUS_WEEK_ENDED_WITH_PENDING_RESULTS
  ) {
    errors.push(
      "Existe um fechamento pendente da semana anterior antes de iniciar a nova semana."
    );
  }
  if (args.mode === MODE_APPLY && !args.confirm) {
    errors.push("Apply bloqueado. Use --confirm=true.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await runNodeScript({
    cwd: facts.cwd,
    scriptPath: "scripts/13_start_week.mjs",
    args: [
      "--skip-reconcile",
      "--skip-fetch",
      ...(args.mode === MODE_DRY_RUN ? ["--dry-run"] : []),
    ],
  });

  if (args.mode === MODE_APPLY) {
    await initializeNewWeekArtifacts(facts.paths, args.weekStart, args.weekEnd);
    await runInitialLiveCalculation(facts.paths, args.weekEnd);
  }

  return {
    status:
      args.mode === MODE_APPLY
        ? STATUS_NEW_WEEK_READY
        : STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START,
    output: [
      `Base oficial reconciliada: ${reconciliation.exact}/${reconciliation.total}`,
      `Modo: ${args.mode}`,
      `Nova semana: ${args.weekStart} a ${args.weekEnd}`,
      args.mode === MODE_DRY_RUN
        ? "Dry-run concluido. Nada foi alterado."
        : "Nova semana iniciada e ranking inicial recalculado sem scraping.",
    ].join("\n"),
    validationPassed: true,
    errors: [],
    warnings: [],
    officialRankingDate: facts.officialRankingDate,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    nextAction:
      args.mode === MODE_APPLY
        ? "Durante a semana, use npm run update."
        : `npm run weekly:start -- --week-start=${args.weekStart} --week-end=${args.weekEnd} --mode=apply --confirm=true`,
    completion: facts.completion,
  };
}

function buildErrorReport(args, facts, startedAt, finishedAt, errorMessage) {
  return {
    action: args.action,
    status: STATUS_INVALID,
    official_ranking_date: facts?.officialRankingDate || "",
    week_start:
      cleanText(args.weekStart) || facts?.week?.weekStart || "",
    week_end: cleanText(args.weekEnd) || facts?.week?.weekEnd || "",
    mode: args.mode,
    validation_passed: false,
    next_action: "Corrija os erros antes de continuar.",
    errors: [errorMessage],
    warnings: [],
    completion: facts?.completion || null,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}

export async function runWeeklyOperation(args, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const today = deps.today || todayIso();
  const startedAt = deps.startedAt || nowIso();
  const runNodeScript = deps.runNodeScript || defaultRunNodeScript;
  let facts = null;

  try {
    facts = await gatherFacts({ cwd, today });
    let result;

    if (args.action === ACTION_STATUS) {
      result = await runStatusAction({ facts });
    } else if (args.action === ACTION_CLOSE) {
      result = await runCloseAction({ args, facts, runNodeScript });
    } else {
      result = await runStartAction({ args, facts, runNodeScript });
    }

    const report = {
      action: args.action,
      status: result.status,
      official_ranking_date: result.officialRankingDate || "",
      week_start: result.weekStart || "",
      week_end: result.weekEnd || "",
      mode: args.mode,
      validation_passed: result.validationPassed,
      next_action: result.nextAction,
      errors: result.errors || [],
      warnings: result.warnings || [],
      completion: result.completion || facts.completion,
      started_at: startedAt,
      finished_at: deps.finishedAt || nowIso(),
    };

    await writeJson(resolvePaths(cwd).lastOperation, report);

    const summaryBlock = buildConsoleSummary({
      status: report.status,
      officialRankingDate: report.official_ranking_date,
      weekStart: report.week_start,
      weekEnd: report.week_end,
      playersCount: facts.players.count,
      errors: report.errors,
      nextAction: report.next_action,
    });

    return {
      facts,
      report,
      output: `${result.output}\n\n${summaryBlock}\n`,
    };
  } catch (error) {
    const report = buildErrorReport(
      args,
      facts,
      startedAt,
      deps.finishedAt || nowIso(),
      error?.message || String(error)
    );

    await writeJson(resolvePaths(cwd).lastOperation, report);

    const summaryBlock = buildConsoleSummary({
      status: report.status,
      officialRankingDate: report.official_ranking_date,
      weekStart: report.week_start,
      weekEnd: report.week_end,
      playersCount: facts?.players?.count || 0,
      errors: report.errors,
      nextAction: report.next_action,
    });

    error.report = report;
    error.output = `${summaryBlock}\n`;
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runWeeklyOperation(args);
  process.stdout.write(result.output);
}

const isCli = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCli) {
  main().catch((error) => {
    if (error?.output) {
      process.stderr.write(error.output);
    }
    console.error(error?.message || error);
    process.exit(1);
  });
}
