import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  DISPLAY_LIMIT_PER_GENDER,
  EXTERNAL_CANDIDATE_FALLBACK_MARGIN,
  INVESTIGATION_RANK_PER_GENDER,
} from "./ranking_limits.mjs";

export const STATUS_INELIGIBLE = "INELIGIBLE";
export const STATUS_WATCH = "WATCH";
export const STATUS_FETCH_REQUIRED = "FETCH_REQUIRED";
export const STATUS_FETCHED = "FETCHED";
export const STATUS_FETCH_ERROR = "FETCH_ERROR";
export const STATUS_BLOCKED = "BLOCKED";
export const STATUS_INCLUDED = "INCLUDED";

export const EXTERNAL_CANDIDATE_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "country",
  "official_rank",
  "official_points",
  "ranking_date",
  "guaranteed_singles_points",
  "guaranteed_doubles_raw_points",
  "guaranteed_doubles_weighted_points",
  "maximum_singles_points",
  "maximum_doubles_raw_points",
  "maximum_doubles_weighted_points",
  "guaranteed_upper_bound",
  "maximum_upper_bound",
  "top500_cutoff_points",
  "investigation_cutoff_points",
  "candidate_status",
  "breakdown_required",
  "breakdown_fetched",
  "breakdown_cache_file",
  "reason",
  "tournaments",
  "updated_at",
];

export const LIVE_EXTERNAL_INCLUDED_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_rank",
  "official_points",
  "live_rank",
  "live_points",
  "rank_change",
  "participated_in_final_calculation",
  "entered_top500",
  "candidate_status",
  "tournaments",
];

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
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
  if (text === "s" || text === "single" || text === "singles") return "singles";
  if (text === "d" || text === "double" || text === "doubles") return "doubles";
  return text;
}

function splitList(value, separator) {
  return cleanText(value)
    .split(separator)
    .map(cleanText)
    .filter(Boolean);
}

export async function readCsv(filePath, { optional = false } = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });
  } catch (err) {
    if (optional && err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, {
      header: true,
      columns,
    }),
    "utf8"
  );
}

export function buildTrackedPlayerIds(playersRows) {
  return new Set(playersRows.map((row) => cleanText(row.player_id)).filter(Boolean));
}

function inferGender(row) {
  const code = cleanText(row.player_type_code).toUpperCase();
  if (code === "B") return "M";
  if (code === "G") return "F";
  return normalizeGender(row.gender);
}

function addParticipant(map, trackedPlayerIds, rawRow, source) {
  const playerId = cleanText(rawRow.player_id);
  if (!playerId || trackedPlayerIds.has(playerId)) return;

  if (!map.has(playerId)) {
    map.set(playerId, {
      player_id: playerId,
      player_name: cleanText(rawRow.player_name),
      gender: inferGender(rawRow),
      country: cleanText(rawRow.country || rawRow.nationality),
      tournaments: new Set(),
      source_rows: 0,
      sources: new Set(),
    });
  }

  const row = map.get(playerId);
  if (!row.player_name) row.player_name = cleanText(rawRow.player_name);
  if (!row.gender) row.gender = inferGender(rawRow);
  if (!row.country) row.country = cleanText(rawRow.country || rawRow.nationality);
  if (cleanText(rawRow.tournament_name)) {
    row.tournaments.add(cleanText(rawRow.tournament_name));
  }
  row.sources.add(source);
  row.source_rows += 1;
}

function addMatchSideParticipants(map, trackedPlayerIds, row, side) {
  const ids = splitList(row[`team${side}_player_ids`], "|");
  const namesByPipe = splitList(row[`team${side}_names`], "|");
  const namesBySlash = splitList(row[`team${side}_names`], " / ");
  const names = namesByPipe.length === ids.length ? namesByPipe : namesBySlash;
  const nationalities = splitList(row[`team${side}_nationalities`], "|");

  for (let index = 0; index < ids.length; index += 1) {
    addParticipant(
      map,
      trackedPlayerIds,
      {
        ...row,
        player_id: ids[index],
        player_name: names[index] || "",
        nationality: nationalities[index] || "",
      },
      "week_matches"
    );
  }
}

export function collectExternalParticipants({
  playersRows,
  weekPlayerResultsRows = [],
  weekMatchesRows = [],
  weekLiveLedgerRows = [],
}) {
  const trackedPlayerIds = buildTrackedPlayerIds(playersRows);
  const participants = new Map();

  for (const row of weekPlayerResultsRows) {
    addParticipant(participants, trackedPlayerIds, row, "week_player_results");
  }

  for (const row of weekLiveLedgerRows) {
    addParticipant(participants, trackedPlayerIds, row, "week_live_ledger_rows");
  }

  for (const row of weekMatchesRows) {
    addMatchSideParticipants(participants, trackedPlayerIds, row, 1);
    addMatchSideParticipants(participants, trackedPlayerIds, row, 2);
  }

  return [...participants.values()].map((row) => ({
    ...row,
    tournaments: [...row.tournaments].sort((a, b) => a.localeCompare(b)).join(" | "),
    sources: [...row.sources].sort((a, b) => a.localeCompare(b)).join(" | "),
  }));
}

