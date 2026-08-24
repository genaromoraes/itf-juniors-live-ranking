import fs from "node:fs";
import path from "node:path";

export const BASE_STATE_LEGACY_500 = "LEGACY_BASE_500";
export const BASE_STATE_TOP1000_STAGING = "TOP1000_STAGING";
export const BASE_STATE_TOP1000_ACTIVE = "TOP1000_ACTIVE";

export const LEGACY_BASE_LIMIT_PER_GENDER = 500;
export const TOP1000_BASE_LIMIT_PER_GENDER = 1000;
export const DISPLAY_LIMIT_PER_GENDER = 500;
export const INVESTIGATION_RANK_PER_GENDER = 600;

export const TRACKED_BASE_LIMIT_PER_GENDER = TOP1000_BASE_LIMIT_PER_GENDER;
export const TRACKED_BASE_TOTAL = TRACKED_BASE_LIMIT_PER_GENDER * 2;
export const LEGACY_BASE_TOTAL = LEGACY_BASE_LIMIT_PER_GENDER * 2;
export const DISPLAY_TOTAL = DISPLAY_LIMIT_PER_GENDER * 2;
export const MIN_SAFE_RECONCILIATION_EXACT_PERCENTAGE = 99.75;

export const EXTERNAL_CANDIDATE_FALLBACK_MARGIN = 40;

export const BASE_STATE_FILE = path.join("data", "config", "base_state.json");

export function isSafePartialReconciliation({
  exact,
  total,
  expectedTotal = TRACKED_BASE_TOTAL,
  minimumExactPercentage = MIN_SAFE_RECONCILIATION_EXACT_PERCENTAGE,
}) {
  const exactNumber = Number(exact);
  const totalNumber = Number(total);
  const expectedTotalNumber = Number(expectedTotal);

  if (
    !Number.isFinite(exactNumber) ||
    !Number.isFinite(totalNumber) ||
    !Number.isFinite(expectedTotalNumber) ||
    totalNumber !== expectedTotalNumber ||
    totalNumber <= 0 ||
    exactNumber < 0 ||
    exactNumber > totalNumber
  ) {
    return false;
  }

  return (exactNumber / totalNumber) * 100 >= minimumExactPercentage;
}

export function validateCompetitionRanks(values, expectedCount) {
  const ranks = values
    .map((value) => Number(value))
    .sort((a, b) => a - b);

  if (ranks.length !== expectedCount) {
    return {
      valid: false,
      index: -1,
      expected: expectedCount,
      received: ranks.length,
      reason: "count",
    };
  }

  let previousRank = 0;
  for (let index = 0; index < ranks.length; index++) {
    const rank = ranks[index];
    const ordinalRank = index + 1;
    const validRank =
      Number.isInteger(rank) &&
      rank > 0 &&
      (rank === previousRank || rank === ordinalRank);

    if (!validRank) {
      return {
        valid: false,
        index,
        expected: previousRank || ordinalRank,
        received: rank,
        reason: "sequence",
      };
    }

    previousRank = rank;
  }

  return { valid: true, ranks };
}

const VALID_BASE_STATES = new Set([
  BASE_STATE_LEGACY_500,
  BASE_STATE_TOP1000_STAGING,
  BASE_STATE_TOP1000_ACTIVE,
]);

export function getBaseState({ cwd = process.cwd() } = {}) {
  const filePath = path.resolve(cwd, BASE_STATE_FILE);

  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const state = String(manifest.state || "").trim();
    if (VALID_BASE_STATES.has(state)) return state;
  } catch {
    // Missing or invalid state is treated as legacy until promotion writes
    // a validated manifest.
  }

  return BASE_STATE_LEGACY_500;
}

export function getActiveBaseLimitPerGender(options = {}) {
  return getBaseState(options) === BASE_STATE_TOP1000_ACTIVE
    ? TOP1000_BASE_LIMIT_PER_GENDER
    : LEGACY_BASE_LIMIT_PER_GENDER;
}

export function getActiveBaseTotal(options = {}) {
  return getActiveBaseLimitPerGender(options) * 2;
}

export function getBaseStateLabel(options = {}) {
  return getBaseState(options);
}
