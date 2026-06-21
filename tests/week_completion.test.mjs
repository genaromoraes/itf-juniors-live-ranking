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

  test("missing events are counted but tolerated after complete draws", () => {
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
    assert.equal(summary.blocking_missing_events, 0);
    assert.equal(summary.tolerated_missing_events, 1);
    assert.equal(summary.safe_to_close, true);
  });

  test("missing events still block when materialized draws are pending", () => {
    const summary = summarizeWeekCompletion({
      weekTournamentRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      weekMatchesRows: [
        matchRow({
          winner_side: "",
          winner_names: "",
          play_status_code: "TP",
          play_status_desc: "To be played",
        }),
      ],
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
    assert.equal(summary.blocking_missing_events, 1);
    assert.equal(summary.tolerated_missing_events, 0);
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

  test("summarizes pending matches by tournament", () => {
    const summary = summarizeWeekCompletion({
      weekTournamentRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      weekMatchesRows: [
        matchRow({
          round_name: "Semifinal",
          play_status_code: "NP",
          play_status_desc: "Not played",
          winner_side: "",
          winner_names: "",
        }),
        matchRow({
          round_name: "Final",
          play_status_code: "NP",
          play_status_desc: "Not played",
          winner_side: "",
          winner_names: "",
        }),
      ],
      weekResultsSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          category: "J100",
          events_found: "1",
          matches_found: "2",
        },
      ],
      currentDate: "2026-06-20",
      weekEnd: "2026-06-21",
    });

    assert.equal(summary.pending_matches, 2);
    assert.equal(summary.tournaments.length, 1);
    assert.equal(summary.tournaments[0].pending_matches, 2);
    assert.equal(summary.tournaments[0].matches_found, 2);
    assert.equal(summary.tournaments[0].status, "pending");
  });

  test("does not block closing when an unplayed early match no longer affects a completed draw", () => {
    const summary = summarizeWeekCompletion({
      weekTournamentRows: [{ tournament_key: "T1", tournament_name: "Tournament One" }],
      weekMatchesRows: [
        matchRow({
          round_name: "1st Round",
          round_order: "1",
          play_status_code: "NP",
          play_status_desc: "Not played",
          team1_player_ids: "A|B",
          team1_names: "Player A / Player B",
          team2_player_ids: "C|D",
          team2_names: "Player C / Player D",
          winner_side: "",
          winner_names: "",
          score: "",
        }),
        matchRow({
          round_name: "Quarter-finals",
          round_order: "2",
          team1_player_ids: "E|F",
          team1_names: "Player E / Player F",
          team2_player_ids: "",
          team2_names: "",
          winner_side: "1",
          winner_names: "Player E / Player F",
          score: "",
        }),
        matchRow({
          round_name: "Final",
          round_order: "4",
          team1_player_ids: "E|F",
          team1_names: "Player E / Player F",
          team2_player_ids: "G|H",
          team2_names: "Player G / Player H",
          winner_side: "1",
          winner_names: "Player E / Player F",
        }),
      ],
      weekResultsSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          category: "J200",
          events_found: "1",
          matches_found: "3",
        },
      ],
      currentDate: "2026-06-22",
      weekEnd: "2026-06-21",
    });

    assert.equal(summary.pending_matches, 0);
    assert.equal(summary.tournaments[0].status, "completed");
    assert.equal(summary.safe_to_close, true);
  });
});