export function buildUniverseMap(universeRows) {
  const map = new Map();

  for (const row of universeRows) {
    const playerId = cleanText(row.player_id);
    if (!playerId) continue;
    map.set(playerId, row);
  }

  return map;
}

export function getCommonUniverseRankingDate(universeRows) {
  const counts = new Map();
  for (const row of universeRows) {
    const rankingDate = cleanText(row.ranking_date);
    if (!rankingDate) continue;
    counts.set(rankingDate, (counts.get(rankingDate) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

export function calculateRankingCutoffs(rankingRows) {
  const byGender = new Map();

  for (const row of rankingRows) {
    const gender = normalizeGender(row.gender);
    if (!gender) continue;
    if (!byGender.has(gender)) byGender.set(gender, []);
    byGender.get(gender).push(row);
  }

  const cutoffs = new Map();

  for (const [gender, rows] of byGender.entries()) {
    const sorted = [...rows].sort(
      (a, b) => toNumber(a.live_rank) - toNumber(b.live_rank)
    );
    const top500 = sorted[DISPLAY_LIMIT_PER_GENDER - 1];
    const investigation = sorted[INVESTIGATION_RANK_PER_GENDER - 1];
    const top500Cutoff = toNumber(top500?.live_points);
    const fallback = Math.max(
      0,
      top500Cutoff - EXTERNAL_CANDIDATE_FALLBACK_MARGIN
    );
    const investigationCutoff = investigation
      ? toNumber(investigation.live_points)
      : fallback;

    cutoffs.set(gender, {
      top500_cutoff_points: Number(top500Cutoff.toFixed(2)),
      investigation_cutoff_points: Number(investigationCutoff.toFixed(2)),
    });
  }

  return cutoffs;
}

function getRoundPoints(pointsTableRows, { category, eventType, round }) {
  const normalizedCategory = cleanText(category).toUpperCase();
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedRound = cleanText(round).toUpperCase();
  const row = pointsTableRows.find(
    (item) =>
      cleanText(item.category).toUpperCase() === normalizedCategory &&
      normalizeEventType(item.event_type) === normalizedEventType &&
      cleanText(item.round_label).toUpperCase() === normalizedRound
  );

  return toNumber(row?.points);
}

function getMaximumPoints(pointsTableRows, { category, eventType, eliminated, guaranteedPoints }) {
  if (eliminated) return guaranteedPoints;

  const normalizedCategory = cleanText(category).toUpperCase();
  const normalizedEventType = normalizeEventType(eventType);
  const points = pointsTableRows
    .filter(
      (row) =>
        cleanText(row.category).toUpperCase() === normalizedCategory &&
        normalizeEventType(row.event_type) === normalizedEventType
    )
    .map((row) => toNumber(row.points));

  return points.length ? Math.max(...points) : guaranteedPoints;
}

export function summarizeCandidateLivePotential({
  playerId,
  weekLiveLedgerRows,
  pointsTableRows,
}) {
  const byEvent = new Map();

  for (const row of weekLiveLedgerRows) {
    if (cleanText(row.player_id) !== playerId) continue;

    const eventType = normalizeEventType(row.event_type || row.match_type_code);
    const key = [
      cleanText(row.tournament_key || row.tournament_name),
      eventType,
      cleanText(row.draw_type || row.event_classification_code),
    ].join("|");
    const guaranteedPoints =
      toNumber(row.points) ||
      getRoundPoints(pointsTableRows, {
        category: row.category,
        eventType,
        round: row.round,
      });
    const eliminated = cleanText(row.status).toLowerCase() === "eliminated";
    const maximumPoints = getMaximumPoints(pointsTableRows, {
      category: row.category,
      eventType,
      eliminated,
      guaranteedPoints,
    });
    const previous = byEvent.get(key);

    if (!previous || guaranteedPoints > previous.guaranteedPoints) {
      byEvent.set(key, {
        eventType,
        guaranteedPoints,
        maximumPoints,
      });
    }
  }

  const values = [...byEvent.values()];
  const guaranteedSingles = values
    .filter((row) => row.eventType === "singles")
    .reduce((sum, row) => sum + row.guaranteedPoints, 0);
  const guaranteedDoublesRaw = values
    .filter((row) => row.eventType === "doubles")
    .reduce((sum, row) => sum + row.guaranteedPoints, 0);
  const maximumSingles = values
    .filter((row) => row.eventType === "singles")
    .reduce((sum, row) => sum + row.maximumPoints, 0);
  const maximumDoublesRaw = values
    .filter((row) => row.eventType === "doubles")
    .reduce((sum, row) => sum + row.maximumPoints, 0);

  return {
    guaranteed_singles_points: Number(guaranteedSingles.toFixed(2)),
    guaranteed_doubles_raw_points: Number(guaranteedDoublesRaw.toFixed(2)),
    guaranteed_doubles_weighted_points: Number((guaranteedDoublesRaw / 4).toFixed(2)),
    maximum_singles_points: Number(maximumSingles.toFixed(2)),
    maximum_doubles_raw_points: Number(maximumDoublesRaw.toFixed(2)),
    maximum_doubles_weighted_points: Number((maximumDoublesRaw / 4).toFixed(2)),
  };
}

export function classifyExternalCandidates({
  participants,
  universeRows = [],
  weekLiveLedgerRows = [],
  pointsTableRows = [],
  baseRankingRows = [],
  existingCandidates = [],
  now = new Date().toISOString(),
  blockedRetryMs = 6 * 60 * 60 * 1000,
}) {
  const universe = buildUniverseMap(universeRows);
  const commonRankingDate = getCommonUniverseRankingDate(universeRows);
  const cutoffs = calculateRankingCutoffs(baseRankingRows);
  const existingById = new Map(
    existingCandidates.map((row) => [cleanText(row.player_id), row])
  );

  return participants
    .map((participant) => {
      const playerId = cleanText(participant.player_id);
      const official = universe.get(playerId) || {};
      const gender = normalizeGender(participant.gender || official.gender);
      const officialPoints = toNumber(official.official_points);
      const rankingDate = cleanText(official.ranking_date) || commonRankingDate;
      const cutoff = cutoffs.get(gender) || {
        top500_cutoff_points: 0,
        investigation_cutoff_points: 0,
      };
      const potential = summarizeCandidateLivePotential({
        playerId,
        weekLiveLedgerRows,
        pointsTableRows,
      });
      const guaranteedUpperBound = Number(
        (
          officialPoints +
          potential.guaranteed_singles_points +
          potential.guaranteed_doubles_weighted_points
        ).toFixed(2)
      );
      const maximumUpperBound = Number(
        (
          officialPoints +
          potential.maximum_singles_points +
          potential.maximum_doubles_weighted_points
        ).toFixed(2)
      );
      const previous = existingById.get(playerId) || {};
      let candidateStatus = STATUS_INELIGIBLE;
      let reason = "below_investigation_cutoff";

      if (maximumUpperBound >= cutoff.investigation_cutoff_points) {
        candidateStatus = STATUS_WATCH;
        reason = "watching_future_round";
      }

      if (guaranteedUpperBound >= cutoff.investigation_cutoff_points) {
        candidateStatus = STATUS_FETCH_REQUIRED;
        reason = "waiting_for_breakdown";
      }

      const previousStatus = cleanText(previous.candidate_status);
      const previousUpdatedAt = Date.parse(cleanText(previous.updated_at));
      const blockedCanRetry =
        previousStatus === STATUS_BLOCKED &&
        (!Number.isFinite(previousUpdatedAt) ||
          Date.parse(now) - previousUpdatedAt >= blockedRetryMs);

      if ([STATUS_FETCHED, STATUS_INCLUDED].includes(previousStatus)) {
        candidateStatus = previousStatus;
        reason = cleanText(previous.reason) || reason;
      } else if (previousStatus === STATUS_BLOCKED && !blockedCanRetry) {
        candidateStatus = STATUS_BLOCKED;
        reason = cleanText(previous.reason) || "blocked_by_itf";
      }

      return {
        player_id: playerId,
        player_name: cleanText(participant.player_name || official.player_name),
        gender,
        country: cleanText(participant.country || official.country),
        official_rank: cleanText(official.rank),
        official_points: officialPoints,
        ranking_date: rankingDate,
        ...potential,
        guaranteed_upper_bound: guaranteedUpperBound,
        maximum_upper_bound: maximumUpperBound,
        top500_cutoff_points: cutoff.top500_cutoff_points,
        investigation_cutoff_points: cutoff.investigation_cutoff_points,
        candidate_status: candidateStatus,
        breakdown_required: candidateStatus === STATUS_FETCH_REQUIRED ? "true" : "false",
        breakdown_fetched:
          candidateStatus === STATUS_FETCHED || candidateStatus === STATUS_INCLUDED
            ? "true"
            : cleanText(previous.breakdown_fetched) || "false",
        breakdown_cache_file: cleanText(previous.breakdown_cache_file),
        reason,
        tournaments: cleanText(participant.tournaments),
        updated_at: now,
      };
    })
    .sort((a, b) => {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      return b.maximum_upper_bound - a.maximum_upper_bound;
    });
}
