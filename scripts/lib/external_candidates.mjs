import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  CANDIDATE_WATCH_RANK_PER_GENDER,
  EXTERNAL_CANDIDATE_FALLBACK_MARGIN,
  PUBLIC_RANK_LIMIT_PER_GENDER,
} from "./ranking_limits.mjs";

export const STATUS_INELIGIBLE = "INELIGIBLE";
export const STATUS_WATCH = "WATCH";
export const STATUS_FETCH_REQUIRED = "FETCH_REQUIRED";
export const STATUS_FETCHED = "FETCHED";
export const STATUS_FETCH_ERROR = "FETCH_ERROR";
export const STATUS_BLOCKED = "BLOCKED";
export const STATUS_INCLUDED = "INCLUDED";
export const STATUS_LOOKUP_REQUIRED = "LOOKUP_REQUIRED";

export const EXTERNAL_CANDIDATE_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "country",
  "official_rank",
  "official_points",
  "official_points_upper_bound",
  "official_points_status",
  "ranking_date",
  "guaranteed_singles_points",
  "guaranteed_doubles_raw_points",
  "guaranteed_doubles_weighted_points",
  "maximum_singles_points",
  "maximum_doubles_raw_points",
  "maximum_doubles_weighted_points",
  "guaranteed_upper_bound",
  "maximum_upper_bound",
  "public_cutoff_points",
  "candidate_watch_cutoff_points",
  // Legacy audit fields kept during the rollout so old cached CSVs remain readable.
  "top500_cutoff_points",
  "investigation_cutoff_points",
  "candidate_status",
  "breakdown_required",
  "breakdown_fetched",
  "breakdown_cache_file",
  "reason",
  "sources",
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
  "entered_public_ranking",
  // Legacy field keeps its original Top 500 meaning.
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

export function getCandidatePublicCutoff(row) {
  return toNumber(
    row?.public_cutoff_points ||
      row?.candidate_watch_cutoff_points ||
      row?.investigation_cutoff_points
  );
}

export function canCandidateEnterPublicRanking(row) {
  if (row?.official_points_status === "UNKNOWN" || row?.candidate_status === STATUS_LOOKUP_REQUIRED) return true;
  const cutoff = getCandidatePublicCutoff(row);
  return cutoff > 0 && toNumber(row?.guaranteed_upper_bound) >= cutoff;
}

