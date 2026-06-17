import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildIncludedExternalRows,
  getEligibleExternalCandidates,
  markIncludedCandidates,
  splitExternalCandidateLiveRows,
} from "../scripts/08_calculate_live_ranking_with_drops.mjs";
import {
  STATUS_FETCH_REQUIRED,
  STATUS_FETCHED,
  STATUS_INELIGIBLE,
  STATUS_INCLUDED,
  STATUS_WATCH,
  classifyExternalCandidates,
  collectExternalParticipants,
  summarizeCandidateLivePotential,
} from "../scripts/lib/external_candidates.mjs";

const pointsTableRows = [
  { category: "J100", event_type: "singles", round_label: "R16", points: "20" },
  { category: "J100", event_type: "singles", round_label: "QF", points: "30" },
  { category: "J100", event_type: "singles", round_label: "SF", points: "60" },
  { category: "J100", event_type: "singles", round_label: "F", points: "100" },
  { category: "J100", event_type: "doubles", round_label: "QF", points: "20" },
  { category: "J100", event_type: "doubles", round_label: "SF", points: "30" },
  { category: "J100", event_type: "doubles", round_label: "F", points: "60" },
];

function rankingRows() {
  return [
    ...Array.from({ length: 600 }, (_, index) => ({
      player_id: `m${index + 1}`,
      gender: "M",
      live_rank: String(index + 1),
      live_points: String(700 - index),
    })),
    ...Array.from({ length: 600 }, (_, index) => ({
      player_id: `f${index + 1}`,
      gender: "F",
      live_rank: String(index + 1),
      live_points: String(700 - index),
    })),
  ];
}

function liveRow(playerId, overrides = {}) {
  return {
    player_id: playerId,
    player_name: `Player ${playerId}`,
    gender: "M",
    country: "BRA",
    event_type: "singles",
    tournament_name: "J100 Example",
    category: "J100",
    draw_type: "main_draw",
    round: "QF",
    points: "30",
    status: "active",
    ...overrides,
  };
}

describe("external candidate detection", () => {
  test("collects only weekly participants outside the tracked base", () => {
    const participants = collectExternalParticipants({
      playersRows: [{ player_id: "tracked1" }],
      weekPlayerResultsRows: [
        liveRow("tracked1"),
        liveRow("external1", { tournament_name: "J100 Alpha" }),
      ],
      weekMatchesRows: [
        {
          team1_player_ids: "external2",
          team1_names: "External Two",
          team1_nationalities: "USA",
          team2_player_ids: "tracked1",
          team2_names: "Tracked One",
          team2_nationalities: "BRA",
          tournament_name: "J100 Beta",
          gender: "M",
        },
      ],
      weekLiveLedgerRows: [liveRow("external3")],
    });

    assert.deepEqual(
      participants.map((row) => row.player_id).sort(),
      ["external1", "external2", "external3"]
    );
  });

  test("classifies ineligible, watch and fetch-required candidates using ranking cutoffs", () => {
    const candidates = classifyExternalCandidates({
      participants: [
        { player_id: "low", gender: "M", tournaments: "J100 Example" },
        { player_id: "watch", gender: "M", tournaments: "J100 Example" },
        { player_id: "fetch", gender: "M", tournaments: "J100 Example" },
      ],
      universeRows: [
        { player_id: "low", gender: "M", rank: "1800", official_points: "1" },
        { player_id: "watch", gender: "M", rank: "1400", official_points: "60" },
        { player_id: "fetch", gender: "M", rank: "1100", official_points: "90" },
      ],
      weekLiveLedgerRows: [
        liveRow("low", { round: "R16", points: "20", status: "eliminated" }),
        liveRow("watch", { round: "QF", points: "30" }),
        liveRow("fetch", { round: "QF", points: "30" }),
      ],
      pointsTableRows,
      baseRankingRows: rankingRows(),
      now: "2026-06-17T00:00:00.000Z",
    });
    const byId = new Map(candidates.map((row) => [row.player_id, row]));

    assert.equal(byId.get("low").candidate_status, STATUS_INELIGIBLE);
    assert.equal(byId.get("watch").candidate_status, STATUS_WATCH);
    assert.equal(byId.get("fetch").candidate_status, STATUS_FETCH_REQUIRED);
    assert.equal(byId.get("fetch").breakdown_required, "true");
  });

  test("keeps doubles as raw points and uses 25 percent only in upper-bound math", () => {
    const summary = summarizeCandidateLivePotential({
      playerId: "external1",
      weekLiveLedgerRows: [
        liveRow("external1", {
          event_type: "doubles",
          round: "QF",
          points: "20",
        }),
      ],
      pointsTableRows,
    });

    assert.equal(summary.guaranteed_doubles_raw_points, 20);
    assert.equal(summary.guaranteed_doubles_weighted_points, 5);
    assert.equal(summary.maximum_doubles_raw_points, 60);
    assert.equal(summary.maximum_doubles_weighted_points, 15);
  });
});

describe("external candidates in live ranking", () => {
  test("uses only fetched or included candidates and keeps other external rows ignored", () => {
    const trackedIds = new Set(["tracked1"]);
    const candidates = [
      { player_id: "external1", candidate_status: STATUS_FETCHED },
      { player_id: "external2", candidate_status: STATUS_WATCH },
    ];
    const eligible = getEligibleExternalCandidates(candidates, trackedIds);
    const split = splitExternalCandidateLiveRows(
      [liveRow("external1"), liveRow("external2"), liveRow("external3")],
      eligible
    );

    assert.deepEqual(eligible.map((row) => row.player_id), ["external1"]);
    assert.deepEqual(
      split.externalCandidateLiveRows.map((row) => row.player_id),
      ["external1"]
    );
    assert.deepEqual(
      split.ignoredUntrackedLiveRows.map((row) => row.player_id),
      ["external2", "external3"]
    );
  });

  test("marks included candidates and records whether they entered the displayed top 500", () => {
    const candidates = [
      {
        player_id: "external1",
        player_name: "External One",
        gender: "M",
        official_rank: "1001",
        official_points: "90",
        candidate_status: STATUS_FETCHED,
        tournaments: "J100 Example",
      },
    ];
    const included = buildIncludedExternalRows(
      [
        {
          player_id: "external1",
          player_name: "External One",
          gender: "M",
          official_rank: "1001",
          official_points_for_comparison: "90",
          live_rank: "499",
          live_points: "130",
        },
      ],
      candidates
    );
    const next = markIncludedCandidates(candidates, included);

    assert.equal(included[0].entered_top500, "true");
    assert.equal(included[0].candidate_status, STATUS_INCLUDED);
    assert.equal(next[0].candidate_status, STATUS_INCLUDED);
    assert.equal(next[0].breakdown_fetched, "true");
  });
});
