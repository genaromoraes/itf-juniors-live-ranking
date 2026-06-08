import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildLivePointRows } from "../scripts/06_calculate_week_live_points.mjs";

const MAX_COUNTING_RESULTS = 6;
const DOUBLES_WEIGHT = 0.25;
const TIE_BREAK_CATEGORIES = ["JGS", "J500", "J300", "J200", "J100", "J60", "J30"];

const OFFICIAL_POINTS_2026 = {
  singles: {
    JGS: { R32: 90, R16: 180, QF: 300, SF: 490, F: 700, W: 1000 },
    J500: { R32: 45, R16: 90, QF: 150, SF: 250, F: 350, W: 500 },
    J300: { R32: 30, R16: 60, QF: 100, SF: 140, F: 210, W: 300 },
    J200: { R32: 18, R16: 36, QF: 60, SF: 100, F: 140, W: 200 },
    J100: { R32: 5, R16: 10, QF: 20, SF: 36, F: 60, W: 100 },
    J60: { R32: 0, R16: 5, QF: 10, SF: 18, F: 36, W: 60 },
    J30: { R32: 0, R16: 2, QF: 5, SF: 9, F: 18, W: 30 },
  },
  doubles: {
    JGS: { R32: 0, R16: 135, QF: 225, SF: 367, F: 525, W: 750 },
    J500: { R32: 0, R16: 67, QF: 112, SF: 187, F: 262, W: 375 },
    J300: { R32: 0, R16: 45, QF: 75, SF: 105, F: 157, W: 225 },
    J200: { R32: 0, R16: 27, QF: 45, SF: 75, F: 105, W: 150 },
    J100: { R32: 0, R16: 7, QF: 15, SF: 27, F: 45, W: 75 },
    J60: { R32: 0, R16: 0, QF: 7, SF: 14, F: 27, W: 45 },
    J30: { R32: 0, R16: 0, QF: 3, SF: 6, F: 13, W: 25 },
  },
};

function toValidPoint(value) {
  if (value === "" || value === null || value === undefined) return null;

  const point = Number(value);

  if (!Number.isFinite(point) || point <= 0) return null;

  return point;
}

function getBestResults(points, limit = MAX_COUNTING_RESULTS) {
  return points
    .map(toValidPoint)
    .filter((point) => point !== null)
    .sort((a, b) => b - a)
    .slice(0, limit);
}

function sumBestSingles(points) {
  return getBestResults(points).reduce((total, point) => total + point, 0);
}

function calculateWeightedDoubles(points) {
  return sumBestSingles(points) * DOUBLES_WEIGHT;
}

function calculateRankingPoints({ singles = [], doubles = [] }) {
  return sumBestSingles(singles) + calculateWeightedDoubles(doubles);
}

function buildTieBreakVector({ singles = [], doubles = [] }) {
  const categoryPoints = (results) =>
    TIE_BREAK_CATEGORIES.map((category) =>
      results
        .filter((result) => result.counting !== false && result.category === category)
        .reduce((total, result) => total + toValidPoint(result.points), 0)
    );

  return [...categoryPoints(singles), ...categoryPoints(doubles)];
}

function compareTieBreakVectorDesc(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] || 0) - (a[i] || 0);

    if (diff !== 0) return diff;
  }

  return 0;
}

function getJuniorPoints({ category, eventType, round, wonMatch = true }) {
  if (!wonMatch) return 0;

  return OFFICIAL_POINTS_2026[eventType]?.[category]?.[round] ?? 0;
}

function dropResult(points, droppedPoint) {
  const drop = toValidPoint(droppedPoint);
  let removed = false;

  return points.filter((point) => {
    if (!removed && toValidPoint(point) === drop) {
      removed = true;
      return false;
    }

    return true;
  });
}

