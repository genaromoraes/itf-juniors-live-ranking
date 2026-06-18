import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  TRACKED_BASE_LIMIT_PER_GENDER,
  TRACKED_BASE_TOTAL,
} from "./ranking_limits.mjs";

export const REQUEST_TIMEOUT_MS = 30000;
export const RETRY_DELAY_MS = 10000;
export const MAX_RETRIES = 2;
export const TOP_LIMIT = TRACKED_BASE_LIMIT_PER_GENDER;
export const PAGE_SIZE = 100;
export const OFFICIAL_RANKING_URL =
  "https://www.itftennis.com/tennis/api/PlayerRankApi/GetPlayerRankings";
export const BASELINE_POLICY = "as_collected";
export const STAGED_POLICY = "drop_cutoff";

export const GENDERS = [
  { label: "male", gender: "M", itfCode: "B" },
  { label: "female", gender: "F", itfCode: "G" },
];

export const STAGED_CALCULATED_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "singles_count",
  "singles_total",
  "doubles_count",
  "doubles_raw_total",
  "doubles_weighted_total",
  "calculated_total",
  "active_ledger_rows",
  "expired_ledger_rows",
  "drop_cutoff",
];

export const BASELINE_VALIDATION_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_points",
  "calculated_points",
  "point_difference",
  "baseline_policy",
  "active_rows",
  "singles_total",
  "doubles_raw_total",
  "doubles_weighted_total",
  "exact_match",
];

export const OFFICIAL_COMPARISON_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_rank",
  "official_points",
  "old_rank",
  "old_official_points",
  "calculated_points",
  "point_difference",
  "classification",
  "refresh_required",
  "refresh_reason",
  "ledger_rows",
  "active_rows",
  "expired_rows",
];

export const OFFICIAL_PLAYER_COLUMNS = [
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

export const OFFICIAL_SNAPSHOT_COLUMNS = [
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

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

export function normalizeGender(value) {
  const text = cleanText(value).toUpperCase();
  if (text === "M" || text === "B" || text === "BOYS") return "M";
  if (text === "F" || text === "G" || text === "GIRLS") return "F";
  return text;
}

export function normalizeEventType(value) {
  const text = cleanText(value).toLowerCase();
  if (["s", "single", "singles"].includes(text)) return "singles";
  if (["d", "double", "doubles"].includes(text)) return "doubles";
  return text;
}

export function roundToTwo(value) {
  return Number((value || 0).toFixed(2));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

export async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export function buildRankingUrl(genderInfo, skip, take = PAGE_SIZE) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    playerTypeCode: genderInfo.itfCode,
    ageCategoryCode: "",
    juniorRankingType: "itf",
    take: String(take),
    skip: String(skip),
    isOrderAscending: "true",
  });

  return `${OFFICIAL_RANKING_URL}?${params.toString()}`;
}

