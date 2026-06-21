import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { stringify } from "csv-stringify/sync";
import { LEDGER_COLUMNS } from "../scripts/lib/weekly_ledger.mjs";
import {
  STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START,
  STATUS_WEEK_CLOSE_BLOCKED,
  STATUS_WEEK_COMPLETE_WAITING_END_DATE,
  STATUS_WEEK_ENDED_WITH_PENDING_RESULTS,
  STATUS_WEEK_READY_TO_CLOSE,
  runWeeklyOperation,
} from "../scripts/21_weekly_rollover.mjs";

function playerRow(index) {
  const gender = index <= 1000 ? "M" : "F";
  const rank = gender === "M" ? index : index - 1000;
  return {
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    gender,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    official_rank: rank,
    official_points: "100",
  };
}

function snapshotRow(index, rankingDate, overrides = {}) {
  const player = playerRow(index);
  return {
    ranking_date: rankingDate,
    gender: player.gender,
    rank: player.official_rank,
    player_id: player.player_id,
    player_name: player.player_name,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    official_points: player.official_points,
    source_url: "",
    collected_at: `${rankingDate}T00:00:00.000Z`,
    ...overrides,
  };
}

function ledgerRow(index, overrides = {}) {
  const player = playerRow(index);
  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    event_type: "singles",
    countable_status: "countable",
    tournament_name: `Tournament ${index}`,
    category: "J100",
    draw_type: "main_draw",
    host_nation: "Brazil",
    host_nation_code: "BRA",
    surface: "Clay",
    surface_code: "C",
    start_date: "2026-01-01",
    drop_date_calculated: "2026-12-31",
    round: "W",
    points: player.official_points,
    tournament_link: "",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_official_reconciliation",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function liveRankingRow(index, rankingDate, overrides = {}) {
  const player = playerRow(index);
  return {
    live_rank: player.official_rank,
    official_rank: player.official_rank,
    rank_change_vs_official: "0",
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    official_points_for_comparison: player.official_points,
    live_points: player.official_points,
    points_change_vs_official: "0",
    singles_points: player.official_points,
    doubles_points_raw: "0",
    doubles_points_weighted: "0",
    singles_results_used: "1",
    doubles_results_used: "0",
    live_rows_available: "0",
    live_raw_points_available: "0",
    live_singles_results_counting: "0",
    live_doubles_results_counting: "0",
    has_live_result: "false",
    dropped_rows_count: "0",
    dropped_singles_raw: "0",
    dropped_doubles_raw: "0",
    estimated_weighted_dropped: "0",
    has_dropped_result: "false",
    ranking_date: rankingDate,
    calculated_at: `${rankingDate}T12:00:00.000Z`,
    ...overrides,
  };
}

function tournamentRow(weekStart, weekEnd) {
  return {
    week_start: weekStart,
    week_end: weekEnd,
    search_start: weekStart,
    search_end: weekEnd,
    tournament_id: "1",
    tournament_key: "T1",
    tournament_name: "Tournament One",
    promotional_name: "",
    category: "J100",
    host_nation: "Brazil",
    host_nation_code: "BRA",
    location: "Sao Paulo",
    venue: "",
    start_date: weekStart,
    end_date: weekEnd,
    dates_raw: "",
    surface: "Clay",
    surface_code: "C",
    indoor_outdoor: "Outdoor",
    tournament_link: "",
    live_link: "",
    source_url: "",
    collected_at: `${weekEnd}T00:00:00.000Z`,
    raw_json: "{}",
  };
}