describe("ITF Junior ranking rules", () => {
  test("sums only the 6 best singles results", () => {
    const points = [500, 300, 200, 100, 60, 30, 10];

    assert.equal(sumBestSingles(points), 1190);
  });

  test("sums only the 6 best doubles results and applies 25% weight", () => {
    const points = [500, 300, 200, 100, 60, 30, 10];

    assert.equal(calculateWeightedDoubles(points), 297.5);
  });

  test("calculates total points with singles plus weighted doubles", () => {
    const singles = [500, 300, 200, 100, 60, 30];
    const doubles = [500, 300, 200, 100, 60, 30];

    assert.equal(calculateRankingPoints({ singles, doubles }), 1487.5);
  });

  test("ignores zero, empty, null, and invalid point values", () => {
    const points = [500, "", null, "abc", 300, 100, 0];

    assert.equal(sumBestSingles(points), 900);
  });

  test("simulates a drop by removing an expired result", () => {
    const beforeDrop = [500, 300, 200, 100, 60, 30];
    const afterDrop = dropResult(beforeDrop, 500);

    assert.deepEqual(afterDrop, [300, 200, 100, 60, 30]);
    assert.equal(sumBestSingles(afterDrop), 690);
  });

  test("simulates a live result entering the top 6", () => {
    const base = [500, 300, 200, 100, 60, 30];
    const live = 180;
    const bestWithLive = getBestResults([...base, live]);

    assert.deepEqual(bestWithLive, [500, 300, 200, 180, 100, 60]);
    assert.equal(sumBestSingles(bestWithLive), 1340);
  });

  test("breaks total-point ties by counting singles category points first", () => {
    const grandSlamSingles = buildTieBreakVector({
      singles: [{ category: "JGS", points: 180 }],
    });

    const j500Singles = buildTieBreakVector({
      singles: [{ category: "J500", points: 180 }],
    });

    assert.ok(compareTieBreakVectorDesc(grandSlamSingles, j500Singles) < 0);
  });

  test("ignores non-counting results in ranking tie-breaks", () => {
    const playerWithNonCountingGrandSlam = buildTieBreakVector({
      singles: [
        { category: "JGS", points: 180, counting: false },
        { category: "J500", points: 180 },
      ],
    });

    const playerWithCountingGrandSlam = buildTieBreakVector({
      singles: [{ category: "JGS", points: 180 }],
    });

    assert.ok(
      compareTieBreakVectorDesc(
        playerWithCountingGrandSlam,
        playerWithNonCountingGrandSlam
      ) < 0
    );
  });

  test("uses doubles category points only after all singles category tie-breaks", () => {
    const singlesJ300 = buildTieBreakVector({
      singles: [{ category: "J300", points: 60 }],
    });

    const doublesJGS = buildTieBreakVector({
      doubles: [{ category: "JGS", points: 750 }],
    });

    assert.ok(compareTieBreakVectorDesc(singlesJ300, doublesJGS) < 0);
  });

  test("JGS doubles R16 is worth 135 raw points", () => {
    const points = getJuniorPoints({
      category: "JGS",
      eventType: "doubles",
      round: "R16",
    });

    assert.equal(points, 135);
  });

  test("JGS doubles R16 is worth 33.75 weighted ranking points", () => {
    const rawPoints = getJuniorPoints({
      category: "JGS",
      eventType: "doubles",
      round: "R16",
    });

    assert.equal(rawPoints * DOUBLES_WEIGHT, 33.75);
  });

  test("JGS singles first-round loss is worth 0 live points", () => {
    const points = getJuniorPoints({
      category: "JGS",
      eventType: "singles",
      round: "R128",
      wonMatch: false,
    });

    assert.equal(points, 0);
  });

  test("JGS singles R16 remains worth 180 raw points", () => {
    const points = getJuniorPoints({
      category: "JGS",
      eventType: "singles",
      round: "R16",
    });

    assert.equal(points, 180);
  });

  test("2026 official singles table values are used for lower grades", () => {
    assert.equal(getJuniorPoints({ category: "J500", eventType: "singles", round: "SF" }), 250);
    assert.equal(getJuniorPoints({ category: "J300", eventType: "singles", round: "QF" }), 100);
    assert.equal(getJuniorPoints({ category: "J100", eventType: "singles", round: "R16" }), 10);
    assert.equal(getJuniorPoints({ category: "J60", eventType: "singles", round: "R32" }), 0);
    assert.equal(getJuniorPoints({ category: "J30", eventType: "singles", round: "R16" }), 2);
  });

  test("2026 official doubles table values are used directly as raw points", () => {
    assert.equal(getJuniorPoints({ category: "JGS", eventType: "doubles", round: "SF" }), 367);
    assert.equal(getJuniorPoints({ category: "J500", eventType: "doubles", round: "R16" }), 67);
    assert.equal(getJuniorPoints({ category: "J300", eventType: "doubles", round: "F" }), 157);
    assert.equal(getJuniorPoints({ category: "J30", eventType: "doubles", round: "W" }), 25);
  });

  test("production live calculation gives JGS doubles R16 135 raw and 33.75 weighted points", () => {
    const playerResults = [
      {
        tournament_key: "J-JGS-FRA-2026-001",
        tournament_name: "Roland Garros Junior Championships",
        category: "JGS",
        player_id: "800655335",
        player_name: "Victoria Luiza Barros",
        player_type_code: "G",
        match_type_code: "D",
        event_classification_code: "M",
        wins: "1",
        losses: "0",
        status: "still_alive_or_champion",
      },
    ];

    const matchRows = [
      {
        tournament_key: "J-JGS-FRA-2026-001",
        player_type_code: "G",
        match_type_code: "D",
        event_classification_code: "M",
        round_order: "5",
      },
    ];

    const pointsMap = new Map([
      ["JGS|doubles|main_draw|R16", 135],
    ]);

    const [row] = buildLivePointRows(playerResults, matchRows, pointsMap);

    assert.equal(row.calculated_round_label, "R16");
    assert.equal(row.live_points_raw, 135);
    assert.equal(row.live_points_weighted, 33.75);
  });

  test("production live calculation uses official J500 doubles R16 raw points", () => {
    const playerResults = [
      {
        tournament_key: "J-J500-BRA-2026-001",
        tournament_name: "J500 Example",
        category: "J500",
        player_id: "123",
        player_name: "Player Example",
        player_type_code: "B",
        match_type_code: "D",
        event_classification_code: "M",
        wins: "1",
        losses: "0",
        status: "still_alive_or_champion",
      },
    ];

    const matchRows = [
      {
        tournament_key: "J-J500-BRA-2026-001",
        player_type_code: "B",
        match_type_code: "D",
        event_classification_code: "M",
        round_order: "5",
      },
    ];

    const pointsMap = new Map([
      ["J500|doubles|main_draw|R16", 67],
    ]);

    const [row] = buildLivePointRows(playerResults, matchRows, pointsMap);

    assert.equal(row.calculated_round_label, "R16");
    assert.equal(row.live_points_raw, 67);
    assert.equal(row.live_points_weighted, 16.75);
  });

  test("production live calculation gives a JGS singles first-round loss 0 live points", () => {
    const playerResults = [
      {
        tournament_key: "J-JGS-FRA-2026-001",
        tournament_name: "Roland Garros Junior Championships",
        category: "JGS",
        player_id: "800756804",
        player_name: "Eduarda Gomes",
        player_type_code: "G",
        match_type_code: "S",
        event_classification_code: "M",
        wins: "0",
        losses: "1",
        status: "eliminated",
      },
    ];

    const matchRows = [
      {
        tournament_key: "J-JGS-FRA-2026-001",
        player_type_code: "G",
        match_type_code: "S",
        event_classification_code: "M",
        round_order: "6",
      },
    ];

    const pointsMap = new Map([
      ["JGS|singles|main_draw|R64", 30],
    ]);

    const [row] = buildLivePointRows(playerResults, matchRows, pointsMap);

    assert.equal(row.calculated_round_label, "R64");
    assert.equal(row.live_points_raw, 0);
    assert.equal(row.live_points_weighted, 0);
  });
});
