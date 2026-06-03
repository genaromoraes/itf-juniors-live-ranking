import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildLivePointRows } from "../scripts/06_calculate_week_live_points.mjs";

const MAX_COUNTING_RESULTS = 6;
const DOUBLES_WEIGHT = 0.25;

const JGS_POINTS = {
  singles: {
    R16: 180,
  },
  doubles: {
    R16: 135,
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

function getJuniorPoints({ category, eventType, round, wonMatch = true }) {
  if (!wonMatch) return 0;

  return JGS_POINTS[eventType]?.[round] ?? 0;
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
      ["JGS|doubles|main_draw|R16", 180],
    ]);

    const [row] = buildLivePointRows(playerResults, matchRows, pointsMap);

    assert.equal(row.calculated_round_label, "R16");
    assert.equal(row.live_points_raw, 135);
    assert.equal(row.live_points_weighted, 33.75);
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