export function getUnresolvedPublicCandidates(rows = []) {
  return rows.filter(
    (row) =>
      canCandidateEnterPublicRanking(row) &&
      ![STATUS_FETCHED, STATUS_INCLUDED].includes(cleanText(row.candidate_status))
  );
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
  universeRows = [],
  weekPlayerResultsRows = [],
  weekMatchesRows = [],
  weekLiveLedgerRows = [],
}) {
  const trackedPlayerIds = buildTrackedPlayerIds(playersRows);
  const participants = new Map();

  // A player can cross the live cutoff without playing as others' points expire.
  // Collect all known outsiders; classification determines which need a breakdown.
  for (const row of universeRows) {
    addParticipant(participants, trackedPlayerIds, row, "rankings_universe");
  }

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
    const publicBoundary = sorted[PUBLIC_RANK_LIMIT_PER_GENDER - 1];
    const candidateWatchBoundary = sorted[CANDIDATE_WATCH_RANK_PER_GENDER - 1];
    const legacyTop500 = sorted[499];
    const publicCutoff = toNumber(publicBoundary?.live_points);
    const legacyTop500Cutoff = toNumber(legacyTop500?.live_points);
    const fallback = Math.max(
      0,
      publicCutoff - EXTERNAL_CANDIDATE_FALLBACK_MARGIN
    );
    const candidateWatchCutoff = candidateWatchBoundary
      ? toNumber(candidateWatchBoundary.live_points)
      : fallback;

    cutoffs.set(gender, {
      public_cutoff_points: Number(publicCutoff.toFixed(2)),
      candidate_watch_cutoff_points: Number(candidateWatchCutoff.toFixed(2)),
      top500_cutoff_points: Number(legacyTop500Cutoff.toFixed(2)),
      investigation_cutoff_points: Number(candidateWatchCutoff.toFixed(2)),
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
  unrankedPointsUpperBound = null,
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
      const rawOfficialPointsKnown = cleanText(official.official_points) !== "" && Number.isFinite(Number(official.official_points));
      const hasUnrankedPointsUpperBound =
        unrankedPointsUpperBound !== null &&
        unrankedPointsUpperBound !== undefined &&
        cleanText(unrankedPointsUpperBound) !== "" &&
        Number.isFinite(Number(unrankedPointsUpperBound));
      const boundedUnrankedPoints = !rawOfficialPointsKnown && hasUnrankedPointsUpperBound
        ? Number(unrankedPointsUpperBound) : null;
      const officialPoints = rawOfficialPointsKnown ? toNumber(official.official_points) : (boundedUnrankedPoints ?? 0);
      const officialPointsKnown = rawOfficialPointsKnown || boundedUnrankedPoints !== null;
      const rankingDate = cleanText(official.ranking_date) || commonRankingDate;
      const cutoff = cutoffs.get(gender) || {
        public_cutoff_points: 0,
        candidate_watch_cutoff_points: 0,
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
      const cachedPrevious = existingById.get(playerId) || {};
      const sameOfficialSnapshot = officialPointsKnown && cleanText(cachedPrevious.ranking_date) === rankingDate &&
        cleanText(cachedPrevious.official_points) !== "" && toNumber(cachedPrevious.official_points) === officialPoints;
      const previous = sameOfficialSnapshot ? cachedPrevious : {};
      let candidateStatus = STATUS_INELIGIBLE;
      let reason = "below_investigation_cutoff";

      if (maximumUpperBound >= cutoff.candidate_watch_cutoff_points) {
        candidateStatus = STATUS_WATCH;
        reason = "watching_future_round";
      }

      if (guaranteedUpperBound >= cutoff.public_cutoff_points) {
        candidateStatus = STATUS_FETCH_REQUIRED;
        reason = "waiting_for_breakdown";
      }

      if (!rawOfficialPointsKnown && boundedUnrankedPoints === null) {
        candidateStatus = STATUS_LOOKUP_REQUIRED;
        reason = "official_points_unknown_in_collected_universe";
      }

      // Network cooldown survives a week change; fetched breakdown trust does not.
      const previousStatus = cleanText(cachedPrevious.candidate_status);
      const previousUpdatedAt = Date.parse(cleanText(cachedPrevious.updated_at));
      const blockedCanRetry =
        previousStatus === STATUS_BLOCKED &&
        (!Number.isFinite(previousUpdatedAt) ||
          Date.parse(now) - previousUpdatedAt >= blockedRetryMs);

      if (sameOfficialSnapshot && [STATUS_FETCHED, STATUS_INCLUDED].includes(previousStatus)) {
        candidateStatus = previousStatus;
        reason = cleanText(previous.reason) || reason;
      } else if (previousStatus === STATUS_BLOCKED && !blockedCanRetry) {
        candidateStatus = STATUS_BLOCKED;
        reason = cleanText(cachedPrevious.reason) || "blocked_by_itf";
      }

      return {
        player_id: playerId,
        player_name: cleanText(participant.player_name || official.player_name),
        gender,
        country: cleanText(participant.country || official.country),
        official_rank: cleanText(official.rank),
        official_points: rawOfficialPointsKnown ? officialPoints : "",
        official_points_status: rawOfficialPointsKnown ? "KNOWN" : boundedUnrankedPoints !== null ? "BOUNDED" : "UNKNOWN",
        official_points_upper_bound: rawOfficialPointsKnown ? "" : boundedUnrankedPoints === null ? "" : boundedUnrankedPoints,
        ranking_date: rankingDate,
        ...potential,
        guaranteed_upper_bound: guaranteedUpperBound,
        maximum_upper_bound: maximumUpperBound,
        public_cutoff_points: cutoff.public_cutoff_points,
        candidate_watch_cutoff_points: cutoff.candidate_watch_cutoff_points,
        top500_cutoff_points: cutoff.top500_cutoff_points,
        investigation_cutoff_points: cutoff.investigation_cutoff_points,
        candidate_status: candidateStatus,
          breakdown_required: [STATUS_FETCH_REQUIRED, STATUS_LOOKUP_REQUIRED].includes(candidateStatus) ? "true" : "false",
        breakdown_fetched:
          candidateStatus === STATUS_FETCHED || candidateStatus === STATUS_INCLUDED
            ? "true"
            : cleanText(previous.breakdown_fetched) || "false",
        breakdown_cache_file: cleanText(previous.breakdown_cache_file),
        reason,
        sources: cleanText(participant.sources),
        tournaments: cleanText(participant.tournaments),
          updated_at: candidateStatus === STATUS_BLOCKED && !blockedCanRetry
            ? cleanText(cachedPrevious.updated_at) : now,
      };
    })
    .sort((a, b) => {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      return b.maximum_upper_bound - a.maximum_upper_bound;
    });
}
