import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countNewMatchResults,
  isActualMatchResult,
} from "../scripts/24_write_week_action_summary.mjs";

function match(overrides = {}) {
  return {
    tournament_key: "J-J100-TEST-2026-001",
    event_id: "event-1",
    match_id: "match-1",
    play_status_code: "NP",
    result_status_code: "",
    winner_side: "",
    winner_names: "",
    score: "",
    ...overrides,
  };
}

test("counts a newly completed match result", () => {
  const previousRows = [match()];
  const currentRows = [
    match({
      play_status_code: "PC",
      winner_side: "1",
      winner_names: "Player One",
      score: "6-3 6-4",
    }),
  ];

  assert.equal(countNewMatchResults(currentRows, previousRows), 1);
});

test("does not recount a result already present in the previous scrape", () => {
  const completed = match({
    play_status_code: "PC",
    winner_side: "1",
    winner_names: "Player One",
  });

  assert.equal(countNewMatchResults([completed], [completed]), 0);
});

test("walkovers count as results but byes and cancellations do not", () => {
  assert.equal(isActualMatchResult(match({ result_status_code: "W/O" })), true);
  assert.equal(isActualMatchResult(match({ result_status_code: "BYE" })), false);
  assert.equal(
    isActualMatchResult(
      match({ result_status_code: "BYE", winner_side: "1", winner_names: "Player One" })
    ),
    false
  );
  assert.equal(
    isActualMatchResult(match({ result_status_code: "CANCELLED" })),
    false
  );
});
