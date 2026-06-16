import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BASELINE_POLICY,
  calculateLedgerPoints,
} from "../scripts/lib/official_ledger_validation.mjs";
import {
  FINAL_VALIDATION_POLICY,
  buildPlayersNext,
  buildReconciledLedger,
  isSafeForPromotion,
  runFinalValidation,
  sortLedgerRows,
  validateInputs,
  validateLedgerForOfficialPlayers,
} from "../scripts/lib/official_breakdown_reconciliation.mjs";
import { buildSummary } from "../scripts/19_refresh_selected_breakdowns.mjs";

function officialPlayer(index, overrides = {}) {
  const gender = index <= 500 ? "M" : "F";
  return {
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    first_name: "Player",
    last_name: String(index),
    gender,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    current_rank: gender === "M" ? index : index - 500,
    current_points: "100",
    first_seen_date: "2026-06-15",
    last_seen_date: "2026-06-15",
    ...overrides,
  };
}

function officialSnapshot(index, overrides = {}) {
  const gender = index <= 500 ? "M" : "F";
  return {
    ranking_date: "2026-06-15",
    gender,
    rank: gender === "M" ? index : index - 500,
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    official_points: "100",
    ...overrides,
  };
}

function ledgerRow(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player 1",
    gender: "M",
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    event_type: "singles",
    countable_status: "countable",
    tournament_name: "Tournament",
    category: "J100",
    draw_type: "main_draw",
    host_nation: "Brazil",
    host_nation_code: "BRA",
    surface: "Clay",
    surface_code: "C",
    start_date: "2026-01-01",
    drop_date_calculated: "2026-12-31",
    round: "W",
    points: "100",
    tournament_link: "https://example.test",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_from_initial_breakdown",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function fullOfficialPlayers() {
  return Array.from({ length: 1000 }, (_, index) => officialPlayer(index + 1));
}

function fullOfficialSnapshot() {
  return Array.from({ length: 1000 }, (_, index) => officialSnapshot(index + 1));
}

function validationSummary(overrides = {}) {
  return {
    comparison_completed: true,
    baseline_valid: true,
    official_snapshot_valid: true,
    new_ranking_date_received: "2026-06-15",
    official_total: 1000,
    official_male: 500,
    official_female: 500,
    players_to_refresh: 57,
    point_differences: 47,
    new_top500_entrants: 10,
    removed_from_top500: 2,
    missing_ledger: 0,
    ...overrides,
  };
}

function refreshRows() {
  return [
    ...Array.from({ length: 47 }, (_, index) => ({
      ...officialPlayer(index + 1),
      classification: "point_difference",
      refresh_required: "true",
      refresh_reason: "point_difference",
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      ...officialPlayer(index + 48),
      classification: "new_top500_entrant",
      refresh_required: "true",
      refresh_reason: "new_top500_entrant",
    })),
  ];
}

