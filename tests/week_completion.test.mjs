import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyEventCompletion,
  isFinalRound,
  summarizeWeekCompletion,
} from "../scripts/lib/week_completion.mjs";

function matchRow(overrides = {}) {
  return {
    tournament_key: "T1",
    tournament_name: "Tournament One",
    event_id: "E1",
    player_type_code: "B",
    player_type_desc: "Boys",
    match_type_code: "S",
    match_type_desc: "Singles",
    event_classification_code: "M",
    round_name: "Final",
    round_order: "4",
    play_status_code: "PC",
    play_status_desc: "Played and completed",
    result_status_code: "",
    result_status_desc: "",
    winner_side: "1",
    winner_names: "Player One",
    score: "6-2 6-2",
    ...overrides,
  };
}

describe("week completion detector", () => {
  test("final with winner is completed", () => {
    const result = classifyEventCompletion([matchRow()]);
    assert.equal(result.status, "completed");
  });

  test("final without winner is pending", () => {
    const result = classifyEventCompletion([
      matchRow({ winner_side: "", winner_names: "" }),
    ]);
    assert.equal(result.status, "pending");
    assert.equal(result.reason, "final_without_winner");
  });

  test("semifinal is not mistaken for final", () => {
    assert.equal(isFinalRound("Semifinal"), false);
    const result = classifyEventCompletion([
      matchRow({ round_name: "Semifinal", winner_side: "1" }),
    ]);
    assert.equal(result.status, "pending");
    assert.equal(result.reason, "final_not_found");
  });

  test("cancelled event without champion is review_required", () => {
    const result = classifyEventCompletion([
      matchRow({
        round_name: "Final",
        play_status_desc: "Cancelled",
        play_status_code: "CA",
        winner_side: "",
        winner_names: "",
      }),
    ]);
    assert.equal(result.status, "review_required");
  });

  test("bye or walkover terminal does not block alone", () => {
    const result = classifyEventCompletion([
      matchRow({
        round_name: "Final",
        play_status_code: "NP",
        play_status_desc: "Not played",
        result_status_code: "WO",
        result_status_desc: "Walkover",
      }),
    ]);
    assert.equal(result.status, "completed");
  });

  test("missing events are counted from summary", () => {
    const summary = summarizeWeekCompletion({
      weekTournamentRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      weekMatchesRows: [matchRow()],
      weekResultsSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          events_found: "2",
        },
      ],
      weekResultsErrorsRows: [],
      currentDate: "2026-06-22",
      weekEnd: "2026-06-21",
    });

    assert.equal(summary.missing_events, 1);
    assert.equal(summary.safe_to_close, false);
  });

  test("results errors block closing", () => {
    const summary = summarizeWeekCompletion({
      weekTournamentRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      weekMatchesRows: [matchRow()],
      weekResultsSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          events_found: "1",
        },
      ],
      weekResultsErrorsRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      currentDate: "2026-06-22",
      weekEnd: "2026-06-21",
    });

    assert.equal(summary.results_errors, 1);
    assert.equal(summary.safe_to_close, false);
  });
});
