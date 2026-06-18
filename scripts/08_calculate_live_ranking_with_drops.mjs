import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  buildResultKey as buildWeeklyLedgerResultKey,
} from "./lib/weekly_ledger.mjs";
import {
  DISPLAY_LIMIT_PER_GENDER,
  getActiveBaseLimitPerGender,
  getActiveBaseTotal,
} from "./lib/ranking_limits.mjs";
import {
  EXTERNAL_CANDIDATE_COLUMNS,
  LIVE_EXTERNAL_INCLUDED_COLUMNS,
  STATUS_FETCHED,
  STATUS_INCLUDED,
} from "./lib/external_candidates.mjs";

const PLAYERS_FILE = path.resolve("data/clean/players.csv");
const POINTS_LEDGER_FILE = path.resolve("data/clean/points_ledger.csv");
const WEEK_LIVE_LEDGER_FILE = path.resolve(
  "data/clean/week_live_ledger_rows.csv"
);
const RANKINGS_SNAPSHOT_FILE = path.resolve("data/clean/rankings_snapshot.csv");
const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");

const OUT_DIR_CLEAN = path.resolve("data/clean");

const LIVE_COMBINED_WITH_DROPS_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_combined_ledger_with_drops.csv"
);

const LIVE_DROPPED_POINTS_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_dropped_points.csv"
);

const LIVE_RANKING_WITH_DROPS_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_ranking_with_drops.csv"
);

const LIVE_RANKING_WITH_DROPS_TOP500_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_ranking_with_drops_top500.csv"
);

const LIVE_RANKING_WITH_DROPS_CHANGES_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_ranking_with_drops_changes.csv"
);

const LIVE_EXTERNAL_PLAYERS_IGNORED_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_external_players_ignored.csv"
);

const LIVE_EXTERNAL_LEDGER_ROWS_IGNORED_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_external_ledger_rows_ignored.csv"
);

const EXTERNAL_CANDIDATES_FILE = path.join(OUT_DIR_CLEAN, "external_candidates.csv");
const EXTERNAL_CANDIDATE_LEDGER_FILE = path.join(
  OUT_DIR_CLEAN,
  "external_candidate_ledger.csv"
);
const LIVE_EXTERNAL_PLAYERS_INCLUDED_FILE = path.join(
  OUT_DIR_CLEAN,
  "live_external_players_included.csv"
);

// Regra inicial:
// remove resultados com drop_date_calculated até o fim da semana oficial.
// Para a semana 01/06/2026 a 07/06/2026, remove tudo com drop_date_calculated <= 2026-06-07.
const DROP_CUTOFF_MODE = "week_end";

// Se quiser testar manualmente uma data específica, coloque aqui:
// exemplo: const MANUAL_DROP_CUTOFF_DATE = "2026-06-07";
const MANUAL_DROP_CUTOFF_DATE = "";

const TIE_BREAK_CATEGORIES = ["JGS", "J500", "J300", "J200", "J100", "J60", "J30"];

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