describe("official breakdown reconciliation", () => {
  test("validates guardrails from the official rollover artifact", () => {
    const result = validateInputs({
      validationSummary: validationSummary(),
      officialPlayers: fullOfficialPlayers(),
      officialSnapshot: fullOfficialSnapshot(),
      playersToRefresh: refreshRows(),
      playersToPreserve: [],
      newEntrants: refreshRows().filter(
        (row) => row.classification === "new_top500_entrant"
      ),
      removedPlayers: [
        { player_id: "old1", gender: "M" },
        { player_id: "old2", gender: "F" },
      ],
      rankingDate: "2026-06-15",
    });

    assert.equal(result.valid, true);
    assert.equal(result.playersToRefresh, 57);
    assert.equal(result.pointDifferencePlayers, 47);
    assert.equal(result.newPlayers, 10);
  });

  test("rejects duplicate refresh player ids before network collection", () => {
    const result = validateInputs({
      validationSummary: validationSummary({ players_to_refresh: 2 }),
      officialPlayers: fullOfficialPlayers(),
      officialSnapshot: fullOfficialSnapshot(),
      playersToRefresh: [
        { player_id: "p1", classification: "point_difference" },
        { player_id: "p1", classification: "point_difference" },
      ],
      playersToPreserve: [],
      newEntrants: [],
      removedPlayers: [
        { player_id: "old1", gender: "M" },
        { player_id: "old2", gender: "F" },
      ],
      rankingDate: "2026-06-15",
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /duplicado/);
  });

  test("builds players.next from official top 1000 while preserving old empty-field context", () => {
    const playersNext = buildPlayersNext({
      officialPlayers: [
        officialPlayer(1, { country_name: "", first_seen_date: "" }),
      ],
      oldPlayers: [
        officialPlayer(1, {
          country_name: "Brazil",
          first_seen_date: "2026-06-08",
          local_note: "keep",
        }),
      ],
    });

    assert.equal(playersNext.length, 1);
    assert.equal(playersNext[0].country_name, "Brazil");
    assert.equal(playersNext[0].first_seen_date, "2026-06-08");
    assert.equal(playersNext[0].local_note, "keep");
  });

  test("refresh rows replace all old rows for selected players and archive removed players", () => {
    const oldRefreshRow = ledgerRow({ player_id: "p2", tournament_name: "Old Refresh" });
    const preserved = ledgerRow({
      player_id: "p1",
      tournament_name: "Preserved",
      raw_json: "{\"byte\":\"same\"}",
    });
    const removed = ledgerRow({ player_id: "old1", tournament_name: "Removed" });
    const outside = ledgerRow({ player_id: "external", tournament_name: "External" });
    const fresh = ledgerRow({
      player_id: "p2",
      tournament_name: "Fresh Refresh",
      points: "120",
    });

    const result = buildReconciledLedger({
      weekCloseLedgerRows: [oldRefreshRow, preserved, removed, outside],
      playersNextRows: [officialPlayer(1), officialPlayer(2)],
      playersToRefresh: [{ player_id: "p2" }],
      removedPlayers: [{ player_id: "old1" }],
      breakdownRowsByPlayer: new Map([["p2", [fresh]]]),
    });

    assert.deepEqual(result.preservedRows[0], preserved);
    assert.deepEqual(result.removedArchiveRows, [removed]);
    assert.deepEqual(result.refreshedOldRows, [oldRefreshRow]);
    assert.equal(result.nextRows.some((row) => row.player_id === "external"), false);
    assert.equal(result.nextRows.some((row) => row.tournament_name === "Old Refresh"), false);
    assert.equal(result.nextRows.some((row) => row.tournament_name === "Fresh Refresh"), true);
  });

  test("merge is idempotent with identical ordered content", () => {
    const fresh = ledgerRow({ player_id: "p2", tournament_name: "Fresh Refresh" });
    const args = {
      playersNextRows: [officialPlayer(1), officialPlayer(2)],
      playersToRefresh: [{ player_id: "p2" }],
      removedPlayers: [],
      breakdownRowsByPlayer: new Map([["p2", [fresh]]]),
    };
    const first = buildReconciledLedger({
      ...args,
      weekCloseLedgerRows: [
        ledgerRow({ player_id: "p1", tournament_name: "A" }),
        ledgerRow({ player_id: "p2", tournament_name: "Old" }),
      ],
    });
    const second = buildReconciledLedger({
      ...args,
      weekCloseLedgerRows: first.nextRows,
    });

    assert.deepEqual(second.nextRows, first.nextRows);
    assert.deepEqual(first.nextRows, sortLedgerRows(first.nextRows));
  });

  test("stores doubles as raw points and applies 25 percent only during validation", () => {
    const ledgerRows = [
      ledgerRow({
        event_type: "doubles",
        player_id: "p1",
        points: "100",
      }),
    ];
    const final = runFinalValidation({
      ledgerRows,
      snapshotRows: [
        officialSnapshot(1, {
          official_points: "25",
        }),
      ],
    });

    assert.equal(ledgerRows[0].points, "100");
    assert.equal(final.finalExact, 1);
    assert.equal(final.comparison.rows[0].doubles_raw_total, 100);
    assert.equal(final.comparison.rows[0].doubles_weighted_total, 25);
  });

  test("continuous ledger with expired result is high as-collected and exact with drop cutoff", () => {
    const ledgerRows = [
      ledgerRow({
        tournament_name: "Expired",
        start_date: "2025-06-01",
        drop_date_calculated: "2026-05-31",
        points: "40",
      }),
      ledgerRow({
        tournament_name: "Current",
        start_date: "2026-01-01",
        drop_date_calculated: "2026-12-31",
        points: "100",
      }),
    ];
    const asCollected = calculateLedgerPoints(ledgerRows, {
      policy: BASELINE_POLICY,
      dropCutoff: "",
    });
    const final = runFinalValidation({
      ledgerRows,
      snapshotRows: [officialSnapshot(1, { official_points: "100" })],
      dropCutoff: "2026-06-14",
    });

    assert.equal(asCollected[0].calculated_total, 140);
    assert.equal(final.finalExact, 1);
    assert.equal(final.finalDivergent, 0);
    assert.equal(final.finalExpiredRowsIgnored, 1);
    assert.equal(final.finalValidationPolicy, FINAL_VALIDATION_POLICY);
    assert.equal(final.finalDropCutoff, "2026-06-14");
  });

  test("expired line stays physically in ledger but is ignored in final calculation", () => {
    const expired = ledgerRow({
      tournament_name: "Expired",
      start_date: "2025-06-01",
      drop_date_calculated: "2026-05-31",
      points: "40",
    });
    const current = ledgerRow({
      tournament_name: "Current",
      points: "100",
    });
    const ledgerRows = [expired, current];
    const final = runFinalValidation({
      ledgerRows,
      snapshotRows: [officialSnapshot(1, { official_points: "100" })],
      dropCutoff: "2026-06-14",
    });

    assert.equal(ledgerRows.includes(expired), true);
    assert.equal(ledgerRows.length, 2);
    assert.equal(final.comparison.rows[0].calculated_points, 100);
    assert.equal(final.finalExpiredRowsIgnored, 1);
  });

  test("empty drop_date remains active under final drop cutoff policy", () => {
    const final = runFinalValidation({
      ledgerRows: [
        ledgerRow({
          tournament_name: "No Drop Date",
          drop_date_calculated: "",
          points: "100",
        }),
      ],
      snapshotRows: [officialSnapshot(1, { official_points: "100" })],
      dropCutoff: "2026-06-14",
    });

    assert.equal(final.finalExact, 1);
    assert.equal(final.finalExpiredRowsIgnored, 0);
  });

  test("preserved player with expired history reconciles using cutoff", () => {
    const preservedExpired = ledgerRow({
      player_id: "p1",
      tournament_name: "Preserved Expired",
      drop_date_calculated: "2026-06-14",
      points: "50",
    });
    const preservedCurrent = ledgerRow({
      player_id: "p1",
      tournament_name: "Preserved Current",
      points: "100",
    });
    const result = buildReconciledLedger({
      weekCloseLedgerRows: [preservedExpired, preservedCurrent],
      playersNextRows: [officialPlayer(1)],
      playersToRefresh: [],
      removedPlayers: [],
      breakdownRowsByPlayer: new Map(),
    });
    const final = runFinalValidation({
      ledgerRows: result.nextRows,
      snapshotRows: [officialSnapshot(1, { official_points: "100" })],
      dropCutoff: "2026-06-14",
    });

    assert.equal(result.nextRows.length, 2);
    assert.equal(final.finalExact, 1);
    assert.equal(final.finalExpiredRowsIgnored, 1);
  });

  test("updated player from breakdown still reconciles with cutoff", () => {
    const oldExpired = ledgerRow({
      player_id: "p2",
      tournament_name: "Old Expired",
      drop_date_calculated: "2026-06-14",
      points: "50",
    });
    const fresh = ledgerRow({
      player_id: "p2",
      tournament_name: "Fresh",
      points: "100",
    });
    const result = buildReconciledLedger({
      weekCloseLedgerRows: [oldExpired],
      playersNextRows: [officialPlayer(2)],
      playersToRefresh: [{ player_id: "p2" }],
      removedPlayers: [],
      breakdownRowsByPlayer: new Map([["p2", [fresh]]]),
    });
    const final = runFinalValidation({
      ledgerRows: result.nextRows,
      snapshotRows: [officialSnapshot(2, { official_points: "100" })],
      dropCutoff: "2026-06-14",
    });

    assert.equal(result.nextRows.length, 1);
    assert.equal(result.nextRows[0].tournament_name, "Fresh");
    assert.equal(final.finalExact, 1);
  });

  test("promotion requires exact 1000 over 1000 and no network misuse", () => {
    const ledgerRows = fullOfficialSnapshot().map((snapshot) =>
      ledgerRow({
        player_id: snapshot.player_id,
        player_name: snapshot.player_name,
        gender: snapshot.gender,
        tournament_name: `Tournament ${snapshot.player_id}`,
        points: "100",
      })
    );
    const final = runFinalValidation({
      ledgerRows,
      snapshotRows: fullOfficialSnapshot(),
      dropCutoff: "2026-06-14",
    });
    const ledgerValidation = validateLedgerForOfficialPlayers({
      ledgerRows,
      playersNextRows: fullOfficialPlayers(),
    });
    const safe = isSafeForPromotion({
      inputValidation: { valid: true },
      fetchResult: {
        errors: [],
        networkReport: { get_rankings_calls: 0 },
      },
      ledgerValidation,
      finalValidation: final,
    });

    assert.equal(final.finalExact, 1000);
    assert.equal(safe, true);
  });

  test("promotion is blocked when any GetPlayerRankings call is reported", () => {
    const safe = isSafeForPromotion({
      inputValidation: { valid: true },
      fetchResult: {
        errors: [],
        networkReport: { get_rankings_calls: 1 },
      },
      ledgerValidation: { valid: true },
      finalValidation: {
        finalTotal: 1000,
        finalExact: 1000,
        finalDivergent: 0,
        finalMissingLedger: 0,
        uniqueLedgerPlayers: 1000,
        ledgerPlayersOutsideOfficial: 0,
      },
    });

    assert.equal(safe, false);
  });

  test("promotion is blocked unless exact 1000 over 1000", () => {
    const safe = isSafeForPromotion({
      inputValidation: { valid: true },
      fetchResult: {
        errors: [],
        networkReport: { get_rankings_calls: 0 },
      },
      ledgerValidation: { valid: true },
      finalValidation: {
        finalTotal: 1000,
        finalExact: 999,
        finalDivergent: 1,
        finalMissingLedger: 0,
        uniqueLedgerPlayers: 1000,
        ledgerPlayersOutsideOfficial: 0,
      },
    });

    assert.equal(safe, false);
  });

  test("summary records final validation policy, cutoff and ignored expired rows", () => {
    const summary = buildSummary({
      args: {
        rankingDate: "2026-06-15",
        mode: "run",
        networkMode: "auto",
        validationDir: "validation",
        weekCloseDir: "week-close",
        oldPlayersFile: "players.csv",
        outputDir: "out",
        breakdownCacheDir: "cache",
      },
      startedAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:10.000Z",
      inputValidation: {
        valid: true,
        errors: [],
        playersToRefresh: 57,
        playersToPreserve: 943,
        pointDifferencePlayers: 47,
        newPlayers: 10,
        removedPlayers: 0,
      },
      fetchResult: {
        summaries: Array.from({ length: 57 }, () => ({ status: "ok" })),
        errors: [],
        networkReport: {
          cached_breakdowns: 57,
          network_breakdowns: 0,
          get_rankings_calls: 0,
          get_ranking_points_calls: 0,
          direct_attempts: 0,
          browser_attempts: 0,
          html_responses: 0,
          incapsula_responses: 0,
          imperva_responses: 0,
          http_403: 0,
          timeouts: 0,
        },
      },
      ledgerParts: {
        preservedRows: [],
        refreshedOldRows: [],
        addedRows: [],
        removedArchiveRows: [],
        nextRows: [],
      },
      ledgerValidation: { valid: true, errors: [] },
      finalValidation: {
        finalValidationPolicy: "drop_cutoff",
        finalDropCutoff: "2026-06-14",
        finalExpiredRowsIgnored: 63,
        finalTotal: 1000,
        finalExact: 1000,
        finalPercentage: 100,
        finalDivergent: 0,
        finalMissingLedger: 0,
        uniqueLedgerPlayers: 1000,
        ledgerPlayersOutsideOfficial: 0,
      },
      safeForPromotion: true,
    });

    assert.equal(summary.final_validation_policy, "drop_cutoff");
    assert.equal(summary.final_drop_cutoff, "2026-06-14");
    assert.equal(summary.final_expired_rows_ignored, 63);
    assert.equal(summary.cached_breakdowns, 57);
    assert.equal(summary.network_breakdowns, 0);
    assert.equal(summary.mode_safe_for_promotion, true);
  });
});