function completedFinalMatch(overrides = {}) {
  return {
    tournament_key: "T1",
    tournament_name: "Tournament One",
    category: "J100",
    start_date: "2026-06-15",
    end_date: "2026-06-21",
    tournament_id: "1",
    event_id: "E1",
    player_type_code: "B",
    player_type_desc: "Boys",
    match_type_code: "S",
    match_type_desc: "Singles",
    event_classification_code: "M",
    event_classification_desc: "Main",
    drawsheet_structure_code: "KO",
    drawsheet_structure_desc: "Knockout",
    group_name: "",
    round_name: "Final",
    round_order: "4",
    match_id: "m1",
    play_status_code: "PC",
    play_status_desc: "Played and completed",
    result_status_code: "",
    result_status_desc: "",
    team1_player_ids: "p1",
    team1_names: "Player 1",
    team1_nationalities: "BRA",
    team1_seed: "",
    team1_entry_status: "",
    team2_player_ids: "p2",
    team2_names: "Player 2",
    team2_nationalities: "BRA",
    team2_seed: "",
    team2_entry_status: "",
    winner_side: "1",
    winner_names: "Player 1",
    score: "6-1 6-1",
    h2h_link: "",
    live_scores_link: "",
    raw_json: "{}",
    collected_at: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

async function makeProject({
  officialDate = "2026-06-15",
  weekStart = officialDate,
  weekEnd = "2026-06-21",
  weekMatchesRows = [completedFinalMatch()],
  weekSummaryRows = [
    {
      tournament_key: "T1",
      tournament_name: "Tournament One",
      category: "J100",
      events_found: "1",
      matches_found: String(weekMatchesRows.length || 1),
      errors_found: "0",
      raw_file: "raw.json",
      from_cache: "false",
      collected_at: "2026-06-21T00:00:00.000Z",
    },
  ],
  weekErrorRows = [],
  liveRankingRows = Array.from({ length: 2000 }, (_, index) =>
    liveRankingRow(index + 1, officialDate)
  ),
  snapshotOverrides = new Map(),
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-rollover-"));
  const cleanDir = path.join(root, "data", "clean");

  const players = Array.from({ length: 2000 }, (_, index) => playerRow(index + 1));
  const snapshot = Array.from({ length: 2000 }, (_, index) =>
    snapshotRow(index + 1, officialDate, snapshotOverrides.get(index + 1) || {})
  );
  const ledger = Array.from({ length: 2000 }, (_, index) => ledgerRow(index + 1));

  await writeCsv(path.join(cleanDir, "players.csv"), players, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",
    "official_rank",
    "official_points",
  ]);
  await writeCsv(path.join(cleanDir, "rankings_snapshot.csv"), snapshot, [
    "ranking_date",
    "gender",
    "rank",
    "player_id",
    "player_name",
    "country",
    "country_name",
    "birth_year",
    "official_points",
    "source_url",
    "collected_at",
  ]);
  await writeCsv(path.join(cleanDir, "points_ledger.csv"), ledger, LEDGER_COLUMNS);
  await writeCsv(path.join(cleanDir, "week_tournaments.csv"), [tournamentRow(weekStart, weekEnd)], [
    "week_start",
    "week_end",
    "search_start",
    "search_end",
    "tournament_id",
    "tournament_key",
    "tournament_name",
    "promotional_name",
    "category",
    "host_nation",
    "host_nation_code",
    "location",
    "venue",
    "start_date",
    "end_date",
    "dates_raw",
    "surface",
    "surface_code",
    "indoor_outdoor",
    "tournament_link",
    "live_link",
    "source_url",
    "collected_at",
    "raw_json",
  ]);
  await writeCsv(path.join(cleanDir, "week_matches.csv"), weekMatchesRows, Object.keys(completedFinalMatch()));
  await writeCsv(path.join(cleanDir, "week_player_results.csv"), [], ["player_id"]);
  await writeCsv(path.join(cleanDir, "week_live_ledger_rows.csv"), [], LEDGER_COLUMNS);
  await writeCsv(path.join(cleanDir, "week_results_summary.csv"), weekSummaryRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "events_found",
    "matches_found",
    "errors_found",
    "raw_file",
    "from_cache",
    "collected_at",
  ]);
  await writeCsv(path.join(cleanDir, "week_results_errors.csv"), weekErrorRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "player_type_code",
    "player_type_desc",
    "match_type_code",
    "match_type_desc",
    "event_classification_code",
    "event_classification_desc",
    "drawsheet_structure_code",
    "error_message",
    "collected_at",
  ]);
  await writeCsv(path.join(cleanDir, "week_live_points.csv"), [], ["tournament_key"]);
  await writeCsv(
    path.join(cleanDir, "live_ranking_with_drops.csv"),
    liveRankingRows,
    Object.keys(liveRankingRows[0] || {})
  );
  await writeCsv(path.join(cleanDir, "live_external_players_ignored.csv"), [], ["player_id"]);

  return root;
}