async function readCsvIfExists(filePath) {
  try {
    return await readCsv(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

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

function normalizeGender(value) {
  const text = cleanText(value).toUpperCase();

  if (text === "M" || text === "B" || text === "BOYS") return "M";
  if (text === "F" || text === "G" || text === "GIRLS") return "F";

  return text;
}

function normalizeEventType(value) {
  const text = cleanText(value).toLowerCase();

  if (text === "s" || text === "single" || text === "singles") {
    return "singles";
  }

  if (text === "d" || text === "double" || text === "doubles") {
    return "doubles";
  }

  return text;
}

function parseIsoDate(value) {
  const text = cleanText(value);

  if (!text.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return "";
  }

  return text;
}

function getWeekWindow(weekTournamentRows) {
  const first = weekTournamentRows[0] || {};

  return {
    week_start: parseIsoDate(first.week_start),
    week_end: parseIsoDate(first.week_end),
  };
}

function getDropCutoffDate(weekWindow) {
  if (MANUAL_DROP_CUTOFF_DATE) {
    return MANUAL_DROP_CUTOFF_DATE;
  }

  if (DROP_CUTOFF_MODE === "week_start") {
    return weekWindow.week_start;
  }

  return weekWindow.week_end;
}

function buildSnapshotMap(snapshotRows) {
  const map = new Map();

  for (const row of snapshotRows) {
    const playerId = cleanText(row.player_id);

    if (!playerId) continue;

    map.set(playerId, {
      player_id: playerId,
      player_name: cleanText(row.player_name),
      gender: normalizeGender(row.gender),
      country: cleanText(row.country),
      country_name: cleanText(row.country_name),
      birth_year: cleanText(row.birth_year),

      official_rank: toNumber(row.rank || row.current_rank),
      official_points: toNumber(row.official_points || row.current_points),
      ranking_date: cleanText(row.ranking_date),
    });
  }

  return map;
}

function buildPlayersMap(playersRows) {
  const map = new Map();

  for (const row of playersRows) {
    const playerId = cleanText(row.player_id);

    if (!playerId) continue;

    map.set(playerId, {
      player_id: playerId,
      player_name: cleanText(row.player_name),
      gender: normalizeGender(row.gender),
      country: cleanText(row.country),
      country_name: cleanText(row.country_name),
      birth_year: cleanText(row.birth_year),
    });
  }

  return map;
}

export function validatePlayersBase(playersRows) {
  const errors = [];
  const expectedTotal = getActiveBaseTotal();
  const expectedPerGender = getActiveBaseLimitPerGender();
  const ids = playersRows.map((row) => cleanText(row.player_id));
  const filledIds = ids.filter(Boolean);
  const trackedPlayerIds = new Set(filledIds);
  const genderCounts = playersRows.reduce((acc, row) => {
    const gender = normalizeGender(row.gender);
    acc[gender] = (acc[gender] || 0) + 1;
    return acc;
  }, {});

  if (playersRows.length !== expectedTotal) {
    errors.push(
      `players.csv deve conter ${expectedTotal} linhas, mas possui ${playersRows.length}.`
    );
  }

  if (filledIds.length !== playersRows.length) {
    errors.push(
      `players.csv possui ${playersRows.length - filledIds.length} player_id vazios.`
    );
  }

  if (trackedPlayerIds.size !== playersRows.length) {
    errors.push(
      `players.csv possui ${playersRows.length - trackedPlayerIds.size} player_id duplicados.`
    );
  }

  if (
    (genderCounts.M || 0) !== expectedPerGender ||
    (genderCounts.F || 0) !== expectedPerGender
  ) {
    errors.push(
      `players.csv deve conter ${expectedPerGender} M e ${expectedPerGender} F, mas possui M=${genderCounts.M || 0} e F=${genderCounts.F || 0}.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    trackedPlayerIds,
    genderCounts,
  };
}

export function splitRowsByTrackedPlayerIds(rows, trackedPlayerIds) {
  const trackedRows = [];
  const untrackedRows = [];

  for (const row of rows) {
    const playerId = cleanText(row.player_id);

    if (playerId && trackedPlayerIds.has(playerId)) {
      trackedRows.push(row);
    } else {
      untrackedRows.push(row);
    }
  }

  return {
    trackedRows,
    untrackedRows,
  };
}

function collectColumns(rows, preferredColumns = []) {
  const extraColumns = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!preferredColumns.includes(key)) {
        extraColumns.add(key);
      }
    }
  }

  return [...preferredColumns, ...extraColumns];
}

export function buildIgnoredExternalPlayersRows(untrackedLiveRows) {
  const byPlayer = new Map();

  for (const row of untrackedLiveRows) {
    const playerId = cleanText(row.player_id);

    if (!playerId) continue;

    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, {
        player_id: playerId,
        player_name: cleanText(row.player_name),
        gender: normalizeGender(row.gender),
        country: cleanText(row.country),
        week_rows: 0,
        singles_rows: 0,
        doubles_rows: 0,
        raw_live_points: 0,
        tournaments: new Set(),
        ignore_reason: "player_not_in_official_base",
      });
    }

    const item = byPlayer.get(playerId);
    const eventType = normalizeEventType(row.event_type);

    item.week_rows += 1;
    item.raw_live_points += toNumber(row.points);

    if (eventType === "singles") item.singles_rows += 1;
    if (eventType === "doubles") item.doubles_rows += 1;

    if (cleanText(row.tournament_name)) {
      item.tournaments.add(cleanText(row.tournament_name));
    }
  }

  return [...byPlayer.values()]
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      gender: row.gender,
      country: row.country,
      week_rows: row.week_rows,
      singles_rows: row.singles_rows,
      doubles_rows: row.doubles_rows,
      raw_live_points: Number(row.raw_live_points.toFixed(2)),
      tournaments: [...row.tournaments].sort((a, b) => a.localeCompare(b)).join(" | "),
      ignore_reason: row.ignore_reason,
    }))
    .sort((a, b) => a.player_id.localeCompare(b.player_id));
}

export function getEligibleExternalCandidates(candidateRows, trackedPlayerIds) {
  return candidateRows.filter((row) => {
    const playerId = cleanText(row.player_id);
    if (!playerId || trackedPlayerIds.has(playerId)) return false;
    return [STATUS_FETCHED, STATUS_INCLUDED].includes(cleanText(row.candidate_status));
  });
}

function buildExternalPlayerRows(candidateRows) {
  return candidateRows.map((row) => ({
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    first_name: "",
    last_name: "",
    gender: normalizeGender(row.gender),
    itf_gender_code: normalizeGender(row.gender) === "M" ? "B" : "G",
    country: cleanText(row.country),
    country_name: "",
    birth_date: "",
    birth_year: "",
    junior_last_year: "",
    active_junior: "",
    profile_url: "",
    current_rank: cleanText(row.official_rank),
    current_points: cleanText(row.official_points),
    first_seen_date: "",
    last_seen_date: "",
    raw_json: "",
  }));
}

function buildExternalSnapshotRows(candidateRows, fallbackRankingDate) {
  return candidateRows.map((row) => ({
    ranking_date: cleanText(row.ranking_date) || fallbackRankingDate,
    gender: normalizeGender(row.gender),
    rank: cleanText(row.official_rank),
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    country: cleanText(row.country),
    country_name: "",
    birth_year: "",
    official_points: toNumber(row.official_points),
    source_url: "external_candidates.csv",
    collected_at: cleanText(row.updated_at),
  }));
}

export function splitExternalCandidateLiveRows(untrackedLiveRows, candidateRows) {
  const candidateIds = new Set(candidateRows.map((row) => cleanText(row.player_id)));
  const candidateLiveRows = [];
  const ignoredRows = [];

  for (const row of untrackedLiveRows) {
    if (candidateIds.has(cleanText(row.player_id))) {
      candidateLiveRows.push(row);
    } else {
      ignoredRows.push(row);
    }
  }

  return {
    externalCandidateLiveRows: candidateLiveRows,
    ignoredUntrackedLiveRows: ignoredRows,
  };
}

export function buildIncludedExternalRows(rankedRows, candidateRows) {
  const candidateMap = new Map(
    candidateRows.map((row) => [cleanText(row.player_id), row])
  );

  return rankedRows
    .filter((row) => candidateMap.has(cleanText(row.player_id)))
    .map((row) => {
      const candidate = candidateMap.get(cleanText(row.player_id)) || {};
      return {
        player_id: row.player_id,
        player_name: row.player_name,
        gender: row.gender,
        official_rank: row.official_rank,
        official_points: row.official_points_for_comparison,
        live_rank: row.live_rank,
        live_points: row.live_points,
        rank_change: row.rank_change_vs_official,
        participated_in_final_calculation: "true",
        entered_top500:
          toNumber(row.live_rank) <= DISPLAY_LIMIT_PER_GENDER ? "true" : "false",
        candidate_status: STATUS_INCLUDED,
        tournaments: cleanText(candidate.tournaments),
      };
    })
    .sort((a, b) => {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      return toNumber(a.live_rank) - toNumber(b.live_rank);
    });
}

export function markIncludedCandidates(candidateRows, includedRows) {
  const includedIds = new Set(includedRows.map((row) => cleanText(row.player_id)));

  return candidateRows.map((row) => {
    if (!includedIds.has(cleanText(row.player_id))) return row;
    return {
      ...row,
      candidate_status: STATUS_INCLUDED,
      breakdown_required: "false",
      breakdown_fetched: "true",
      reason: "included_in_final_ranking",
      updated_at: new Date().toISOString(),
    };
  });
}

function normalizeLedgerRow(row, sourceType) {
  return {
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    gender: normalizeGender(row.gender),
    country: cleanText(row.country),
    country_name: cleanText(row.country_name),
    birth_year: cleanText(row.birth_year),

    event_type: normalizeEventType(row.event_type),
    countable_status: cleanText(row.countable_status),

    tournament_name: cleanText(row.tournament_name),
    category: cleanText(row.category),
    draw_type: cleanText(row.draw_type),
    host_nation: cleanText(row.host_nation),
    host_nation_code: cleanText(row.host_nation_code),
    surface: cleanText(row.surface),
    surface_code: cleanText(row.surface_code),

    start_date: cleanText(row.start_date),
    drop_date_calculated: cleanText(row.drop_date_calculated),

    round: cleanText(row.round),
    points: toNumber(row.points),

    tournament_link: cleanText(row.tournament_link),
    is_countable_at_collection: cleanText(row.is_countable_at_collection),
    is_live: cleanText(row.is_live) || (sourceType === "live" ? "true" : "false"),
    status: cleanText(row.status),

    source_url: cleanText(row.source_url),
    collected_at: cleanText(row.collected_at),
    raw_json: cleanText(row.raw_json),

    source_type: sourceType,
  };
}

function isDropped(row, dropCutoffDate) {
  if (row.source_type === "live") return false;

  const dropDate = parseIsoDate(row.drop_date_calculated);

  if (!dropDate) return false;

  return dropDate <= dropCutoffDate;
}

export function buildResultKey(row) {
  return buildWeeklyLedgerResultKey({
    player_id: cleanText(row.player_id),
    event_type: normalizeEventType(row.event_type),
    tournament_name: cleanText(row.tournament_name),
    category: cleanText(row.category),
    draw_type: cleanText(row.draw_type),
    start_date: cleanText(row.start_date),
  });
}

export function mergeLedgersWithDrops(baseRows, liveRows, dropCutoffDate) {
  const activeRows = [];
  const droppedRows = [];

  for (const row of baseRows) {
    const normalized = normalizeLedgerRow(row, "base");

    if (!normalized.player_id) continue;
    if (!normalized.event_type) continue;

    if (isDropped(normalized, dropCutoffDate)) {
      droppedRows.push({
        ...normalized,
        drop_cutoff_date: dropCutoffDate,
        drop_reason: "drop_date_calculated_before_or_on_cutoff",
      });
    } else {
      activeRows.push(normalized);
    }
  }

  for (const row of liveRows) {
    const normalized = normalizeLedgerRow(row, "live");

    if (!normalized.player_id) continue;
    if (!normalized.event_type) continue;

    activeRows.push(normalized);
  }

  const dedupedByKey = new Map();

  for (const row of activeRows) {
    const key = buildResultKey(row);

    if (!dedupedByKey.has(key)) {
      dedupedByKey.set(key, row);
      continue;
    }

    const previous = dedupedByKey.get(key);

    if (previous.source_type !== "live" && row.source_type === "live") {
      dedupedByKey.set(key, row);
    }
  }

  return {
    activeRows: [...dedupedByKey.values()],
    droppedRows,
  };
}

function groupRowsByPlayer(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!row.player_id) continue;

    const key = row.player_id;

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(row);
  }

  return map;
}

function getPlayerBaseInfo(playerId, rows, playersMap, snapshotMap) {
  const first = rows[0] || {};
  const player = playersMap.get(playerId) || {};
  const snapshot = snapshotMap.get(playerId) || {};

  return {
    player_id: playerId,
    player_name: cleanText(snapshot.player_name || player.player_name || first.player_name),
    gender: normalizeGender(snapshot.gender || player.gender || first.gender),
    country: cleanText(snapshot.country || player.country || first.country),
    country_name: cleanText(
      snapshot.country_name || player.country_name || first.country_name
    ),
    birth_year: cleanText(snapshot.birth_year || player.birth_year || first.birth_year),

    official_rank: snapshot.official_rank || "",
    official_points: snapshot.official_points || "",
    ranking_date: snapshot.ranking_date || "",
  };
}

function sortResultsByPointsDesc(rows) {
  return [...rows].sort((a, b) => {
    const pointsDiff = toNumber(b.points) - toNumber(a.points);

    if (pointsDiff !== 0) return pointsDiff;

    const liveA = a.source_type === "live" ? 1 : 0;
    const liveB = b.source_type === "live" ? 1 : 0;

    if (liveA !== liveB) return liveB - liveA;

    const dateA = String(a.start_date || "");
    const dateB = String(b.start_date || "");

    return dateB.localeCompare(dateA);
  });
}

function sumPoints(rows) {
  return rows.reduce((sum, row) => sum + toNumber(row.points), 0);
}

function normalizeTieBreakCategory(value) {
  const category = cleanText(value).toUpperCase();

  if (
    category === "GS" ||
    category === "GRAND SLAM" ||
    category === "YOUTH OLYMPICS"
  ) {
    return "JGS";
  }

  return category;
}

function buildCategoryPointVector(rows) {
  return TIE_BREAK_CATEGORIES.map((category) =>
    sumPoints(
      rows.filter((row) => normalizeTieBreakCategory(row.category) === category)
    )
  );
}

function buildTieBreakVector(bestSingles, bestDoubles) {
  return [
    ...buildCategoryPointVector(bestSingles),
    ...buildCategoryPointVector(bestDoubles),
  ].map((value) => Number(value.toFixed(2)));
}

function compareTieBreakVectorDesc(a, b) {
  const vectorA = Array.isArray(a._tie_break_points) ? a._tie_break_points : [];
  const vectorB = Array.isArray(b._tie_break_points) ? b._tie_break_points : [];
  const maxLength = Math.max(vectorA.length, vectorB.length);

  for (let i = 0; i < maxLength; i++) {
    const diff = toNumber(vectorB[i]) - toNumber(vectorA[i]);

    if (diff !== 0) return diff;
  }

  return 0;
}

function compareLiveRankingRows(a, b) {
  const pointsDiff = toNumber(b.live_points) - toNumber(a.live_points);

  if (pointsDiff !== 0) return pointsDiff;

  const tieBreakDiff = compareTieBreakVectorDesc(a, b);

  if (tieBreakDiff !== 0) return tieBreakDiff;

  const officialA = toNumber(a.official_rank) || 999999;
  const officialB = toNumber(b.official_rank) || 999999;

  if (officialA !== officialB) return officialA - officialB;

  return String(a.player_name).localeCompare(String(b.player_name));
}

function formatResult(row) {
  if (!row) return "";

  const points = toNumber(row.points);
  const source = row.source_type === "live" ? "LIVE" : "BASE";
  const category = cleanText(row.category);
  const round = cleanText(row.round);
  const tournament = cleanText(row.tournament_name);
  const date = cleanText(row.start_date);
  const dropDate = cleanText(row.drop_date_calculated);

  return `${points} pts | ${source} | ${category} | ${round} | ${tournament} | ${date} | drop ${dropDate}`;
}

function calculateDroppedStatsForPlayer(playerId, droppedRows) {
  const rows = droppedRows.filter((row) => row.player_id === playerId);

  const singles = rows.filter((row) => row.event_type === "singles");
  const doubles = rows.filter((row) => row.event_type === "doubles");

  const singlesDroppedRaw = sumPoints(singles);
  const doublesDroppedRaw = sumPoints(doubles);
  const estimatedWeightedDropped = singlesDroppedRaw + doublesDroppedRaw / 4;

  return {
    dropped_rows_count: rows.length,
    dropped_singles_raw: Number(singlesDroppedRaw.toFixed(2)),
    dropped_doubles_raw: Number(doublesDroppedRaw.toFixed(2)),
    estimated_weighted_dropped: Number(estimatedWeightedDropped.toFixed(2)),
  };
}

export function calculatePlayerLiveRanking(
  playerId,
  rows,
  playersMap,
  snapshotMap,
  droppedRows
) {
  const base = getPlayerBaseInfo(playerId, rows, playersMap, snapshotMap);

  const singles = rows.filter((row) => row.event_type === "singles");
  const doubles = rows.filter((row) => row.event_type === "doubles");

  const bestSingles = sortResultsByPointsDesc(singles).slice(0, 6);
  const bestDoubles = sortResultsByPointsDesc(doubles).slice(0, 6);

  const singlesPoints = sumPoints(bestSingles);
  const doublesRawPoints = sumPoints(bestDoubles);
  const doublesWeightedPoints = doublesRawPoints / 4;
  const livePoints = singlesPoints + doublesWeightedPoints;
  const tieBreakPoints = buildTieBreakVector(bestSingles, bestDoubles);

  const liveSinglesRowsUsed = bestSingles.filter(
    (row) => row.source_type === "live"
  ).length;

  const liveDoublesRowsUsed = bestDoubles.filter(
    (row) => row.source_type === "live"
  ).length;

  const liveRowsAvailable = rows.filter((row) => row.source_type === "live")
    .length;

  const liveRawPointsAvailable = sumPoints(
    rows.filter((row) => row.source_type === "live")
  );

  const droppedStats = calculateDroppedStatsForPlayer(
    base.player_id,
    droppedRows
  );

  const officialPoints = toNumber(base.official_points);

  return {
    ...base,

    live_rank: "",
    live_points: Number(livePoints.toFixed(2)),

    official_points_for_comparison: base.official_points,
    points_change_vs_official:
      officialPoints || officialPoints === 0
        ? Number((livePoints - officialPoints).toFixed(2))
        : "",

    singles_points: Number(singlesPoints.toFixed(2)),
    doubles_points_raw: Number(doublesRawPoints.toFixed(2)),
    doubles_points_weighted: Number(doublesWeightedPoints.toFixed(2)),

    singles_results_used: bestSingles.length,
    doubles_results_used: bestDoubles.length,

    live_rows_available: liveRowsAvailable,
    live_raw_points_available: liveRawPointsAvailable,

    live_singles_results_counting: liveSinglesRowsUsed,
    live_doubles_results_counting: liveDoublesRowsUsed,

    has_live_result: liveRowsAvailable > 0 ? "true" : "false",

    dropped_rows_count: droppedStats.dropped_rows_count,
    dropped_singles_raw: droppedStats.dropped_singles_raw,
    dropped_doubles_raw: droppedStats.dropped_doubles_raw,
    estimated_weighted_dropped: droppedStats.estimated_weighted_dropped,
    has_dropped_result: droppedStats.dropped_rows_count > 0 ? "true" : "false",

    best_singles_1: formatResult(bestSingles[0]),
    best_singles_2: formatResult(bestSingles[1]),
    best_singles_3: formatResult(bestSingles[2]),
    best_singles_4: formatResult(bestSingles[3]),
    best_singles_5: formatResult(bestSingles[4]),
    best_singles_6: formatResult(bestSingles[5]),

    best_doubles_1: formatResult(bestDoubles[0]),
    best_doubles_2: formatResult(bestDoubles[1]),
    best_doubles_3: formatResult(bestDoubles[2]),
    best_doubles_4: formatResult(bestDoubles[3]),
    best_doubles_5: formatResult(bestDoubles[4]),
    best_doubles_6: formatResult(bestDoubles[5]),

    _tie_break_points: tieBreakPoints,

    calculated_at: new Date().toISOString(),
  };
}

export function buildTrackedRankingRows({
  playersRows,
  snapshotMap,
  activeRows,
  droppedRows,
}) {
  const playersMap = buildPlayersMap(playersRows);
  const grouped = groupRowsByPlayer(activeRows);
  const calculated = [];

  for (const playerRow of playersRows) {
    const playerId = cleanText(playerRow.player_id);

    if (!playerId) continue;

    calculated.push(
      calculatePlayerLiveRanking(
        playerId,
        grouped.get(playerId) || [],
        playersMap,
        snapshotMap,
        droppedRows
      )
    );
  }

  return assignLiveRanks(calculated);
}

function assignLiveRanks(rows) {
  const byGender = new Map();

  for (const row of rows) {
    const gender = normalizeGender(row.gender) || "unknown";

    if (!byGender.has(gender)) {
      byGender.set(gender, []);
    }

    byGender.get(gender).push(row);
  }

  const ranked = [];

  for (const [, genderRows] of byGender.entries()) {
    const sorted = [...genderRows].sort(compareLiveRankingRows);

    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const rank = i + 1;

      ranked.push({
        ...row,
        live_rank: rank,
        rank_change_vs_official:
          row.official_rank || row.official_rank === 0
            ? toNumber(row.official_rank) - rank
            : "",
      });
    }
  }

  return ranked.sort((a, b) => {
    if (a.gender !== b.gender) {
      return String(a.gender).localeCompare(String(b.gender));
    }

    return toNumber(a.live_rank) - toNumber(b.live_rank);
  });
}

function buildChangesRows(liveRankingRows) {
  return liveRankingRows
    .filter(
      (row) =>
        row.has_live_result === "true" || row.has_dropped_result === "true"
    )
    .sort((a, b) => {
      const changeA = toNumber(a.rank_change_vs_official);
      const changeB = toNumber(b.rank_change_vs_official);

      if (changeA !== changeB) return changeB - changeA;

      return (
        toNumber(b.points_change_vs_official) -
        toNumber(a.points_change_vs_official)
      );
    })
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      gender: row.gender,
      country: row.country,
      birth_year: row.birth_year,

      official_rank: row.official_rank,
      live_rank: row.live_rank,
      rank_change_vs_official: row.rank_change_vs_official,

      official_points: row.official_points_for_comparison,
      live_points: row.live_points,
      points_change_vs_official: row.points_change_vs_official,

      has_live_result: row.has_live_result,
      has_dropped_result: row.has_dropped_result,

      live_rows_available: row.live_rows_available,
      live_raw_points_available: row.live_raw_points_available,
      live_singles_results_counting: row.live_singles_results_counting,
      live_doubles_results_counting: row.live_doubles_results_counting,

      dropped_rows_count: row.dropped_rows_count,
      dropped_singles_raw: row.dropped_singles_raw,
      dropped_doubles_raw: row.dropped_doubles_raw,
      estimated_weighted_dropped: row.estimated_weighted_dropped,

      best_singles_1: row.best_singles_1,
      best_singles_2: row.best_singles_2,
      best_singles_3: row.best_singles_3,
      best_doubles_1: row.best_doubles_1,
      best_doubles_2: row.best_doubles_2,
      best_doubles_3: row.best_doubles_3,

      calculated_at: row.calculated_at,
    }));
}

function printSummary(rows, activeLedger, droppedRows, dropCutoffDate) {
  const players = rows.length;
  const boys = rows.filter((row) => row.gender === "M").length;
  const girls = rows.filter((row) => row.gender === "F").length;

  const withLive = rows.filter((row) => row.has_live_result === "true").length;

  const withDrops = rows.filter((row) => row.has_dropped_result === "true")
    .length;

  const liveCounting = rows.filter(
    (row) =>
      toNumber(row.live_singles_results_counting) > 0 ||
      toNumber(row.live_doubles_results_counting) > 0
  ).length;

  const liveRows = activeLedger.filter((row) => row.source_type === "live")
    .length;

  console.log("");
  console.log("Resumo do live ranking com drops:");
  console.log(`Data de corte dos drops: ${dropCutoffDate}`);
  console.log(`Jogadores calculados: ${players}`);
  console.log(`Masculino: ${boys}`);
  console.log(`Feminino: ${girls}`);
  console.log(`Jogadores com resultado live disponível: ${withLive}`);
  console.log(`Jogadores com resultado live entrando no top 6: ${liveCounting}`);
  console.log(`Jogadores com algum resultado dropado: ${withDrops}`);
  console.log(`Linhas live no ledger combinado: ${liveRows}`);
  console.log(`Linhas base removidas por drop: ${droppedRows.length}`);

  console.log("");
  console.log("Maiores subidas entre jogadores afetados:");
  for (const row of buildChangesRows(rows).slice(0, 15)) {
    const sign =
      toNumber(row.rank_change_vs_official) > 0
        ? "+"
        : "";

    console.log(
      `${row.gender} ${row.player_name} (${row.country}): #${
        row.official_rank || "NR"
      } → #${row.live_rank} (${sign}${
        row.rank_change_vs_official || ""
      }), ${row.official_points || 0} → ${row.live_points}`
    );
  }
}

async function main() {
  await ensureDirs();

  console.log("");
  console.log("Lendo players.csv...");
  const playersRows = await readCsv(PLAYERS_FILE);
  const playersValidation = validatePlayersBase(playersRows);

  if (!playersValidation.isValid) {
    throw new Error(playersValidation.errors.join(" "));
  }

  const trackedPlayerIds = playersValidation.trackedPlayerIds;

  console.log("");
  console.log("Lendo points_ledger.csv...");
  const baseLedgerRows = await readCsv(POINTS_LEDGER_FILE);
  const {
    trackedRows: trackedBaseRows,
    untrackedRows: untrackedBaseRows,
  } = splitRowsByTrackedPlayerIds(baseLedgerRows, trackedPlayerIds);

  console.log("Lendo week_live_ledger_rows.csv...");
  const liveLedgerRows = await readCsv(WEEK_LIVE_LEDGER_FILE);
  const {
    trackedRows: trackedLiveRows,
    untrackedRows: untrackedLiveRows,
  } = splitRowsByTrackedPlayerIds(liveLedgerRows, trackedPlayerIds);

  console.log("Lendo rankings_snapshot.csv...");
  const snapshotRows = await readCsv(RANKINGS_SNAPSHOT_FILE);

  console.log("Lendo week_tournaments.csv...");
  const weekTournamentRows = await readCsv(WEEK_TOURNAMENTS_FILE);
  const weekWindow = getWeekWindow(weekTournamentRows);
  const dropCutoffDate = getDropCutoffDate(weekWindow);

  if (!dropCutoffDate) {
    throw new Error(
      "Não consegui determinar a data de corte dos drops. Verifique week_tournaments.csv."
    );
  }

  console.log("Lendo candidatos externos...");
  const candidateRows = await readCsvIfExists(EXTERNAL_CANDIDATES_FILE);
  const externalCandidateLedgerRows = await readCsvIfExists(
    EXTERNAL_CANDIDATE_LEDGER_FILE
  );
  const eligibleExternalCandidates = getEligibleExternalCandidates(
    candidateRows,
    trackedPlayerIds
  );
  const { externalCandidateLiveRows, ignoredUntrackedLiveRows } =
    splitExternalCandidateLiveRows(untrackedLiveRows, eligibleExternalCandidates);

  const externalPlayersRows = buildExternalPlayerRows(eligibleExternalCandidates);
  const externalSnapshotRows = buildExternalSnapshotRows(
    eligibleExternalCandidates,
    snapshotRows[0]?.ranking_date || ""
  );
  const combinedPlayersRows = [...playersRows, ...externalPlayersRows];
  const combinedSnapshotRows = [...snapshotRows, ...externalSnapshotRows];
  const combinedBaseRows = [
    ...trackedBaseRows,
    ...externalCandidateLedgerRows,
  ];
  const combinedLiveRows = [
    ...trackedLiveRows,
    ...externalCandidateLiveRows,
  ];
  const snapshotMap = buildSnapshotMap(combinedSnapshotRows);

  if (untrackedBaseRows.length > 0) {
    console.warn(
      `Aviso: ${untrackedBaseRows.length} linhas historicas de jogadores fora de players.csv foram ignoradas.`
    );
  }

  const { activeRows, droppedRows } = mergeLedgersWithDrops(
    combinedBaseRows,
    combinedLiveRows,
    dropCutoffDate
  );

  const ranked = buildTrackedRankingRows({
    playersRows: combinedPlayersRows,
    snapshotMap,
    activeRows,
    droppedRows,
  });
  const changes = buildChangesRows(ranked);
  const top500 = ranked.filter(
    (row) => toNumber(row.live_rank) <= DISPLAY_LIMIT_PER_GENDER
  );
  const ignoredExternalPlayers =
    buildIgnoredExternalPlayersRows(ignoredUntrackedLiveRows);
  const includedExternalPlayers = buildIncludedExternalRows(
    ranked,
    candidateRows
  );
  const nextCandidateRows = markIncludedCandidates(
    candidateRows,
    includedExternalPlayers
  );

  await writeCsv(LIVE_COMBINED_WITH_DROPS_FILE, activeRows, [
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
    "source_type",
  ]);

  await writeCsv(LIVE_DROPPED_POINTS_FILE, droppedRows, [
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
    "drop_cutoff_date",
    "drop_reason",

    "round",
    "points",

    "tournament_link",
    "is_countable_at_collection",
    "is_live",
    "status",

    "source_url",
    "collected_at",
    "raw_json",
    "source_type",
  ]);

  const liveRankingColumns = [
    "live_rank",
    "official_rank",
    "rank_change_vs_official",

    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",

    "official_points_for_comparison",
    "live_points",
    "points_change_vs_official",

    "singles_points",
    "doubles_points_raw",
    "doubles_points_weighted",

    "singles_results_used",
    "doubles_results_used",

    "live_rows_available",
    "live_raw_points_available",
    "live_singles_results_counting",
    "live_doubles_results_counting",
    "has_live_result",

    "dropped_rows_count",
    "dropped_singles_raw",
    "dropped_doubles_raw",
    "estimated_weighted_dropped",
    "has_dropped_result",

    "best_singles_1",
    "best_singles_2",
    "best_singles_3",
    "best_singles_4",
    "best_singles_5",
    "best_singles_6",

    "best_doubles_1",
    "best_doubles_2",
    "best_doubles_3",
    "best_doubles_4",
    "best_doubles_5",
    "best_doubles_6",

    "ranking_date",
    "calculated_at",
  ];

  await writeCsv(LIVE_RANKING_WITH_DROPS_FILE, ranked, liveRankingColumns);
  await writeCsv(LIVE_RANKING_WITH_DROPS_TOP500_FILE, top500, liveRankingColumns);
  await writeCsv(LIVE_EXTERNAL_PLAYERS_IGNORED_FILE, ignoredExternalPlayers, [
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
  await writeCsv(
    LIVE_EXTERNAL_PLAYERS_INCLUDED_FILE,
    includedExternalPlayers,
    LIVE_EXTERNAL_INCLUDED_COLUMNS
  );
  if (candidateRows.length > 0) {
    await writeCsv(
      EXTERNAL_CANDIDATES_FILE,
      nextCandidateRows,
      EXTERNAL_CANDIDATE_COLUMNS
    );
  }
  await writeCsv(
    LIVE_EXTERNAL_LEDGER_ROWS_IGNORED_FILE,
    ignoredUntrackedLiveRows,
    collectColumns(ignoredUntrackedLiveRows, [
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
    ])
  );

  await writeCsv(LIVE_RANKING_WITH_DROPS_CHANGES_FILE, changes, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "birth_year",

    "official_rank",
    "live_rank",
    "rank_change_vs_official",

    "official_points",
    "live_points",
    "points_change_vs_official",

    "has_live_result",
    "has_dropped_result",

    "live_rows_available",
    "live_raw_points_available",
    "live_singles_results_counting",
    "live_doubles_results_counting",

    "dropped_rows_count",
    "dropped_singles_raw",
    "dropped_doubles_raw",
    "estimated_weighted_dropped",

    "best_singles_1",
    "best_singles_2",
    "best_singles_3",
    "best_doubles_1",
    "best_doubles_2",
    "best_doubles_3",

    "calculated_at",
  ]);

  printSummary(ranked, activeRows, droppedRows, dropCutoffDate);
  const externalTop500Count = includedExternalPlayers.filter(
    (row) => row.entered_top500 === "true"
  ).length;
  console.log(
    `Externos participantes do calculo final: ${includedExternalPlayers.length}`
  );
  console.log(
    `Externos que entraram no Top 500: ${externalTop500Count}`
  );
  console.log(
    `Jogadores externos ignorados: ${ignoredExternalPlayers.length} | linhas live externas ignoradas: ${ignoredUntrackedLiveRows.length}`
  );

  console.log("");
  console.log("Arquivos gerados:");
  console.log("data/clean/live_combined_ledger_with_drops.csv");
  console.log("data/clean/live_dropped_points.csv");
  console.log("data/clean/live_ranking_with_drops.csv");
  console.log("data/clean/live_ranking_with_drops_top500.csv");
  console.log("data/clean/live_ranking_with_drops_changes.csv");
  console.log("data/clean/live_external_players_included.csv");
  console.log("data/clean/live_external_players_ignored.csv");
  console.log("data/clean/live_external_ledger_rows_ignored.csv");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err);
    process.exit(1);
  });
}
