import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildIncludedExternalRows,
  getEligibleExternalCandidates,
  markIncludedCandidates,
  splitExternalCandidateLiveRows,
} from "../scripts/08_calculate_live_ranking_with_drops.mjs";
import {
  getRawBreakdownPath,
  readCachedBreakdown,
  saveRawBreakdown,
} from "../scripts/lib/player_breakdown.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  STATUS_BLOCKED,
  STATUS_FETCH_REQUIRED,
  STATUS_FETCHED,
  STATUS_FETCH_ERROR,
  STATUS_INELIGIBLE,
  STATUS_INCLUDED,
  STATUS_WATCH,
  classifyExternalCandidates,
  collectExternalParticipants,
  getUnresolvedPublicCandidates,
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
    ...Array.from({ length: 1000 }, (_, index) => ({
      player_id: `m${index + 1}`,
      gender: "M",
      live_rank: String(index + 1),
      live_points: String(1100 - index),
    })),
    ...Array.from({ length: 1000 }, (_, index) => ({
      player_id: `f${index + 1}`,
      gender: "F",
      live_rank: String(index + 1),
      live_points: String(1100 - index),
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
  test("unknown official points require lookup rather than exclusion as zero", () => {
    const candidates = classifyExternalCandidates({
      participants: [{ player_id: "unknown", gender: "M" }],
      universeRows: [], baseRankingRows: rankingRows(), pointsTableRows,
    });
    assert.equal(candidates[0].official_points, "");
    assert.equal(candidates[0].official_points_status, "UNKNOWN");
    assert.equal(candidates[0].candidate_status, "LOOKUP_REQUIRED");
    assert.equal(candidates[0].breakdown_required, "true");
    assert.equal(getUnresolvedPublicCandidates(candidates).length, 1);
  });

  test("fetched status is trusted only for the same official week and points", () => {
    const common = {
      participants: [{ player_id: "outside", gender: "M" }],
      universeRows: [{ player_id: "outside", gender: "M", rank: "1001", official_points: "110", ranking_date: "2026-09-07" }],
      baseRankingRows: rankingRows(), pointsTableRows,
    };
    for (const [date, points, expected] of [
      ["2026-08-31", "110", STATUS_FETCH_REQUIRED],
      ["2026-09-07", "109", STATUS_FETCH_REQUIRED],
      ["2026-09-07", "110", STATUS_FETCHED],
    ]) {
      const [candidate] = classifyExternalCandidates({ ...common, existingCandidates: [{
        player_id: "outside", ranking_date: date, official_points: points,
        candidate_status: STATUS_FETCHED, breakdown_fetched: "true",
      }] });
      assert.equal(candidate.candidate_status, expected);
    }
  });

  test("finds non-playing outsiders who can cross or tie the cutoff after others lose points", () => {
    const universeRows = [
      { player_id: "tracked1", gender: "M", official_points: "150" },
      { player_id: "idle-boy", gender: "M", rank: "1020", official_points: "102", ranking_date: "2026-09-07" },
      { player_id: "idle-girl", gender: "F", rank: "1001", official_points: "101", ranking_date: "2026-09-07" },
      { player_id: "idle-low", gender: "M", rank: "1800", official_points: "20", ranking_date: "2026-09-07" },
    ];
    const participants = collectExternalParticipants({
      playersRows: [{ player_id: "tracked1" }],
      universeRows,
    });
    const candidates = classifyExternalCandidates({
      participants, universeRows, baseRankingRows: rankingRows(), pointsTableRows,
    });
    const byId = new Map(candidates.map(row => [row.player_id, row]));
    assert.equal(byId.has("tracked1"), false);
    for (const id of ["idle-boy", "idle-girl"]) {
      assert.equal(byId.get(id).candidate_status, STATUS_FETCH_REQUIRED);
      assert.equal(byId.get(id).guaranteed_singles_points, 0);
      assert.equal(byId.get(id).sources, "rankings_universe");
      assert.equal(byId.get(id).tournaments, "");
    }
    assert.equal(byId.get("idle-low").candidate_status, STATUS_INELIGIBLE);
    assert.equal(getUnresolvedPublicCandidates(candidates).length, 2);
  });

  test("deduplicates ranking and weekly sources while retaining players beyond the fixed buffer", () => {
    const universeRows = [
      { player_id: "far-outside", gender: "M", rank: "2500", official_points: "80", ranking_date: "2026-09-07" },
    ];
    const weekLiveLedgerRows = [liveRow("far-outside")];
    const participants = collectExternalParticipants({
      playersRows: [], universeRows, weekLiveLedgerRows,
      weekPlayerResultsRows: [liveRow("far-outside")],
    });
    assert.equal(participants.length, 1);
    assert.equal(participants[0].tournaments, "J100 Example");
    assert.deepEqual(participants[0].sources.split(" | "), [
      "rankings_universe", "week_live_ledger_rows", "week_player_results",
    ]);
    const [candidate] = classifyExternalCandidates({
      participants, universeRows, weekLiveLedgerRows, baseRankingRows: rankingRows(), pointsTableRows,
    });
    assert.equal(candidate.candidate_status, STATUS_FETCH_REQUIRED);
    assert.equal(candidate.guaranteed_upper_bound, 110);
  });

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
        { player_id: "low", gender: "M", rank: "1800", official_points: "1", ranking_date: "2026-06-15" },
        { player_id: "watch", gender: "M", rank: "1400", official_points: "60", ranking_date: "2026-06-15" },
        { player_id: "fetch", gender: "M", rank: "1100", official_points: "90", ranking_date: "2026-06-15" },
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
    assert.equal(byId.get("fetch").ranking_date, "2026-06-15");
    assert.equal(byId.get("fetch").public_cutoff_points, 101);
  });

  test("FETCH_ERROR can return to the queue when the candidate is still eligible", () => {
    const [candidate] = classifyExternalCandidates({
      participants: [{ player_id: "fetch", gender: "M", tournaments: "J100 Example" }],
      universeRows: [
        {
          player_id: "fetch",
          gender: "M",
          rank: "1100",
          official_points: "90",
          ranking_date: "2026-06-15",
        },
      ],
      weekLiveLedgerRows: [liveRow("fetch", { round: "QF", points: "30" })],
      pointsTableRows,
      baseRankingRows: rankingRows(),
      existingCandidates: [
        {
          player_id: "fetch",
          candidate_status: STATUS_FETCH_ERROR,
          reason: "old_network_error",
        },
      ],
      now: "2026-06-17T00:00:00.000Z",
    });

    assert.equal(candidate.candidate_status, STATUS_FETCH_REQUIRED);
    assert.equal(candidate.breakdown_required, "true");
  });

  test("BLOCKED can return to the queue after the retry window but remains blocked before it", () => {
    const common = {
      participants: [{ player_id: "blocked", gender: "M", tournaments: "J100 Example" }],
      universeRows: [
        {
          player_id: "blocked",
          gender: "M",
          rank: "1100",
          official_points: "90",
          ranking_date: "2026-06-15",
        },
      ],
      weekLiveLedgerRows: [liveRow("blocked", { round: "QF", points: "30" })],
      pointsTableRows,
      baseRankingRows: rankingRows(),
      existingCandidates: [
        {
          player_id: "blocked",
          candidate_status: STATUS_BLOCKED,
          reason: "blocked_by_itf",
          updated_at: "2026-06-17T00:00:00.000Z",
        },
      ],
      blockedRetryMs: 60 * 60 * 1000,
    };
    const [stillBlocked] = classifyExternalCandidates({
      ...common,
      now: "2026-06-17T00:30:00.000Z",
    });
    const [retryable] = classifyExternalCandidates({
      ...common,
      now: "2026-06-17T02:00:00.000Z",
    });

    assert.equal(stillBlocked.candidate_status, STATUS_BLOCKED);
    assert.equal(stillBlocked.updated_at, "2026-06-17T00:00:00.000Z");
    assert.equal(retryable.candidate_status, STATUS_FETCH_REQUIRED);
  });

  test("candidate cache is keyed by ranking_date instead of updated_at", async () => {
    const rawDir = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-cache-"));
    const player = {
      player_id: "external1",
      player_name: "External One",
      gender: "M",
      country: "BRA",
    };
    const first = await saveRawBreakdown({
      rawDir,
      rankingDate: "2026-06-15",
      player,
      sourceUrl: "https://example.test",
      json: { items: [{ id: 1 }] },
    });
    const secondPath = getRawBreakdownPath({
      rawDir,
      rankingDate: "2026-06-15",
      player,
    });
    const cached = await readCachedBreakdown({
      rawDir,
      rankingDate: "2026-06-15",
      player,
    });

    assert.equal(first, secondPath);
    assert.equal(cached.rawFile, first);
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

  test("reports every unresolved public candidate even when the queue is larger than ten", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      player_id: `external-${index + 1}`,
      guaranteed_upper_bound: "120",
      public_cutoff_points: "100",
      candidate_status: STATUS_FETCH_REQUIRED,
    }));

    assert.equal(getUnresolvedPublicCandidates(candidates).length, 12);
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

  test("marks included candidates and records the public and legacy Top 500 boundaries", () => {
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
          live_rank: "999",
          live_points: "130",
        },
      ],
      candidates
    );
    const next = markIncludedCandidates(candidates, included);

    assert.equal(included[0].entered_public_ranking, "true");
    assert.equal(included[0].entered_top500, "false");
    assert.equal(included[0].participated_in_final_calculation, "true");
    assert.equal(included[0].candidate_status, STATUS_INCLUDED);
    assert.equal(next[0].candidate_status, STATUS_INCLUDED);
    assert.equal(next[0].breakdown_fetched, "true");
  });
});
