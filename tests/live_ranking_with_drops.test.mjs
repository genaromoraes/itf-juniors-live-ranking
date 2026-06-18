import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildIgnoredExternalPlayersRows,
  buildResultKey,
  buildTrackedRankingRows,
  mergeLedgersWithDrops,
  splitRowsByTrackedPlayerIds,
  validatePlayersBase,
} from "../scripts/08_calculate_live_ranking_with_drops.mjs";

function makePlayer(id, gender, overrides = {}) {
  return {
    player_id: id,
    player_name: `Player ${id}`,
    gender,
    country: gender === "M" ? "BRA" : "USA",
    country_name: gender === "M" ? "Brazil" : "USA",
    birth_year: "2009",
    ...overrides,
  };
}

function makeSnapshotEntry(id, gender, officialRank, officialPoints, overrides = {}) {
  return [
    id,
    {
      player_id: id,
      player_name: `Player ${id}`,
      gender,
      country: gender === "M" ? "BRA" : "USA",
      country_name: gender === "M" ? "Brazil" : "USA",
      birth_year: "2009",
      official_rank: officialRank,
      official_points: officialPoints,
      ranking_date: "2026-06-15",
      ...overrides,
    },
  ];
}

function makeLedgerRow({
  player_id,
  player_name = `Player ${player_id}`,
  gender = "M",
  event_type = "singles",
  tournament_name = "J100 Example",
  category = "J100",
  draw_type = "main_draw",
  start_date = "2026-06-15",
  round = "R16",
  points = 10,
  source_type = "base",
  drop_date_calculated = "2027-06-14",
  country = "BRA",
  status = "",
} = {}) {
  return {
    player_id,
    player_name,
    gender,
    country,
    country_name: country === "BRA" ? "Brazil" : "USA",
    birth_year: "2009",
    event_type,
    countable_status: source_type === "live" ? "live_unconfirmed" : "countable",
    tournament_name,
    category,
    draw_type,
    host_nation: "",
    host_nation_code: "",
    surface: "",
    surface_code: "",
    start_date,
    drop_date_calculated,
    round,
    points,
    tournament_link: "",
    is_countable_at_collection: source_type === "live" ? "false" : "true",
    is_live: source_type === "live" ? "true" : "false",
    status,
    source_url: "",
    collected_at: "2026-06-16T00:00:00.000Z",
    raw_json: "",
    source_type,
  };
}

