import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { stringify } from "csv-stringify/sync";
import { LEDGER_COLUMNS } from "../scripts/lib/weekly_ledger.mjs";
import {
  STATUS_NEW_WEEK_READY,
  STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START,
  STATUS_WEEK_IN_PROGRESS,
  STATUS_WEEK_READY_TO_CLOSE,
  runWeeklyOperation,
} from "../scripts/21_weekly_rollover.mjs";

function playerRow(index) {
  const gender = index <= 500 ? "M" : "F";
  const rank = gender === "M" ? index : index - 500;

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

function weekTournamentRow(weekStart, weekEnd, overrides = {}) {
  return {
    week_start: weekStart,
    week_end: weekEnd,
    search_start: weekStart,
    search_end: weekEnd,
    tournament_id: "1",
    tournament_key: "J-TEST-2026-001",
    tournament_name: "J100 Test",
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
    tournament_link: "https://example.test/tournament",
    live_link: "",
    source_url: "",
    collected_at: `${weekEnd}T12:00:00.000Z`,
    raw_json: "{}",
    ...overrides,
  };
}

function stubWeekTournamentRow(weekStart, weekEnd) {
  return weekTournamentRow(weekStart, weekEnd, {
    tournament_id: "",
    tournament_key: "",
    tournament_name: "",
  });
}

function weekMatchRow(weekStart, weekEnd) {
  return {
    tournament_key: "J-TEST-2026-001",
    tournament_name: "J100 Test",
    category: "J100",
    start_date: weekStart,
    end_date: weekEnd,
    tournament_id: "1",
    event_id: "e1",
    player_type_code: "B",
    player_type_desc: "Boys",
    match_type_code: "S",
    match_type_desc: "Singles",
    event_classification_code: "M",
    event_classification_desc: "Main",
    drawsheet_structure_code: "KO",
    drawsheet_structure_desc: "Knockout",
    group_name: "",
    round_name: "R16",
    round_order: "1",
    match_id: "m1",
    play_status_code: "C",
    play_status_desc: "Completed",
    result_status_code: "F",
    result_status_desc: "Final",
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
    collected_at: `${weekEnd}T12:00:00.000Z`,
  };
}

function weekPlayerResultRow(weekStart, weekEnd) {
  return {
    tournament_key: "J-TEST-2026-001",
    tournament_name: "J100 Test",
    category: "J100",
    start_date: weekStart,
    end_date: weekEnd,
    player_id: "p1",
    player_name: "Player 1",
    nationality: "BRA",
    player_type_code: "B",
    player_type_desc: "Boys",
    match_type_code: "S",
    match_type_desc: "Singles",
    event_classification_code: "M",
    event_classification_desc: "Main",
    matches_played: "1",
    wins: "1",
    losses: "0",
    highest_round_order: "1",
    highest_round_name: "R16",
    last_match_id: "m1",
    last_match_status: "Completed",
    status: "still_alive_or_champion",
    live_points: "10",
    collected_at: `${weekEnd}T12:00:00.000Z`,
  };
}

function weekLiveLedgerRow(weekStart) {
  return {
    ...ledgerRow(1, {
      start_date: weekStart,
      tournament_name: "J100 Test",
      points: "10",
      is_live: "true",
      status: "still_alive_or_champion",
      countable_status: "live_unconfirmed",
      drop_date_calculated: "",
    }),
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

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function makeProject({
  officialDate = "2026-06-15",
  weekStart = officialDate,
  weekEnd = "2026-06-21",
  tournamentRows = [weekTournamentRow(weekStart, weekEnd)],
  matchRows = [weekMatchRow(weekStart, weekEnd)],
  playerResultRows = [weekPlayerResultRow(weekStart, weekEnd)],
  weekLiveRows = [weekLiveLedgerRow(weekStart)],
  weekErrorRows = [],
  liveRankingRows = Array.from({ length: 1000 }, (_, index) =>
    liveRankingRow(index + 1, officialDate)
  ),
  snapshotOverrides = new Map(),
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-rollover-"));
  const cleanDir = path.join(root, "data", "clean");

  const players = Array.from({ length: 1000 }, (_, index) => playerRow(index + 1));
  const snapshot = Array.from({ length: 1000 }, (_, index) =>
    snapshotRow(
      index + 1,
      officialDate,
      snapshotOverrides.get(index + 1) || {}
    )
  );
  const ledger = Array.from({ length: 1000 }, (_, index) => ledgerRow(index + 1));

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
  await writeCsv(path.join(cleanDir, "week_tournaments.csv"), tournamentRows, [
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
  await writeCsv(path.join(cleanDir, "week_matches.csv"), matchRows, Object.keys(weekMatchRow(weekStart, weekEnd)));
  await writeCsv(
    path.join(cleanDir, "week_player_results.csv"),
    playerResultRows,
    Object.keys(weekPlayerResultRow(weekStart, weekEnd))
  );
  await writeCsv(
    path.join(cleanDir, "week_live_ledger_rows.csv"),
    weekLiveRows,
    LEDGER_COLUMNS
  );
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
  await writeCsv(path.join(cleanDir, "week_results_summary.csv"), [], [
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
  await writeCsv(path.join(cleanDir, "week_live_points.csv"), [], [
    "tournament_key",
  ]);
  await writeCsv(
    path.join(cleanDir, "live_ranking_with_drops.csv"),
    liveRankingRows,
    Object.keys(liveRankingRows[0] || {})
  );
  await writeCsv(
    path.join(cleanDir, "live_external_players_ignored.csv"),
    [],
    ["player_id"]
  );

  return root;
}

describe("weekly rollover controller", () => {
  test("status reports week in progress", async () => {
    const root = await makeProject({
      officialDate: "2026-06-15",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });

    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-17" }
    );

    assert.equal(result.report.status, STATUS_WEEK_IN_PROGRESS);
    assert.match(result.output, /Ranking live valido: sim/);
  });

  test("status reports week ready to close", async () => {
    const root = await makeProject({
      officialDate: "2026-06-15",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });

    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );

    assert.equal(result.report.status, STATUS_WEEK_READY_TO_CLOSE);
    assert.match(result.output, /npm run weekly:close/);
  });

  test("close dry-run does not alter data", async () => {
    const root = await makeProject({
      officialDate: "2026-06-15",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });
    const ledgerPath = path.join(root, "data", "clean", "points_ledger.csv");
    const before = await readText(ledgerPath);

    const result = await runWeeklyOperation(
      {
        action: "close",
        mode: "dry-run",
        confirm: false,
        weekStart: "2026-06-15",
        weekEnd: "2026-06-21",
      },
      {
        cwd: root,
        today: "2026-06-22",
        runNodeScript: async () => {
          const reportDir = path.join(
            root,
            "data",
            "staging",
            "week_close_2026-06-21"
          );
          await fs.mkdir(reportDir, { recursive: true });
          await fs.writeFile(
            path.join(reportDir, "close_week_report.json"),
            `${JSON.stringify(
              {
                live_rows_received: 1,
                tracked_rows_eligible: 1,
                untracked_rows_rejected: 0,
                players_affected: 1,
                rows_added: 1,
                validation_passed: true,
                mode_safe_for_apply: true,
                safety_errors: [],
                validation_errors: [],
                warnings: [],
              },
              null,
              2
            )}\n`,
            "utf8"
          );
        },
      }
    );

    assert.equal(result.report.validation_passed, true);
    assert.equal(await readText(ledgerPath), before);
  });

  test("close apply without confirmation is blocked", async () => {
    const root = await makeProject();

    await assert.rejects(
      runWeeklyOperation(
        {
          action: "close",
          mode: "apply",
          confirm: false,
          weekStart: "2026-06-15",
          weekEnd: "2026-06-21",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /Apply bloqueado/
    );
  });

  test("divergent week is blocked", async () => {
    const root = await makeProject({
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });

    await assert.rejects(
      runWeeklyOperation(
        {
          action: "close",
          mode: "dry-run",
          confirm: false,
          weekStart: "2026-06-08",
          weekEnd: "2026-06-14",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /nao corresponde a week_tournaments/
    );
  });

  test("weekly errors block close", async () => {
    const root = await makeProject({
      weekErrorRows: [
        {
          tournament_key: "J-TEST-2026-001",
          tournament_name: "J100 Test",
          category: "J100",
          player_type_code: "B",
          player_type_desc: "Boys",
          match_type_code: "S",
          match_type_desc: "Singles",
          event_classification_code: "M",
          event_classification_desc: "Main",
          drawsheet_structure_code: "KO",
          error_message: "Erro de teste",
          collected_at: "2026-06-22T00:00:00.000Z",
        },
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
      /week_results_errors\.csv possui 1 linhas/
    );
  });

  test("start without 1000 over 1000 base is blocked", async () => {
    const root = await makeProject({
      officialDate: "2026-06-22",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      tournamentRows: [weekTournamentRow("2026-06-15", "2026-06-21")],
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
      /nao reconciliou 1000\/1000/
    );
  });

  test("start apply without confirmation is blocked", async () => {
    const root = await makeProject({
      officialDate: "2026-06-22",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });

    await assert.rejects(
      runWeeklyOperation(
        {
          action: "start",
          mode: "apply",
          confirm: false,
          weekStart: "2026-06-22",
          weekEnd: "2026-06-28",
        },
        { cwd: root, today: "2026-06-22" }
      ),
      /Apply bloqueado/
    );
  });

  test("last_operation report is generated", async () => {
    const root = await makeProject({
      officialDate: "2026-06-15",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      tournamentRows: [stubWeekTournamentRow("2026-06-15", "2026-06-21")],
      matchRows: [],
      playerResultRows: [],
      weekLiveRows: [],
    });

    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-16" }
    );

    const report = JSON.parse(
      await fs.readFile(
        path.join(
          root,
          "data",
          "staging",
          "weekly_operation",
          "last_operation.json"
        ),
        "utf8"
      )
    );

    assert.equal(result.report.status, STATUS_NEW_WEEK_READY);
    assert.equal(report.status, STATUS_NEW_WEEK_READY);
    assert.equal(report.action, "status");
  });

  test("next action is shown correctly for official base updated", async () => {
    const root = await makeProject({
      officialDate: "2026-06-22",
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
    });

    const result = await runWeeklyOperation(
      { action: "status", mode: "dry-run", confirm: false, weekStart: "", weekEnd: "" },
      { cwd: root, today: "2026-06-22" }
    );

    assert.equal(
      result.report.status,
      STATUS_OFFICIAL_BASE_UPDATED_READY_TO_START
    );
    assert.match(result.output, /npm run weekly:start -- --week-start=2026-06-22/);
  });
});
