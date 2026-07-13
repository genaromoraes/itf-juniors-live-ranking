import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BASELINE_POLICY,
  STAGED_POLICY,
  buildValidationSummary,
  calculateLedgerPoints,
  calculatePlayerTotals,
  compareCalculatedAgainstSnapshot,
  validateOfficialSnapshotRows,
} from "../scripts/lib/official_ledger_validation.mjs";

function ledgerRow(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player One",
    gender: "M",
    event_type: "singles",
    tournament_name: "Tournament",
    category: "J100",
    draw_type: "M",
    start_date: "2026-01-01",
    drop_date_calculated: "2026-12-31",
    points: "100",
    is_live: "false",
    ...overrides,
  };
}

function snapshotRow(overrides = {}) {
  return {
    ranking_date: "2026-06-08",
    gender: "M",
    rank: "1",
    player_id: "p1",
    player_name: "Player One",
    official_points: "100",
    ...overrides,
  };
}

describe("official ledger validation", () => {
  test("calculates top 6 singles only", () => {
    const rows = [700, 600, 500, 400, 300, 200, 100].map((points, index) =>
      ledgerRow({
        event_type: "singles",
        tournament_name: `S${index}`,
        start_date: `2026-01-${String(index + 1).padStart(2, "0")}`,
        points: String(points),
      })
    );

    const totals = calculatePlayerTotals(rows, {
      policy: STAGED_POLICY,
      dropCutoff: "2026-06-07",
    });

    assert.equal(totals.singles_count, 6);
    assert.equal(totals.singles_total, 2700);
    assert.equal(totals.calculated_total, 2700);
  });

  test("calculates top 6 doubles with 25 percent weight", () => {
    const rows = [700, 600, 500, 400, 300, 200, 100].map((points, index) =>
      ledgerRow({
        event_type: "doubles",
        tournament_name: `D${index}`,
        start_date: `2026-02-${String(index + 1).padStart(2, "0")}`,
        points: String(points),
      })
    );

    const totals = calculatePlayerTotals(rows, {
      policy: STAGED_POLICY,
      dropCutoff: "2026-06-07",
    });

    assert.equal(totals.doubles_count, 6);
    assert.equal(totals.doubles_raw_total, 2700);
    assert.equal(totals.doubles_weighted_total, 675);
    assert.equal(totals.calculated_total, 675);
  });

  test("baseline as-collected keeps result even when drop_date is earlier than snapshot date", () => {
    const totals = calculatePlayerTotals(
      [ledgerRow({ points: "200", drop_date_calculated: "2026-06-01" })],
      { policy: BASELINE_POLICY, dropCutoff: "" }
    );

    assert.equal(totals.active_ledger_rows, 1);
    assert.equal(totals.expired_ledger_rows, 0);
    assert.equal(totals.calculated_total, 200);
  });

  test("staged drop cutoff excludes the same expired result", () => {
    const totals = calculatePlayerTotals(
      [ledgerRow({ points: "200", drop_date_calculated: "2026-06-01" })],
      { policy: STAGED_POLICY, dropCutoff: "2026-06-14" }
    );

    assert.equal(totals.active_ledger_rows, 0);
    assert.equal(totals.expired_ledger_rows, 1);
    assert.equal(totals.calculated_total, 0);
  });

  test("baseline and staged totals diverge when a selected line is expired by cutoff", () => {
    const rows = [
      ledgerRow({ tournament_name: "Expired", points: "18", drop_date_calculated: "2026-06-01" }),
      ledgerRow({ tournament_name: "Replacement", points: "10", drop_date_calculated: "2026-07-01" }),
      ledgerRow({ tournament_name: "S1", points: "36" }),
      ledgerRow({ tournament_name: "S2", points: "30" }),
      ledgerRow({ tournament_name: "S3", points: "20" }),
      ledgerRow({ tournament_name: "S4", points: "18", start_date: "2026-01-04" }),
      ledgerRow({ tournament_name: "S5", points: "18", start_date: "2026-01-05" }),
    ];

    const baseline = calculatePlayerTotals(rows, { policy: BASELINE_POLICY, dropCutoff: "" });
    const staged = calculatePlayerTotals(rows, { policy: STAGED_POLICY, dropCutoff: "2026-06-14" });

    assert.equal(baseline.calculated_total, 140);
    assert.equal(staged.calculated_total, 132);
  });

  test("keeps empty drop_date active in staged policy", () => {
    const totals = calculatePlayerTotals(
      [ledgerRow({ points: "150", drop_date_calculated: "" })],
      { policy: STAGED_POLICY, dropCutoff: "2026-06-07" }
    );

    assert.equal(totals.active_ledger_rows, 1);
    assert.equal(totals.calculated_total, 150);
  });

  test("baseline 2000 over 2000 style match allows proceeding", () => {
    const baseline = compareCalculatedAgainstSnapshot(
      [
        calculatePlayerTotals([ledgerRow({ points: "100" })], {
          policy: BASELINE_POLICY,
          dropCutoff: "",
        }),
      ],
      [snapshotRow({ official_points: "100" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.valid, true);
    assert.equal(baseline.exact, 1);
  });

  test("baseline divergent continues to block collection", () => {
    const baseline = compareCalculatedAgainstSnapshot(
      [
        calculatePlayerTotals([ledgerRow({ points: "80" })], {
          policy: BASELINE_POLICY,
          dropCutoff: "",
        }),
      ],
      [snapshotRow({ official_points: "100" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.valid, false);
    assert.equal(baseline.exact, 0);
  });

  test("drop-cutoff is never applied accidentally to baseline", () => {
    const rows = [ledgerRow({ points: "90", drop_date_calculated: "2026-06-01" })];

    const baseline = calculatePlayerTotals(rows, {
      policy: BASELINE_POLICY,
      dropCutoff: "2026-06-14",
    });
    const staged = calculatePlayerTotals(rows, {
      policy: STAGED_POLICY,
      dropCutoff: "2026-06-14",
    });

    assert.equal(baseline.calculated_total, 90);
    assert.equal(staged.calculated_total, 0);
  });

  test("baseline validation rows record the active policy and totals", () => {
    const baseline = compareCalculatedAgainstSnapshot(
      [
        calculatePlayerTotals([ledgerRow({ points: "100" })], {
          policy: BASELINE_POLICY,
          dropCutoff: "",
        }),
      ],
      [snapshotRow({ official_points: "100" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.rows[0].baseline_policy, BASELINE_POLICY);
    assert.equal(baseline.rows[0].active_rows, 1);
    assert.equal(baseline.rows[0].singles_total, 100);
    assert.equal(baseline.rows[0].doubles_weighted_total, 0);
  });

  test("diagnostic-style Daphnee fixture reconciles in as-collected baseline", () => {
    const rows = [
      ledgerRow({ tournament_name: "RG", category: "JGS", start_date: "2025-06-01", points: "90", drop_date_calculated: "2026-05-31" }),
      ledgerRow({ tournament_name: "SC", points: "300", start_date: "2026-05-11" }),
      ledgerRow({ tournament_name: "Cap", points: "200", start_date: "2026-03-30" }),
      ledgerRow({ tournament_name: "Glad", points: "100", start_date: "2025-06-17" }),
      ledgerRow({ tournament_name: "Cup", points: "75", start_date: "2025-08-04" }),
      ledgerRow({ tournament_name: "Beaulieu", points: "60", start_date: "2026-04-13" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D1", points: "105", start_date: "2026-04-13" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D2", points: "45", start_date: "2025-09-15" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D3", points: "45", start_date: "2026-03-30" }),
    ];

    const baseline = compareCalculatedAgainstSnapshot(
      [calculatePlayerTotals(rows, { policy: BASELINE_POLICY, dropCutoff: "" })],
      [snapshotRow({ official_points: "873.75", player_name: "Daphnee", gender: "F" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.valid, true);
    assert.equal(baseline.rows[0].calculated_points, 873.75);
  });

  test("diagnostic-style Alex fixture reconciles in as-collected baseline", () => {
    const rows = [
      ledgerRow({ tournament_name: "Gaborone100", points: "36", start_date: "2025-11-24" }),
      ledgerRow({ tournament_name: "Gaborone60", points: "36", start_date: "2025-11-17" }),
      ledgerRow({ tournament_name: "Bulawayo30", points: "30", start_date: "2025-12-01" }),
      ledgerRow({ tournament_name: "Tauranga", points: "20", start_date: "2026-01-20" }),
      ledgerRow({ tournament_name: "Harmon", points: "18", start_date: "2026-05-12" }),
      ledgerRow({ tournament_name: "Saipan", points: "18", start_date: "2025-06-03", drop_date_calculated: "2026-06-02" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D1", points: "75", start_date: "2025-11-24" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D2", points: "45", start_date: "2025-12-08" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D3", points: "45", start_date: "2025-10-07" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D4", points: "45", start_date: "2026-05-12" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D5", points: "27", start_date: "2026-03-16" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D6", points: "27", start_date: "2026-01-27" }),
    ];

    const baseline = compareCalculatedAgainstSnapshot(
      [calculatePlayerTotals(rows, { policy: BASELINE_POLICY, dropCutoff: "" })],
      [snapshotRow({ official_points: "224", player_name: "Alex" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.valid, true);
    assert.equal(baseline.rows[0].calculated_points, 224);
  });

  test("diagnostic-style Morgan fixture reconciles in as-collected baseline", () => {
    const rows = [
      ledgerRow({ tournament_name: "PretoriaCurrent", points: "36", start_date: "2026-05-26" }),
      ledgerRow({ tournament_name: "Gaborone", points: "20", start_date: "2025-11-24" }),
      ledgerRow({ tournament_name: "PretoriaOld", points: "18", start_date: "2025-06-02", drop_date_calculated: "2026-06-01" }),
      ledgerRow({ tournament_name: "PretoriaNext", points: "18", start_date: "2025-06-09", drop_date_calculated: "2026-06-08" }),
      ledgerRow({ tournament_name: "Bloem", points: "10", start_date: "2026-02-03" }),
      ledgerRow({ tournament_name: "Potch", points: "10", start_date: "2026-02-23" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D1", points: "75", start_date: "2026-02-23" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D2", points: "75", start_date: "2025-11-24" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D3", points: "45", start_date: "2026-05-26" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D4", points: "45", start_date: "2025-09-08" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D5", points: "45", start_date: "2026-03-02" }),
      ledgerRow({ event_type: "doubles", tournament_name: "D6", points: "45", start_date: "2025-09-15" }),
    ];

    const baseline = compareCalculatedAgainstSnapshot(
      [calculatePlayerTotals(rows, { policy: BASELINE_POLICY, dropCutoff: "" })],
      [snapshotRow({ official_points: "194.5", player_name: "Morgan", gender: "F" })],
      { baselinePolicy: BASELINE_POLICY }
    );

    assert.equal(baseline.valid, true);
    assert.equal(baseline.rows[0].calculated_points, 194.5);
  });

  test("validates exact 1000 male and 1000 female counts", () => {
    const players = [];
    const snapshots = [];

    for (const gender of ["M", "F"]) {
      for (let index = 1; index <= 1000; index++) {
        const id = `${gender}${index}`;
        players.push({
          player_id: id,
          player_name: id,
          gender,
        });
        snapshots.push({
          ranking_date: "2026-06-15",
          gender,
          rank: index,
          player_id: id,
          player_name: id,
          official_points: index,
        });
      }
    }

    const validation = validateOfficialSnapshotRows(players, snapshots, "2026-06-15");

    assert.equal(validation.valid, true);
    assert.equal(validation.countsByGender.M, 1000);
    assert.equal(validation.countsByGender.F, 1000);
  });

  test("accepts official competition ranks with a tie and skipped next rank", () => {
    const players = [];
    const snapshots = [];

    for (const gender of ["M", "F"]) {
      for (let index = 1; index <= 1000; index++) {
        const id = `${gender}${index}`;
        players.push({ player_id: id, player_name: id, gender });
        snapshots.push({
          ranking_date: "2026-07-13",
          gender,
          rank: gender === "F" && index === 918 ? 917 : index,
          player_id: id,
          player_name: id,
          official_points: index,
        });
      }
    }

    const validation = validateOfficialSnapshotRows(
      players,
      snapshots,
      "2026-07-13"
    );

    assert.equal(validation.valid, true);
  });

  test("rejects a skipped rank without an official competition tie", () => {
    const players = [];
    const snapshots = [];

    for (const gender of ["M", "F"]) {
      for (let index = 1; index <= 1000; index++) {
        const id = `${gender}${index}`;
        players.push({ player_id: id, player_name: id, gender });
        snapshots.push({
          ranking_date: "2026-07-13",
          gender,
          rank: gender === "F" && index === 918 ? 919 : index,
          player_id: id,
          player_name: id,
          official_points: index,
        });
      }
    }

    const validation = validateOfficialSnapshotRows(
      players,
      snapshots,
      "2026-07-13"
    );

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /ranking de competicao invalida/);
  });

  test("rejects duplicate player_id", () => {
    const validation = validateOfficialSnapshotRows(
      [{ player_id: "p1" }, { player_id: "p1" }],
      [
        snapshotRow({ ranking_date: "2026-06-15" }),
        snapshotRow({ ranking_date: "2026-06-15", gender: "F", rank: "1" }),
      ],
      "2026-06-15"
    );

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /duplicados/);
  });

  test("rejects wrong rankDate", () => {
    const validation = validateOfficialSnapshotRows(
      [{ player_id: "p1" }],
      [snapshotRow({ ranking_date: "2026-06-08" })],
      "2026-06-15"
    );

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /ranking_date diferente/);
  });

  test("validation summary records both policies correctly", () => {
    const summary = buildValidationSummary({
      oldRankingDate: "2026-06-08",
      expectedRankingDate: "2026-06-15",
      receivedRankingDate: "2026-06-15",
      baselinePolicy: BASELINE_POLICY,
      stagedPolicy: STAGED_POLICY,
      baselineDropCutoff: "",
      stagedDropCutoff: "2026-06-14",
      baseline: { total: 2000, exact: 2000, valid: true },
      officialCounts: { total: 2000, male: 1000, female: 1000, valid: true },
      oldTrackedTotal: 2000,
      comparison: {
        continuingPlayers: 999,
        exactMatches: [],
        pointDifferences: [{ point_difference: "10" }],
        newEntrants: [],
        removedRows: [],
        missingLedgerRows: [],
        invalidPlayers: [],
        playersToRefresh: [{}],
        ledgerValid: true,
        completed: true,
      },
      warnings: [],
      errors: [],
      startedAt: "2026-06-15T00:00:00.000Z",
      finishedAt: "2026-06-15T00:00:05.000Z",
    });

    assert.equal(summary.baseline_policy, BASELINE_POLICY);
    assert.equal(summary.staged_policy, STAGED_POLICY);
    assert.equal(summary.baseline_drop_cutoff, "");
    assert.equal(summary.staged_drop_cutoff, "2026-06-14");
    assert.equal(summary.comparison_completed, true);
    assert.equal(summary.fully_reconciled, false);
    assert.equal(summary.official_snapshot_valid, true);
  });

  test("fully_reconciled stays false when refresh is required", () => {
    const summary = buildValidationSummary({
      oldRankingDate: "2026-06-08",
      expectedRankingDate: "2026-06-15",
      receivedRankingDate: "2026-06-15",
      baselinePolicy: BASELINE_POLICY,
      stagedPolicy: STAGED_POLICY,
      baselineDropCutoff: "",
      stagedDropCutoff: "2026-06-14",
      baseline: { total: 2000, exact: 2000, valid: true },
      officialCounts: { total: 2000, male: 1000, female: 1000, valid: true },
      oldTrackedTotal: 2000,
      comparison: {
        continuingPlayers: 998,
        exactMatches: [],
        pointDifferences: [],
        newEntrants: [{}],
        removedRows: [],
        missingLedgerRows: [],
        invalidPlayers: [],
        playersToRefresh: [{}],
        ledgerValid: true,
        completed: true,
      },
      warnings: [],
      errors: [],
      startedAt: "2026-06-15T00:00:00.000Z",
      finishedAt: "2026-06-15T00:00:05.000Z",
    });

    assert.equal(summary.fully_reconciled, false);
    assert.equal(summary.players_to_refresh, 1);
  });

  test("fully_reconciled stays false when comparison did not complete", () => {
    const summary = buildValidationSummary({
      oldRankingDate: "2026-06-08",
      expectedRankingDate: "2026-06-15",
      receivedRankingDate: "",
      baselinePolicy: BASELINE_POLICY,
      stagedPolicy: STAGED_POLICY,
      baselineDropCutoff: "",
      stagedDropCutoff: "2026-06-14",
      baseline: { total: 2000, exact: 997, valid: false },
      officialCounts: { total: 0, male: 0, female: 0, valid: false },
      oldTrackedTotal: 2000,
      comparison: {
        continuingPlayers: 0,
        exactMatches: [],
        pointDifferences: [],
        newEntrants: [],
        removedRows: [],
        missingLedgerRows: [],
        invalidPlayers: [],
        playersToRefresh: [],
        ledgerValid: true,
        completed: false,
      },
      warnings: [],
      errors: ["baseline failed"],
      startedAt: "2026-06-15T00:00:00.000Z",
      finishedAt: "2026-06-15T00:00:05.000Z",
    });

    assert.equal(summary.fully_reconciled, false);
    assert.equal(summary.baseline_valid, false);
    assert.equal(summary.comparison_completed, false);
  });

  test("calculateLedgerPoints keeps baseline and staged policies separate", () => {
    const rows = [ledgerRow({ points: "18", drop_date_calculated: "2026-06-01" })];
    const baselineRows = calculateLedgerPoints(rows, {
      policy: BASELINE_POLICY,
      dropCutoff: "",
    });
    const stagedRows = calculateLedgerPoints(rows, {
      policy: STAGED_POLICY,
      dropCutoff: "2026-06-14",
    });

    assert.equal(baselineRows[0].calculated_total, 18);
    assert.equal(stagedRows[0].calculated_total, 0);
  });
});