describe("live ranking with tracked official players only", () => {
  test("validates the active Top 1000 per gender official base shape", () => {
    const playersRows = [];

    for (let i = 1; i <= 1000; i++) {
      playersRows.push(makePlayer(`M${i}`, "M"));
      playersRows.push(makePlayer(`F${i}`, "F"));
    }

    const result = validatePlayersBase(playersRows);

    assert.equal(result.isValid, true);
    assert.equal(result.trackedPlayerIds.size, 2000);
    assert.equal(result.genderCounts.M, 1000);
    assert.equal(result.genderCounts.F, 1000);
  });

  test("rejects invalid official base counts", () => {
    const playersRows = [makePlayer("1", "M"), makePlayer("1", "M")];
    const result = validatePlayersBase(playersRows);

    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((item) => item.includes("2000 linhas")));
    assert.ok(result.errors.some((item) => item.includes("duplicados")));
  });

  test("external live player does not enter combined ledger or ranking and is audited", () => {
    const playersRows = [makePlayer("A", "M"), makePlayer("B", "F")];
    const trackedPlayerIds = new Set(["A", "B"]);
    const snapshotMap = new Map([
      makeSnapshotEntry("A", "M", 1, 120),
      makeSnapshotEntry("B", "F", 1, 80),
    ]);

    const baseRows = [
      makeLedgerRow({ player_id: "A", gender: "M", points: 120 }),
      makeLedgerRow({ player_id: "B", gender: "F", points: 80, country: "USA" }),
    ];
    const liveRows = [
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        points: 180,
        source_type: "live",
        tournament_name: "J200 Gladbeck",
        category: "J200",
      }),
      makeLedgerRow({
        player_id: "X",
        player_name: "External X",
        gender: "M",
        points: 18,
        source_type: "live",
        tournament_name: "J200 Gladbeck",
        category: "J200",
      }),
    ];

    const { trackedRows: trackedLiveRows, untrackedRows: untrackedLiveRows } =
      splitRowsByTrackedPlayerIds(liveRows, trackedPlayerIds);

    const { activeRows, droppedRows } = mergeLedgersWithDrops(
      baseRows,
      trackedLiveRows,
      "2026-06-21"
    );
    const ranking = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows,
      droppedRows,
    });
    const ignoredPlayers = buildIgnoredExternalPlayersRows(untrackedLiveRows);

    assert.equal(trackedLiveRows.length, 1);
    assert.equal(untrackedLiveRows.length, 1);
    assert.equal(activeRows.some((row) => row.player_id === "X"), false);
    assert.equal(ranking.length, 2);
    assert.equal(ranking.some((row) => row.player_id === "X"), false);
    assert.deepEqual(ignoredPlayers, [
      {
        player_id: "X",
        player_name: "External X",
        gender: "M",
        country: "BRA",
        week_rows: 1,
        singles_rows: 1,
        doubles_rows: 0,
        raw_live_points: 18,
        tournaments: "J200 Gladbeck",
        ignore_reason: "player_not_in_official_base",
      },
    ]);
  });

  test("removed player from old base does not reappear with live rows", () => {
    const playersRows = [makePlayer("A", "M")];
    const snapshotMap = new Map([makeSnapshotEntry("A", "M", 1, 120)]);
    const trackedPlayerIds = new Set(["A"]);
    const liveRows = [
      makeLedgerRow({
        player_id: "800737788",
        player_name: "Removed Player",
        gender: "M",
        points: 18,
        source_type: "live",
      }),
    ];

    const { trackedRows, untrackedRows } = splitRowsByTrackedPlayerIds(
      liveRows,
      trackedPlayerIds
    );
    const ranking = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows: [],
      droppedRows: [],
    });

    assert.equal(trackedRows.length, 0);
    assert.equal(untrackedRows.length, 1);
    assert.equal(ranking.some((row) => row.player_id === "800737788"), false);
  });

  test("official player with live result enters normally", () => {
    const playersRows = [makePlayer("A", "M")];
    const snapshotMap = new Map([makeSnapshotEntry("A", "M", 1, 70)]);
    const activeRows = [
      makeLedgerRow({ player_id: "A", gender: "M", points: 60, source_type: "base" }),
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        points: 100,
        source_type: "live",
        tournament_name: "J100 Almaty",
      }),
    ];

    const [row] = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows,
      droppedRows: [],
    });

    assert.equal(row.player_id, "A");
    assert.equal(row.has_live_result, "true");
    assert.equal(row.live_rows_available, 1);
    assert.equal(row.live_points, 160);
  });

  test("ranking is built from official players list instead of ledger ids", () => {
    const playersRows = [makePlayer("A", "M"), makePlayer("B", "F")];
    const snapshotMap = new Map([
      makeSnapshotEntry("A", "M", 1, 100),
      makeSnapshotEntry("B", "F", 1, 50),
    ]);
    const activeRows = [makeLedgerRow({ player_id: "A", gender: "M", points: 100 })];

    const ranking = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows,
      droppedRows: [],
    });

    assert.equal(ranking.length, 2);
    assert.deepEqual(
      ranking.map((row) => row.player_id).sort(),
      ["A", "B"]
    );
  });

  test("official player without live result stays in ranking", () => {
    const playersRows = [makePlayer("A", "M")];
    const snapshotMap = new Map([makeSnapshotEntry("A", "M", 1, 90)]);
    const activeRows = [makeLedgerRow({ player_id: "A", gender: "M", points: 90 })];

    const [row] = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows,
      droppedRows: [],
    });

    assert.equal(row.player_id, "A");
    assert.equal(row.has_live_result, "false");
    assert.equal(row.live_points, 90);
  });

  test("doubles keep raw points in ledger and 25 percent in ranking math", () => {
    const playersRows = [makePlayer("A", "M")];
    const snapshotMap = new Map([makeSnapshotEntry("A", "M", 1, 25)]);
    const activeRows = [
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        event_type: "doubles",
        points: 100,
      }),
    ];

    const [row] = buildTrackedRankingRows({
      playersRows,
      snapshotMap,
      activeRows,
      droppedRows: [],
    });

    assert.equal(activeRows[0].points, 100);
    assert.equal(row.doubles_points_raw, 100);
    assert.equal(row.doubles_points_weighted, 25);
    assert.equal(row.live_points, 25);
  });

  test("base and live rows with the same identity are not counted twice and live prevails", () => {
    const baseRows = [
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        tournament_name: "J100 Almaty",
        category: "J100",
        draw_type: "main_draw",
        start_date: "2026-06-15",
        round: "R16",
        points: 10,
        source_type: "base",
      }),
    ];
    const liveRows = [
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        tournament_name: "J100 Almaty",
        category: "J100",
        draw_type: "main_draw",
        start_date: "2026-06-15",
        round: "QF",
        points: 20,
        source_type: "live",
      }),
    ];

    const { activeRows } = mergeLedgersWithDrops(baseRows, liveRows, "2026-06-21");

    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0].source_type, "live");
    assert.equal(activeRows[0].points, 20);
  });

  test("result identity ignores round, points and source type", () => {
    const baseKey = buildResultKey(
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        round: "R16",
        points: 10,
        source_type: "base",
      })
    );
    const liveKey = buildResultKey(
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        round: "QF",
        points: 20,
        source_type: "live",
      })
    );

    assert.equal(baseKey, liveKey);
  });

  test("historical external base row is ignored before ranking", () => {
    const trackedPlayerIds = new Set(["A"]);
    const baseRows = [
      makeLedgerRow({ player_id: "A", gender: "M", points: 100 }),
      makeLedgerRow({ player_id: "X", gender: "M", points: 100 }),
    ];

    const { trackedRows, untrackedRows } = splitRowsByTrackedPlayerIds(
      baseRows,
      trackedPlayerIds
    );

    assert.equal(trackedRows.length, 1);
    assert.equal(untrackedRows.length, 1);
    assert.equal(untrackedRows[0].player_id, "X");
  });

  test("second execution with the same inputs is idempotent", () => {
    const baseRows = [makeLedgerRow({ player_id: "A", gender: "M", points: 100 })];
    const liveRows = [
      makeLedgerRow({
        player_id: "A",
        gender: "M",
        points: 140,
        source_type: "live",
        tournament_name: "J200 Gladbeck",
        category: "J200",
      }),
    ];

    const first = mergeLedgersWithDrops(baseRows, liveRows, "2026-06-21");
    const second = mergeLedgersWithDrops(baseRows, liveRows, "2026-06-21");

    assert.deepEqual(second, first);
  });

  test("external audit aggregates counts per player correctly", () => {
    const ignoredRows = [
      makeLedgerRow({
        player_id: "X",
        player_name: "External X",
        gender: "M",
        points: 18,
        source_type: "live",
        tournament_name: "J200 Gladbeck",
      }),
      makeLedgerRow({
        player_id: "X",
        player_name: "External X",
        gender: "M",
        event_type: "doubles",
        points: 27,
        source_type: "live",
        tournament_name: "J200 Gladbeck",
      }),
    ];

    const [summary] = buildIgnoredExternalPlayersRows(ignoredRows);

    assert.equal(summary.week_rows, 2);
    assert.equal(summary.singles_rows, 1);
    assert.equal(summary.doubles_rows, 1);
    assert.equal(summary.raw_live_points, 45);
  });
});
