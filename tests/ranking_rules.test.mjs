import assert from "node:assert/strict";
import { describe, test } from "node:test";

const MAX_COUNTING_RESULTS = 6;
const DOUBLES_WEIGHT = 0.25;

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
});
