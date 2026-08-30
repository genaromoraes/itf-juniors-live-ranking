import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { stringify } from "csv-stringify/sync";
import {
  buildBackfillConfig,
  buildStepCommands,
  main as backfillMain,
  parseArgs as parseBackfillArgs,
  validateBackfillArtifacts,
} from "../scripts/17_backfill_week.mjs";
import {
  buildWeekWindow,
  main as tournamentMain,
  parseArgs as parseTournamentArgs,
  parseTournamentUrl,
  resolveOutputPaths as resolveTournamentPaths,
  resolveManualTournamentFile,
  tournamentBelongsToOfficialWeek,
} from "../scripts/04_fetch_week_tournaments.mjs";
import {
  parseArgs as parseResultsArgs,
  resolvePaths as resolveResultsPaths,
} from "../scripts/05_fetch_week_results.mjs";
import {
  parseArgs as parsePointsArgs,
  resolvePaths as resolvePointsPaths,
} from "../scripts/06_calculate_week_live_points.mjs";

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeBackfillOutput(outputDir, overrides = {}) {
  const weekStart = overrides.weekStart || "2026-06-08";
  const weekEnd = overrides.weekEnd || "2026-06-14";
  const tournamentRows = overrides.tournamentRows || [
    {
      week_start: weekStart,
      week_end: weekEnd,
      search_start: "2026-06-06",
      search_end: weekEnd,
      tournament_key: "J-TEST-2026-001",
      tournament_name: "J100 Test",
      category: "J100",
      start_date: weekStart,
      end_date: weekEnd,
    },
  ];
  const summaryRows = overrides.summaryRows || [
    {
      tournament_key: "J-TEST-2026-001",
      tournament_name: "J100 Test",
      category: "J100",
      events_found: "2",
      matches_found: "4",
      errors_found: "0",
      raw_file: path.join(outputDir, "raw", "week_results", "J-TEST-2026-001_draws.json"),
      from_cache: "false",
      collected_at: "2026-06-15T00:00:00.000Z",
    },
  ];
  const matchRows = overrides.matchRows || [
    {
      tournament_key: "J-TEST-2026-001",
      tournament_name: "J100 Test",
      category: "J100",
      start_date: weekStart,
      end_date: weekEnd,
      player_type_code: "B",
      match_type_code: "S",
      event_classification_code: "M",
      round_order: "1",
      match_id: "m1",
      raw_json: "{}",
      collected_at: "2026-06-15T00:00:00.000Z",
    },
  ];
  const playerRows = overrides.playerRows || [
    {
      tournament_key: "J-TEST-2026-001",
      tournament_name: "J100 Test",
      category: "J100",
      start_date: weekStart,
      end_date: weekEnd,
      player_id: "1",
      player_name: "Player One",
      nationality: "BRA",
      player_type_code: "B",
      player_type_desc: "Boys",
      match_type_code: "S",
      match_type_desc: "Singles",
      event_classification_code: "M",
      event_classification_desc: "Main Draw",
      matches_played: "1",
      wins: "1",
      losses: "0",
      highest_round_order: "1",
      highest_round_name: "Round 1",
      last_match_id: "m1",
      last_match_status: "Completed",
      status: "still_alive_or_champion",
      live_points: "",
      collected_at: "2026-06-15T00:00:00.000Z",
    },
  ];
  const errorRows = overrides.errorRows || [];
  const livePointsRows = overrides.livePointsRows || [
    {
      tournament_key: "J-TEST-2026-001",
      tournament_name: "J100 Test",
      category: "J100",
      start_date: weekStart,
      end_date: weekEnd,
      player_id: "1",
      player_name: "Player One",
      nationality: "BRA",
      player_type_code: "B",
      player_type_desc: "Boys",
      event_type: "singles",
      event_classification: "main_draw",
      matches_played: "1",
      wins: "1",
      losses: "0",
      highest_round_order: "1",
      highest_round_name: "Round 1",
      total_rounds_in_draw: "2",
      calculated_round_label: "R16",
      status: "still_alive_or_champion",
      live_points_raw: "10",
      live_points_weighted: "10",
      collected_at: "2026-06-15T00:00:00.000Z",
    },
  ];
  const liveLedgerRows = overrides.liveLedgerRows || [
    {
      player_id: "1",
      player_name: "Player One",
      gender: "M",
      country: "BRA",
      country_name: "",
      birth_year: "",
      event_type: "singles",
      countable_status: "live_unconfirmed",
      tournament_name: "J100 Test",
      category: "J100",
      draw_type: "main_draw",
      host_nation: "",
      host_nation_code: "",
      surface: "",
      surface_code: "",
      start_date: weekStart,
      drop_date_calculated: "",
      round: "R16",
      points: "10",
      tournament_link: "",
      is_countable_at_collection: "false",
      is_live: "true",
      status: "still_alive_or_champion",
      source_url: "",
      collected_at: "2026-06-15T00:00:00.000Z",
      raw_json: "{}",
    },
  ];

  await writeCsv(path.join(outputDir, "week_tournaments.csv"), tournamentRows, [
    "week_start",
    "week_end",
    "search_start",
    "search_end",
    "tournament_key",
    "tournament_name",
    "category",
    "start_date",
    "end_date",
  ]);
  await writeCsv(
    path.join(outputDir, "week_tournaments_debug_all.csv"),
    tournamentRows,
    ["week_start", "week_end", "search_start", "search_end", "tournament_key", "tournament_name", "category", "start_date", "end_date"]
  );
  await writeCsv(path.join(outputDir, "week_matches.csv"), matchRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "start_date",
    "end_date",
    "player_type_code",
    "match_type_code",
    "event_classification_code",
    "round_order",
    "match_id",
    "raw_json",
    "collected_at",
  ]);
  await writeCsv(path.join(outputDir, "week_player_results.csv"), playerRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "start_date",
    "end_date",
    "player_id",
    "player_name",
    "nationality",
    "player_type_code",
    "player_type_desc",
    "match_type_code",
    "match_type_desc",
    "event_classification_code",
    "event_classification_desc",
    "matches_played",
    "wins",
    "losses",
    "highest_round_order",
    "highest_round_name",
    "last_match_id",
    "last_match_status",
    "status",
    "live_points",
    "collected_at",
  ]);
  await writeCsv(path.join(outputDir, "week_results_errors.csv"), errorRows, [
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
  await writeCsv(path.join(outputDir, "week_results_summary.csv"), summaryRows, [
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
  await writeCsv(path.join(outputDir, "week_live_points.csv"), livePointsRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "start_date",
    "end_date",
    "player_id",
    "player_name",
    "nationality",
    "player_type_code",
    "player_type_desc",
    "event_type",
    "event_classification",
    "matches_played",
    "wins",
    "losses",
    "highest_round_order",
    "highest_round_name",
    "total_rounds_in_draw",
    "calculated_round_label",
    "status",
    "live_points_raw",
    "live_points_weighted",
    "collected_at",
  ]);
  await writeCsv(path.join(outputDir, "week_live_ledger_rows.csv"), liveLedgerRows, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",
    "event_type",
    "countable_status",
    "tournament_name",
    "category",
    "draw_type",
    "host_nation",
    "host_nation_code",
    "surface",
    "surface_code",
    "start_date",
    "drop_date_calculated",
    "round",
    "points",
    "tournament_link",
    "is_countable_at_collection",
    "is_live",
    "status",
    "source_url",
    "collected_at",
    "raw_json",
  ]);
  await writeJson(path.join(outputDir, "raw", "week_tournaments.json"), {
    tournaments: tournamentRows,
  });
  await writeJson(path.join(outputDir, "raw", "week_results", "J-TEST-2026-001_draws.json"), {
    ok: true,
  });
  await fs.writeFile(path.join(outputDir, "backfill.log"), "Tudo certo\n", "utf8");
}

describe("historical backfill support", () => {
  test("parses and validates explicit historical window in UTC", () => {
    const config = buildBackfillConfig(
      parseBackfillArgs([
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        "--mode=dry-run",
      ]),
      new Date("2026-06-15T12:00:00.000Z")
    );

    assert.equal(config.weekStart, "2026-06-08");
    assert.equal(config.weekEnd, "2026-06-14");
    assert.equal(config.searchStart, "2026-06-06");
    assert.equal(config.searchEnd, "2026-06-14");
  });

  test("rejects invalid dates and current or future week_end", () => {
    assert.throws(() => {
      buildBackfillConfig(
        parseBackfillArgs(["--week-start=2026-06-xx", "--week-end=2026-06-14"]),
        new Date("2026-06-15T00:00:00.000Z")
      );
    }, /week-start invalida/);

    assert.throws(() => {
      buildBackfillConfig(
        parseBackfillArgs(["--week-start=2026-06-08", "--week-end=2026-06-15"]),
        new Date("2026-06-15T00:00:00.000Z")
      );
    }, /precisa ser anterior/);
  });

  test("default backfill output path is isolated under data/backfills", () => {
    const config = buildBackfillConfig(
      parseBackfillArgs(["--week-start=2026-06-08", "--week-end=2026-06-14"]),
      new Date("2026-06-15T00:00:00.000Z")
    );

    assert.match(config.outputDir, /data[\\/]backfills[\\/]week_2026-06-08_2026-06-14$/);
  });

  test("backfill forwards an explicit manual tournament file", () => {
    const manualFile = path.resolve("data/config/weekly_tournaments_test.json");
    const config = buildBackfillConfig(
      parseBackfillArgs([
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        `--manual-file=${manualFile}`,
      ]),
      new Date("2026-06-15T00:00:00.000Z")
    );
    const tournamentStep = buildStepCommands(config)[0];

    assert.equal(config.manualFile, manualFile);
    assert.ok(tournamentStep.args.includes(`--manual-file=${manualFile}`));
  });

  test("tournament collector automatically uses the configured weekly list", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-config-"));
    const configFile = path.join(
      cwd,
      "data",
      "config",
      "weekly_tournaments_2026-06-29.json"
    );
    await writeJson(configFile, {
      week_start: "2026-06-29",
      week_end: "2026-07-05",
      current_tournaments: [],
    });

    assert.equal(
      await resolveManualTournamentFile("2026-06-29", "", cwd),
      configFile
    );
    assert.equal(await resolveManualTournamentFile("2026-07-06", "", cwd), "");
  });

  test("tournament script keeps current-week default behavior and supports isolated output dir", () => {
    const defaultWindow = buildWeekWindow(parseTournamentArgs([]), new Date("2026-06-17T12:00:00.000Z"));
    assert.deepEqual(defaultWindow, {
      week_start: "2026-06-15",
      week_end: "2026-06-21",
      search_start: "2026-06-13",
      search_end: "2026-06-21",
    });

    const explicitWindow = buildWeekWindow(
      parseTournamentArgs([
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        "--search-start=2026-06-05",
        "--search-end=2026-06-14",
      ])
    );
    assert.equal(explicitWindow.search_start, "2026-06-05");

    const outputPaths = resolveTournamentPaths(
      parseTournamentArgs(["--output-dir=C:\\temp\\backfill"])
    );
    assert.equal(outputPaths.cleanOutputFile, path.resolve("C:\\temp\\backfill", "week_tournaments.csv"));
    assert.equal(outputPaths.rawOutputFile, path.resolve("C:\\temp\\backfill", "raw", "week_tournaments.json"));
  });

  test("tournament selection excludes final-weekend starters that belong to the next week", () => {
    const weekWindow = buildWeekWindow(
      parseTournamentArgs(["--week-start=2026-06-22", "--week-end=2026-06-28"])
    );

    assert.equal(
      tournamentBelongsToOfficialWeek(
        {
          start_date: "2026-06-27",
          end_date: "2026-07-03",
        },
        weekWindow
      ),
      false
    );

    assert.equal(
      tournamentBelongsToOfficialWeek(
        {
          start_date: "2026-06-28",
          end_date: "2026-07-04",
        },
        weekWindow
      ),
      false
    );

    assert.equal(
      tournamentBelongsToOfficialWeek(
        {
          start_date: "2026-06-20",
          end_date: "2026-06-27",
        },
        weekWindow
      ),
      true
    );

    assert.equal(
      tournamentBelongsToOfficialWeek(
        {
          start_date: "2026-06-27",
          end_date: "2026-06-28",
        },
        weekWindow
      ),
      true
    );
  });

  test("tournament selection assigns J300 Repentigny 2026 to the following week", () => {
    const currentWeek = buildWeekWindow(
      parseTournamentArgs(["--week-start=2026-08-24", "--week-end=2026-08-30"])
    );
    const followingWeek = buildWeekWindow(
      parseTournamentArgs(["--week-start=2026-08-31", "--week-end=2026-09-06"])
    );
    const repentigny = {
      start_date: "2026-08-29",
      end_date: "2026-09-04",
    };

    assert.equal(tournamentBelongsToOfficialWeek(repentigny, currentWeek), false);
    assert.equal(tournamentBelongsToOfficialWeek(repentigny, followingWeek), true);
  });

  test("manual tournament file writes current tournaments and raw dropping audit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "manual-tournaments-"));
    const manualFile = path.join(root, "week.json");
    const outputDir = path.join(root, "out");

    await fs.writeFile(
      manualFile,
      JSON.stringify({
        week_start: "2026-06-22",
        week_end: "2026-06-28",
        current_tournaments: [
          "https://www.itftennis.com/en/tournament/j200-pilsen/cze/2026/j-j200-cze-2026-001/",
        ],
        dropping_tournaments: [
          "https://www.itftennis.com/en/tournament/j200-veracruz/mex/2025/j-j200-mex-2025-001/",
          "https://www.itftennis.com/en/tournament/j200-veracruz/mex/2025/j-j200-mex-2025-001/",
        ],
      }),
      "utf8"
    );

    await tournamentMain(
      parseTournamentArgs([
        "--week-start=2026-06-22",
        "--week-end=2026-06-28",
        `--output-dir=${outputDir}`,
        `--manual-file=${manualFile}`,
      ])
    );

    const tournamentsCsv = await fs.readFile(
      path.join(outputDir, "week_tournaments.csv"),
      "utf8"
    );
    const raw = JSON.parse(
      await fs.readFile(path.join(outputDir, "raw", "week_tournaments.json"), "utf8")
    );

    assert.match(tournamentsCsv, /J-J200-CZE-2026-001/);
    assert.match(tournamentsCsv, /J200 Pilsen/);
    assert.equal(raw.manual_tournaments_count, 1);
    assert.equal(raw.manual_dropping_tournaments_count, 1);
    assert.deepEqual(raw.duplicate_dropping_tournament_keys, [
      { tournament_key: "J-J200-MEX-2025-001", count: 2 },
    ]);
  });

  test("ITF tournament URL parser extracts key, category and location", () => {
    assert.deepEqual(
      parseTournamentUrl(
        "https://www.itftennis.com/en/tournament/j200-puerto-escondido/mex/2026/j-j200-mex-2026-002/"
      ),
      {
        url: "https://www.itftennis.com/en/tournament/j200-puerto-escondido/mex/2026/j-j200-mex-2026-002/",
        slug: "j200-puerto-escondido",
        nation_code: "MEX",
        year: "2026",
        key: "J-J200-MEX-2026-002",
        category: "J200",
        location: "Puerto Escondido",
        name: "J200 Puerto Escondido",
      }
    );
  });

  test("results and points scripts resolve isolated input and output dirs", () => {
    const resultPaths = resolveResultsPaths(
      parseResultsArgs(["--input-dir=C:\\input", "--output-dir=C:\\output"])
    );
    assert.equal(resultPaths.tournamentsFile, path.resolve("C:\\input", "week_tournaments.csv"));
    assert.equal(resultPaths.weekMatchesFile, path.resolve("C:\\output", "week_matches.csv"));
    assert.equal(resultPaths.rawDir, path.resolve("C:\\output", "raw", "week_results"));

    const pointsPaths = resolvePointsPaths(
      parsePointsArgs(["--input-dir=C:\\input", "--output-dir=C:\\output"])
    );
    assert.equal(pointsPaths.weekPlayerResultsFile, path.resolve("C:\\input", "week_player_results.csv"));
    assert.equal(pointsPaths.weekLiveLedgerRowsFile, path.resolve("C:\\output", "week_live_ledger_rows.csv"));
  });

  test("dry-run prints commands and does not create output dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-dry-run-"));
    const outputDir = path.join(root, "out");

    await backfillMain({
      argv: [
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        `--output-dir=${outputDir}`,
        "--mode=dry-run",
      ],
      now: new Date("2026-06-15T00:00:00.000Z"),
    });

    await assert.rejects(fs.stat(outputDir));
  });

  test("run mode writes isolated artifacts and report without touching clean base", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-run-"));
    const outputDir = path.join(root, "artifacts");
    const config = buildBackfillConfig(
      parseBackfillArgs([
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        `--output-dir=${outputDir}`,
        "--mode=run",
      ]),
      new Date("2026-06-15T00:00:00.000Z")
    );

    const stepsSeen = [];

    await backfillMain({
      argv: [
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        `--output-dir=${outputDir}`,
        "--mode=run",
      ],
      now: new Date("2026-06-15T00:00:00.000Z"),
      runner: async (step, stepConfig) => {
        stepsSeen.push(step.name);
        await writeCsv(path.join(stepConfig.outputDir, "..", "data", "clean", "should_not_exist.csv"), [], ["a"]).catch(() => {});
        if (step.name === "Calcular pontos live historicos") {
          await makeBackfillOutput(stepConfig.outputDir);
        }
      },
    });

    assert.deepEqual(stepsSeen, buildStepCommands(config).map((step) => step.name));
    assert.ok(await fs.stat(path.join(outputDir, "backfill_report.json")));
    assert.ok(await fs.stat(path.join(outputDir, "week_live_ledger_rows.csv")));
    await assert.rejects(fs.stat(path.join(root, "data", "clean", "week_tournaments.csv")));
  });

  test("artifact validation fails when there are no tournaments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-empty-tournaments-"));
    const outputDir = path.join(root, "artifacts");

    await makeBackfillOutput(outputDir, { tournamentRows: [] });

    const validation = await validateBackfillArtifacts({
      outputDir,
      rawResultsDir: path.join(outputDir, "raw", "week_results"),
      logFile: path.join(outputDir, "backfill.log"),
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
    });

    assert.equal(validation.validation_passed, false);
    assert.match(validation.validation_errors.join("\n"), /week_tournaments\.csv esta vazio/);
  });

  test("artifact validation fails when there are no usable matches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-empty-matches-"));
    const outputDir = path.join(root, "artifacts");

    await makeBackfillOutput(outputDir, {
      matchRows: [],
      playerRows: [],
      liveLedgerRows: [],
    });

    const validation = await validateBackfillArtifacts({
      outputDir,
      rawResultsDir: path.join(outputDir, "raw", "week_results"),
      logFile: path.join(outputDir, "backfill.log"),
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
    });

    assert.equal(validation.validation_passed, false);
    assert.match(validation.validation_errors.join("\n"), /week_matches\.csv esta vazio/);
    assert.match(validation.validation_errors.join("\n"), /week_player_results\.csv esta vazio/);
    assert.match(validation.validation_errors.join("\n"), /week_live_ledger_rows\.csv esta vazio/);
  });

  test("validation rejects blocked HTML/403 signatures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "backfill-blocked-"));
    const outputDir = path.join(root, "artifacts");

    await makeBackfillOutput(outputDir, {
      errorRows: [
        {
          tournament_key: "J-TEST-2026-001",
          tournament_name: "J100 Test",
          category: "J100",
          player_type_code: "B",
          player_type_desc: "Boys",
          match_type_code: "S",
          match_type_desc: "Singles",
          event_classification_code: "M",
          event_classification_desc: "Main Draw",
          drawsheet_structure_code: "KO",
          error_message: "HTTP 403. Content-Type: text/html. Text: <html>Incapsula</html>",
          collected_at: "2026-06-15T00:00:00.000Z",
        },
      ],
    });

    const validation = await validateBackfillArtifacts({
      outputDir,
      rawResultsDir: path.join(outputDir, "raw", "week_results"),
      logFile: path.join(outputDir, "backfill.log"),
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
    });

    assert.equal(validation.validation_passed, false);
    assert.match(validation.validation_errors.join("\n"), /Bloqueio\/HTML detectado/);
  });

  test("UTC guard does not allow closing the current week by timezone accident", () => {
    assert.throws(() => {
      buildBackfillConfig(
        parseBackfillArgs(["--week-start=2026-06-09", "--week-end=2026-06-15"]),
        new Date("2026-06-14T21:30:00-03:00")
      );
    }, /precisa ser anterior/);
  });
});