export function normalizeRankingDate(value) {
  const text = cleanText(value);

  if (isIsoDate(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
}

export function detectBlockedHtml(contentType, text) {
  const type = cleanText(contentType).toLowerCase();
  const snippet = cleanText(text).toLowerCase();

  return (
    type.includes("text/html") ||
    snippet.includes("incapsula") ||
    snippet.includes("imperva") ||
    snippet.includes("_incapsula_resource") ||
    snippet.includes("incident_id") ||
    snippet.includes("<html")
  );
}

export async function fetchOfficialJson(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/plain, */*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        },
      });

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}. Content-Type: ${contentType}. Text: ${text.slice(0, 300)}`
        );
      }

      if (detectBlockedHtml(contentType, text)) {
        throw new Error(
          `HTML/bloqueio detectado. Content-Type: ${contentType}. Text: ${text.slice(0, 300)}`
        );
      }

      let json = null;

      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error(
          `JSON invalido. Content-Type: ${contentType}. Text: ${text.slice(0, 300)}`
        );
      }

      return {
        url,
        status: response.status,
        contentType,
        text,
        json,
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        lastError = new Error(
          `Request timeout after ${REQUEST_TIMEOUT_MS}ms for ${url}`
        );
      } else {
        lastError = err;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

export function normalizeOfficialPlayer(item, genderInfo, rankingDate, sourceUrl) {
  const birthYear = toNumber(item.birthYear);
  const firstName = cleanText(item.playerGivenName || item.givenName || item.firstName);
  const lastName = cleanText(item.playerFamilyName || item.familyName || item.lastName);
  const playerName =
    cleanText(item.fullName) || [firstName, lastName].filter(Boolean).join(" ");

  return {
    player_id: cleanText(item.playerId || item.id),
    player_name: playerName,
    first_name: firstName,
    last_name: lastName,
    gender: genderInfo.gender,
    itf_gender_code: genderInfo.itfCode,
    country: cleanText(item.playerNationalityCode || item.nationCode),
    country_name: cleanText(item.playerNationality || item.nationalityName),
    birth_date: "",
    birth_year: birthYear ?? "",
    junior_last_year: birthYear ? birthYear + 18 : "",
    active_junior: "",
    profile_url: normalizeProfileUrl(item.profileLink || item.profileUrl),
    current_rank: toNumber(item.rank) ?? "",
    current_points: toNumber(item.points) ?? "",
    first_seen_date: rankingDate,
    last_seen_date: rankingDate,
    raw_json: JSON.stringify(item),
    _source_url: sourceUrl,
  };
}

export function normalizeProfileUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (text.startsWith("http")) return text;
  if (text.startsWith("/")) return `https://www.itftennis.com${text}`;
  return text;
}

export function buildOfficialSnapshotRow(player, rankingDate) {
  return {
    ranking_date: rankingDate,
    gender: player.gender,
    rank: player.current_rank,
    player_id: player.player_id,
    player_name: player.player_name,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    official_points: player.current_points,
    source_url: player._source_url || "",
    collected_at: new Date().toISOString(),
  };
}

export function isLedgerRowActive(
  row,
  { policy = STAGED_POLICY, dropCutoff = "" } = {}
) {
  if (policy === BASELINE_POLICY) {
    return true;
  }

  const dropDate = cleanText(row.drop_date_calculated);
  if (!dropDate) return true;
  if (!isIsoDate(dropDate)) return false;
  return dropDate > dropCutoff;
}

export function sortResultsByPointsDesc(rows) {
  return [...rows].sort((a, b) => {
    const pointsDiff = (toNumber(b.points) ?? 0) - (toNumber(a.points) ?? 0);
    if (pointsDiff !== 0) return pointsDiff;

    const dateDiff = cleanText(b.start_date).localeCompare(cleanText(a.start_date));
    if (dateDiff !== 0) return dateDiff;

    return cleanText(a.tournament_name).localeCompare(cleanText(b.tournament_name));
  });
}

export function sumRowPoints(rows) {
  return roundToTwo(
    rows.reduce((sum, row) => sum + (toNumber(row.points) ?? 0), 0)
  );
}

export function calculatePlayerTotals(
  rows,
  options = { policy: STAGED_POLICY, dropCutoff: "" }
) {
  const normalizedOptions =
    typeof options === "string"
      ? { policy: STAGED_POLICY, dropCutoff: options }
      : {
          policy: options?.policy || STAGED_POLICY,
          dropCutoff: cleanText(options?.dropCutoff),
        };

  const activeRows = rows.filter((row) =>
    isLedgerRowActive(row, normalizedOptions)
  );
  const expiredRows = rows.filter(
    (row) => !isLedgerRowActive(row, normalizedOptions)
  );
  const singlesRows = activeRows.filter(
    (row) => normalizeEventType(row.event_type) === "singles"
  );
  const doublesRows = activeRows.filter(
    (row) => normalizeEventType(row.event_type) === "doubles"
  );
  const bestSingles = sortResultsByPointsDesc(singlesRows).slice(0, 6);
  const bestDoubles = sortResultsByPointsDesc(doublesRows).slice(0, 6);
  const singlesTotal = sumRowPoints(bestSingles);
  const doublesRawTotal = sumRowPoints(bestDoubles);
  const doublesWeightedTotal = roundToTwo(doublesRawTotal * 0.25);
  const calculatedTotal = roundToTwo(singlesTotal + doublesWeightedTotal);
  const first = rows[0] || {};

  return {
    player_id: cleanText(first.player_id),
    player_name: cleanText(first.player_name),
    gender: normalizeGender(first.gender),
    singles_count: bestSingles.length,
    singles_total: singlesTotal,
    doubles_count: bestDoubles.length,
    doubles_raw_total: doublesRawTotal,
    doubles_weighted_total: doublesWeightedTotal,
    calculated_total: calculatedTotal,
    active_ledger_rows: activeRows.length,
    expired_ledger_rows: expiredRows.length,
    drop_cutoff:
      normalizedOptions.policy === BASELINE_POLICY
        ? ""
        : normalizedOptions.dropCutoff,
    ledger_rows: rows.length,
    active_rows: activeRows.length,
    expired_rows: expiredRows.length,
    policy: normalizedOptions.policy,
  };
}

export function groupRowsByPlayer(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const playerId = cleanText(row.player_id);
    if (!playerId) continue;

    if (!grouped.has(playerId)) {
      grouped.set(playerId, []);
    }

    grouped.get(playerId).push(row);
  }

  return grouped;
}

export function calculateLedgerPoints(
  rows,
  options = { policy: STAGED_POLICY, dropCutoff: "" }
) {
  const grouped = groupRowsByPlayer(rows);

  return [...grouped.values()].map((playerRows) =>
    calculatePlayerTotals(playerRows, options)
  );
}

export function buildPlayerMap(rows) {
  return new Map(
    rows
      .filter((row) => cleanText(row.player_id))
      .map((row) => [cleanText(row.player_id), row])
  );
}

export function buildSnapshotMap(rows) {
  return new Map(
    rows
      .filter((row) => cleanText(row.player_id))
      .map((row) => [
        cleanText(row.player_id),
        {
          player_id: cleanText(row.player_id),
          player_name: cleanText(row.player_name),
          gender: normalizeGender(row.gender),
          rank: toNumber(row.rank) ?? "",
          official_points: toNumber(row.official_points) ?? "",
          ranking_date: cleanText(row.ranking_date),
        },
      ])
  );
}

export function buildCalculatedMap(rows) {
  return new Map(
    rows
      .filter((row) => cleanText(row.player_id))
      .map((row) => [cleanText(row.player_id), row])
  );
}

export function buildIdentityKey(row) {
  return [
    cleanText(row.player_id),
    normalizeEventType(row.event_type),
    cleanText(row.tournament_name),
    cleanText(row.category),
    cleanText(row.draw_type),
    cleanText(row.start_date),
  ].join("|");
}

export function validateLedgerRows(rows) {
  const errors = [];
  const seen = new Set();
  const validEventTypes = new Set(["singles", "doubles"]);

  for (const row of rows) {
    if (cleanText(row.is_live).toLowerCase() === "true") {
      errors.push(`Linha com is_live=true: ${buildIdentityKey(row)}`);
    }

    if (!cleanText(row.player_id)) {
      errors.push("Linha sem player_id.");
    }

    if (!validEventTypes.has(normalizeEventType(row.event_type))) {
      errors.push(`Linha com event_type invalido: ${buildIdentityKey(row)}`);
    }

    if (toNumber(row.points) === null) {
      errors.push(`Linha com points invalido: ${buildIdentityKey(row)}`);
    }

    const key = buildIdentityKey(row);

    if (seen.has(key)) {
      errors.push(`Duplicata pela chave de identidade: ${key}`);
    }

    seen.add(key);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateOfficialSnapshotRows(playersRows, snapshotRows, expectedRankingDate) {
  const errors = [];
  const countsByGender = {
    M: snapshotRows.filter((row) => normalizeGender(row.gender) === "M").length,
    F: snapshotRows.filter((row) => normalizeGender(row.gender) === "F").length,
  };
  const ids = snapshotRows.map((row) => cleanText(row.player_id)).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  if (snapshotRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`Snapshot oficial invalido: esperado ${TRACKED_BASE_TOTAL} jogadores, recebido ${snapshotRows.length}.`);
  }

  if (countsByGender.M !== TRACKED_BASE_LIMIT_PER_GENDER) {
    errors.push(`Snapshot oficial invalido: esperado ${TRACKED_BASE_LIMIT_PER_GENDER} M, recebido ${countsByGender.M}.`);
  }

  if (countsByGender.F !== TRACKED_BASE_LIMIT_PER_GENDER) {
    errors.push(`Snapshot oficial invalido: esperado ${TRACKED_BASE_LIMIT_PER_GENDER} F, recebido ${countsByGender.F}.`);
  }

  if (playersRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`Players oficial invalido: esperado ${TRACKED_BASE_TOTAL} jogadores, recebido ${playersRows.length}.`);
  }

  if (ids.length !== snapshotRows.length) {
    errors.push("Existem linhas oficiais sem player_id.");
  }

  if (duplicateIds.length > 0) {
    errors.push(`Existem player_id duplicados no snapshot oficial: ${[...new Set(duplicateIds)].slice(0, 10).join(", ")}.`);
  }

  for (const gender of ["M", "F"]) {
    const sortedRanks = snapshotRows
      .filter((row) => normalizeGender(row.gender) === gender)
      .map((row) => toNumber(row.rank))
      .sort((a, b) => (a ?? 0) - (b ?? 0));

    if (sortedRanks.length !== TRACKED_BASE_LIMIT_PER_GENDER) continue;

    for (let index = 0; index < sortedRanks.length; index++) {
      if (sortedRanks[index] !== index + 1) {
        errors.push(`Ranks oficiais invalidos para ${gender}: esperado ${index + 1}, recebido ${sortedRanks[index]}.`);
        break;
      }
    }
  }

  const invalidPoints = snapshotRows.filter((row) => toNumber(row.official_points) === null);

  if (invalidPoints.length > 0) {
    errors.push(`Existem ${invalidPoints.length} linhas oficiais com official_points invalido.`);
  }

  const invalidDates = snapshotRows.filter(
    (row) => cleanText(row.ranking_date) !== expectedRankingDate
  );

  if (invalidDates.length > 0) {
    errors.push(
      `Existem ${invalidDates.length} linhas oficiais com ranking_date diferente de ${expectedRankingDate}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    countsByGender,
  };
}

export function compareCalculatedAgainstSnapshot(
  calculatedRows,
  snapshotRows,
  { baselinePolicy = BASELINE_POLICY } = {}
) {
  const calculatedMap = buildCalculatedMap(calculatedRows);
  const validations = snapshotRows.map((snapshot) => {
    const calculated = calculatedMap.get(cleanText(snapshot.player_id));
    const officialPoints = toNumber(snapshot.official_points) ?? 0;
    const calculatedPoints = calculated?.calculated_total ?? null;
    const difference =
      calculatedPoints === null ? null : roundToTwo(calculatedPoints - officialPoints);

    return {
      player_id: cleanText(snapshot.player_id),
      player_name: cleanText(snapshot.player_name),
      gender: normalizeGender(snapshot.gender),
      official_points: officialPoints,
      calculated_points: calculatedPoints ?? "",
      point_difference: difference ?? "",
      baseline_policy: baselinePolicy,
      active_rows: calculated?.active_rows ?? 0,
      singles_total: calculated?.singles_total ?? 0,
      doubles_raw_total: calculated?.doubles_raw_total ?? 0,
      doubles_weighted_total: calculated?.doubles_weighted_total ?? 0,
      exact_match: difference !== null && Math.abs(difference) < 0.01 ? "true" : "false",
    };
  });

  const exact = validations.filter((row) => row.exact_match === "true").length;

  return {
    rows: validations,
    exact,
    total: snapshotRows.length,
    valid: exact === snapshotRows.length,
  };
}

export function classifyPlayers({
  oldPlayersRows,
  oldSnapshotRows,
  officialSnapshotRows,
  stagedCalculatedRows,
  stagedLedgerRows,
}) {
  const oldPlayersMap = buildPlayerMap(oldPlayersRows);
  const oldSnapshotMap = buildSnapshotMap(oldSnapshotRows);
  const officialSnapshotMap = buildSnapshotMap(officialSnapshotRows);
  const stagedCalculatedMap = buildCalculatedMap(stagedCalculatedRows);
  const stagedGrouped = groupRowsByPlayer(stagedLedgerRows);
  const comparisonRows = [];

  for (const officialRow of officialSnapshotRows) {
    const playerId = cleanText(officialRow.player_id);
    const oldPlayer = oldPlayersMap.get(playerId);
    const oldSnapshot = oldSnapshotMap.get(playerId);
    const stagedCalculated = stagedCalculatedMap.get(playerId);
    const stagedRows = stagedGrouped.get(playerId) || [];
    const officialPoints = toNumber(officialRow.official_points) ?? 0;
    const calculatedPoints = stagedCalculated?.calculated_total ?? null;
    const pointDifference =
      calculatedPoints === null ? "" : roundToTwo(calculatedPoints - officialPoints);

    let classification = "exact_match";
    let refreshReason = "";

    if (!oldPlayer) {
      classification = "new_top500_entrant";
      refreshReason = "new_top500_entrant";
    } else if (!stagedRows.length) {
      classification = "missing_ledger";
      refreshReason = "missing_ledger";
    } else if (!stagedCalculated) {
      classification = "invalid_player";
      refreshReason = "invalid_player";
    } else if (Math.abs(pointDifference) >= 0.01) {
      classification = "point_difference";
      refreshReason = "point_difference";
    }

    comparisonRows.push({
      player_id: playerId,
      player_name: cleanText(officialRow.player_name),
      gender: normalizeGender(officialRow.gender),
      official_rank: toNumber(officialRow.rank) ?? "",
      official_points: officialPoints,
      old_rank: oldSnapshot?.rank ?? "",
      old_official_points: oldSnapshot?.official_points ?? "",
      calculated_points: calculatedPoints ?? "",
      point_difference: pointDifference === "" ? "" : pointDifference,
      classification,
      refresh_required:
        ["point_difference", "new_top500_entrant", "missing_ledger", "invalid_player"].includes(
          classification
        )
          ? "true"
          : "false",
      refresh_reason: refreshReason,
      ledger_rows: stagedRows.length,
      active_rows: stagedCalculated?.active_rows ?? 0,
      expired_rows: stagedCalculated?.expired_rows ?? 0,
    });
  }

  const removedRows = [];
  const officialIdsByGender = {
    M: new Set(
      officialSnapshotRows
        .filter((row) => normalizeGender(row.gender) === "M")
        .map((row) => cleanText(row.player_id))
    ),
    F: new Set(
      officialSnapshotRows
        .filter((row) => normalizeGender(row.gender) === "F")
        .map((row) => cleanText(row.player_id))
    ),
  };

  for (const oldPlayer of oldPlayersRows) {
    const playerId = cleanText(oldPlayer.player_id);
    const gender = normalizeGender(oldPlayer.gender);
    if (!playerId || !["M", "F"].includes(gender)) continue;

    if (!officialIdsByGender[gender].has(playerId)) {
      const oldSnapshot = oldSnapshotMap.get(playerId);
      removedRows.push({
        player_id: playerId,
        player_name: cleanText(oldPlayer.player_name),
        gender,
        official_rank: "",
        official_points: "",
        old_rank: oldSnapshot?.rank ?? "",
        old_official_points: oldSnapshot?.official_points ?? "",
        calculated_points: "",
        point_difference: "",
        classification: "removed_from_top500",
        refresh_required: "false",
        refresh_reason: "",
        ledger_rows: 0,
        active_rows: 0,
        expired_rows: 0,
      });
    }
  }

  const allRows = [...comparisonRows, ...removedRows];
  const continuingPlayers = comparisonRows.filter(
    (row) => row.classification !== "new_top500_entrant"
  ).length;

  return {
    comparisonRows: allRows,
    continuingPlayers,
    exactMatches: comparisonRows.filter((row) => row.classification === "exact_match"),
    pointDifferences: comparisonRows.filter((row) => row.classification === "point_difference"),
    newEntrants: comparisonRows.filter((row) => row.classification === "new_top500_entrant"),
    removedRows,
    missingLedgerRows: comparisonRows.filter((row) => row.classification === "missing_ledger"),
    invalidPlayers: comparisonRows.filter((row) => row.classification === "invalid_player"),
    playersToRefresh: comparisonRows.filter((row) => row.refresh_required === "true"),
    playersToPreserve: comparisonRows.filter((row) => row.refresh_required === "false"),
  };
}

export function buildValidationSummary({
  oldRankingDate,
  expectedRankingDate,
  receivedRankingDate,
  baselinePolicy,
  stagedPolicy,
  baselineDropCutoff,
  stagedDropCutoff,
  baseline,
  officialCounts,
  oldTrackedTotal,
  comparison,
  warnings = [],
  errors = [],
  startedAt,
  finishedAt,
}) {
  const pointDiffValues = comparison.pointDifferences
    .map((row) => Math.abs(toNumber(row.point_difference) ?? 0))
    .sort((a, b) => b - a);

  return {
    old_ranking_date: oldRankingDate,
    new_ranking_date_expected: expectedRankingDate,
    new_ranking_date_received: receivedRankingDate,
    baseline_policy: baselinePolicy,
    staged_policy: stagedPolicy,
    baseline_drop_cutoff: baselineDropCutoff,
    staged_drop_cutoff: stagedDropCutoff,
    baseline_total: baseline.total,
    baseline_exact: baseline.exact,
    baseline_percentage:
      baseline.total > 0 ? roundToTwo((baseline.exact / baseline.total) * 100) : 0,
    official_total: officialCounts.total,
    official_male: officialCounts.male,
    official_female: officialCounts.female,
    old_tracked_total: oldTrackedTotal,
    continuing_players: comparison.continuingPlayers,
    exact_matches: comparison.exactMatches.length,
    point_differences: comparison.pointDifferences.length,
    new_top500_entrants: comparison.newEntrants.length,
    new_male: comparison.newEntrants.filter((row) => row.gender === "M").length,
    new_female: comparison.newEntrants.filter((row) => row.gender === "F").length,
    removed_from_top500: comparison.removedRows.length,
    removed_male: comparison.removedRows.filter((row) => row.gender === "M").length,
    removed_female: comparison.removedRows.filter((row) => row.gender === "F").length,
    missing_ledger: comparison.missingLedgerRows.length,
    players_to_refresh: comparison.playersToRefresh.length,
    exact_match_percentage_among_continuing:
      comparison.continuingPlayers > 0
        ? roundToTwo((comparison.exactMatches.length / comparison.continuingPlayers) * 100)
        : 0,
    sum_absolute_differences: roundToTwo(
      pointDiffValues.reduce((sum, value) => sum + value, 0)
    ),
    largest_absolute_difference: roundToTwo(pointDiffValues[0] || 0),
    official_snapshot_valid: officialCounts.valid,
    ledger_valid: comparison.ledgerValid,
    baseline_valid: baseline.valid,
    comparison_completed: comparison.completed,
    fully_reconciled:
      baseline.valid &&
      officialCounts.valid &&
      comparison.ledgerValid &&
      comparison.completed &&
      comparison.pointDifferences.length === 0 &&
      comparison.newEntrants.length === 0 &&
      comparison.missingLedgerRows.length === 0 &&
      comparison.invalidPlayers.length === 0,
    warnings,
    errors,
    started_at: startedAt,
    finished_at: finishedAt,
    duration:
      startedAt && finishedAt
        ? roundToTwo((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
        : 0,
  };
}
