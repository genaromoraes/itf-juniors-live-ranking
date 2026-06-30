import assert from "node:assert/strict";
import { test } from "node:test";
import { getMatchResultsUpdatedAt } from "../scripts/09_generate_live_ranking_html.mjs";

test("results update uses the latest match collection timestamp", () => {
  const updatedAt = getMatchResultsUpdatedAt([
    { collected_at: "2026-06-29T14:35:17.058Z" },
    { collected_at: "2026-06-30T11:30:05.600Z" },
    { collected_at: "" },
  ]);

  assert.equal(updatedAt, "2026-06-30T11:30:05.600Z");
});

test("results update stays empty when no match data was collected", () => {
  assert.equal(getMatchResultsUpdatedAt([]), "");
  assert.equal(getMatchResultsUpdatedAt([{ collected_at: "" }]), "");
});