describe("weekly rollover controller", () => {
  test("all events complete before week_end -> WEEK_COMPLETE_WAITING_END_DATE", async () => {
    const root = await makeProject();
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-20" }
    );
    assert.equal(result.report.status, STATUS_WEEK_COMPLETE_WAITING_END_DATE);
  });

  test("all complete after week_end -> WEEK_READY_TO_CLOSE", async () => {
    const root = await makeProject();
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.equal(result.report.status, STATUS_WEEK_READY_TO_CLOSE);
    assert.equal(result.report.completion.safe_to_close, true);
  });

  test("complete draws with tolerated missing summary events -> WEEK_READY_TO_CLOSE", async () => {
    const root = await makeProject({
      weekSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          category: "J100",
          events_found: "2",
          matches_found: "1",
          errors_found: "0",
          raw_file: "raw.json",
          from_cache: "false",
          collected_at: "2026-06-21T00:00:00.000Z",
        },
      ],
    });
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.equal(result.report.status, STATUS_WEEK_READY_TO_CLOSE);
    assert.equal(result.report.completion.missing_events, 1);
    assert.equal(result.report.completion.blocking_missing_events, 0);
    assert.equal(result.report.completion.tolerated_missing_events, 1);
    assert.equal(result.report.completion.safe_to_close, true);
  });

  test("ended week with pending event -> WEEK_ENDED_WITH_PENDING_RESULTS", async () => {
    const root = await makeProject({
      weekMatchesRows: [
        completedFinalMatch({
          winner_side: "",
          winner_names: "",
          play_status_code: "TP",
          play_status_desc: "To be played",
        }),
      ],
    });
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.equal(result.report.status, STATUS_WEEK_ENDED_WITH_PENDING_RESULTS);
  });

  test("contradictory event -> WEEK_CLOSE_BLOCKED", async () => {
    const root = await makeProject({
      weekMatchesRows: [
        completedFinalMatch({ match_id: "m1", winner_names: "Player One" }),
        completedFinalMatch({ match_id: "m2", winner_side: "2", winner_names: "Player Two" }),
      ],
    });
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.equal(result.report.status, STATUS_WEEK_CLOSE_BLOCKED);
  });

  test("close dry-run is blocked when safe_to_close=false", async () => {
    const root = await makeProject({
      weekMatchesRows: [
        completedFinalMatch({
          winner_side: "",
          winner_names: "",
          play_status_code: "TP",
          play_status_desc: "To be played",
        }),
      ],
    });
    await assert.rejects(
      runWeeklyOperation(
        {
          action: "close",
          mode: "dry-run",
          confirm: false,
          weekStart: "2026-06-15",
          weekEnd: "2026-06-21",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /safe_to_close=false/
    );
  });

  test("close apply is blocked when safe_to_close=false", async () => {
    const root = await makeProject({
      weekMatchesRows: [
        completedFinalMatch({
          winner_side: "",
          winner_names: "",
          play_status_code: "TP",
          play_status_desc: "To be played",
        }),
      ],
    });
    await assert.rejects(
      runWeeklyOperation(
        {
          action: "close",
          mode: "apply",
          confirm: true,
          weekStart: "2026-06-15",
          weekEnd: "2026-06-21",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /safe_to_close=false/
    );
  });

  test("pending_items limits console to 10 records", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      completedFinalMatch({
        event_id: `E${index + 1}`,
        match_id: `m${index + 1}`,
        winner_side: "",
        winner_names: "",
        play_status_code: "TP",
        play_status_desc: "To be played",
      })
    );
    const root = await makeProject({
      weekMatchesRows: rows,
      weekSummaryRows: [
        {
          tournament_key: "T1",
          tournament_name: "Tournament One",
          category: "J100",
          events_found: "12",
          matches_found: "12",
          errors_found: "0",
          raw_file: "raw.json",
          from_cache: "false",
          collected_at: "2026-06-21T00:00:00.000Z",
        },
      ],
    });
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.match(result.output, /Pendencias:/);
    assert.match(result.output, /\.\.\. 2 pendencias adicionais omitidas/);
  });

  test("last_operation report stores completion block", async () => {
    const root = await makeProject();
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    const report = JSON.parse(
      await fs.readFile(
        path.join(root, "data", "staging", "weekly_operation", "last_operation.json"),
        "utf8"
      )
    );
    assert.equal(result.report.completion.safe_to_close, true);
    assert.equal(report.completion.safe_to_close, true);
  });

  test("official base updated still points to weekly:start", async () => {
    const root = await makeProject({
      officialDate: "2026-06-22",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });
    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );
    assert.equal(result.report.status, STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START);
  });

  test("start without fully reconciled active Top 1000 base is blocked", async () => {
    const root = await makeProject({
      officialDate: "2026-06-22",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      snapshotOverrides: new Map([[1, { official_points: "99" }]]),
    });
    await assert.rejects(
      runWeeklyOperation(
        {
          action: "start",
          mode: "dry-run",
          confirm: false,
          weekStart: "2026-06-22",
          weekEnd: "2026-06-28",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /nao reconciliou 2000\/2000/
    );
  });
});
