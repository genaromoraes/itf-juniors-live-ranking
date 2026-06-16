import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  LEDGER_COLUMNS,
  buildCloseWeekPlan,
  calculateDropDate,
  rowsHaveSameContent,
  todayIso,
  transformLiveRows,
} from "../scripts/lib/weekly_ledger.mjs";

const SCRIPT_PATH = path.resolve("scripts/16_close_week.mjs");

const PLAYER = {
  player_id: "p1",
  player_name: "Player One",
  gender: "M",
  country: "BRA",
  country_name: "Brazil",
  birth_year: "2009",
};

const TOURNAMENT = {
  week_start: "2026-06-08",
  week_end: "2026-06-14",
  tournament_key: "J-TEST-2026-001",
  tournament_name: "J100 Test",
  category: "J100",
  host_nation: "Brazil",
  host_nation_code: "BRA",
  start_date: "2026-06-08",
  end_date: "2026-06-14",
  surface: "Clay",
  surface_code: "C",
  tournament_link: "https://example.test/tournament",
};

function baseLedgerRow(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player One",
    gender: "M",
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    event_type: "singles",
    countable_status: "countable",
    tournament_name: "Old Tournament",
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
    tournament_link: "https://example.test/old",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_from_initial_breakdown",
    source_url: "",
    collected_at: "2026-06-08T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function liveRow(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player One",
    gender: "",
    country: "",
    country_name: "",
    birth_year: "",
    event_type: "doubles",
    countable_status: "live_unconfirmed",
    tournament_name: "J100 Test",
    category: "J100",
    draw_type: "main_draw",
    host_nation: "",
    host_nation_code: "",
    surface: "",
    surface_code: "",
    start_date: "2026-06-08",
    drop_date_calculated: "",
    round: "R16",
    points: "7",
    tournament_link: "",
    is_countable_at_collection: "false",
    is_live: "true",
    status: "still_alive_or_champion",
    source_url: "",
    collected_at: "2026-06-14T12:00:00.000Z",
    raw_json: JSON.stringify({ tournament_key: "J-TEST-2026-001" }),
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

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

async function makeFixture({
  layout = "direct",
  invalidBase = false,
  omitRequiredFile = "",
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "week-close-"));
  const cleanDir = path.join(root, "data/clean");
  const sourceDir = path.join(root, "source");
  const sourceRoot =
    layout === "archived" ? path.join(sourceDir, "data/clean") : sourceDir;

  await writeCsv(path.join(cleanDir, "players.csv"), [PLAYER], [
    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",
  ]);
  await writeCsv(
    path.join(cleanDir, "points_ledger.csv"),
    [baseLedgerRow(invalidBase ? { drop_date_calculated: "" } : {})],
    LEDGER_COLUMNS
  );

  if (omitRequiredFile !== "week_tournaments.csv") {
    await writeCsv(path.join(sourceRoot, "week_tournaments.csv"), [TOURNAMENT], [
      "week_start",
      "week_end",
      "tournament_key",
      "tournament_name",
      "category",
      "host_nation",
      "host_nation_code",
      "start_date",
      "end_date",
      "surface",
      "surface_code",
      "tournament_link",
    ]);
  }

  if (omitRequiredFile !== "week_live_ledger_rows.csv") {
    await writeCsv(
      path.join(sourceRoot, "week_live_ledger_rows.csv"),
      [liveRow()],
      LEDGER_COLUMNS
    );
  }

  if (omitRequiredFile !== "week_player_results.csv") {
    await writeCsv(path.join(sourceRoot, "week_player_results.csv"), [{ player_id: "p1" }], [
      "player_id",
    ]);
  }

  if (omitRequiredFile !== "week_matches.csv") {
    await writeCsv(path.join(sourceRoot, "week_matches.csv"), [{ match_id: "m1" }], [
      "match_id",
    ]);
  }

  return { root, sourceDir };
}

describe("weekly ledger close", () => {
  test("calculates drop_date as start_date plus 364 days", () => {
    assert.equal(calculateDropDate("2026-06-08"), "2027-06-07");
  });

  test("transforms live rows into confirmed incremental rows", () => {
    const result = transformLiveRows({
      liveRows: [liveRow()],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      now: "2026-06-15T00:00:00.000Z",
    });

    assert.equal(result.rejectedRows.length, 0);
    assert.equal(result.rows[0].is_live, "false");
    assert.equal(result.rows[0].countable_status, "confirmed_incremental");
    assert.equal(result.rows[0].status, "confirmed_from_week_close");
    assert.equal(result.rows[0].drop_date_calculated, "2027-06-07");
    assert.equal(result.rows[0].country, "BRA");
    assert.equal(result.rows[0].surface, "Clay");
  });

  test("preserves raw doubles points", () => {
    const result = transformLiveRows({
      liveRows: [liveRow({ event_type: "doubles", points: "135" })],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
    });

    assert.equal(result.rows[0].points, "135");
  });

  test("replaces existing rows by key without round or points", () => {
    const old = baseLedgerRow({
      event_type: "doubles",
      tournament_name: "J100 Test",
      start_date: "2026-06-08",
      round: "QF",
      points: "15",
    });
    const plan = buildCloseWeekPlan({
      baseRows: [old],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow({ round: "R16", points: "7" })],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.replacedRows.length, 1);
    assert.equal(plan.addedRows.length, 0);
    assert.equal(plan.nextRows.length, 1);
    assert.equal(plan.nextRows[0].round, "R16");
    assert.equal(plan.nextRows[0].points, "7");
  });

  test("is idempotent with identical ordered content", () => {
    const first = buildCloseWeekPlan({
      baseRows: [baseLedgerRow()],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow()],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });
    const second = buildCloseWeekPlan({
      baseRows: first.nextRows,
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow()],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.deepEqual(second.nextRows, first.nextRows);
    assert.equal(rowsHaveSameContent(second.nextRows, first.nextRows), true);
  });

  test("preserves unrelated history field by field", () => {
    const history = baseLedgerRow({ tournament_name: "Unrelated" });
    const plan = buildCloseWeekPlan({
      baseRows: [history],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow()],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.preservedRows.length, 1);
    assert.deepEqual(plan.preservedRows[0], history);
    assert.deepEqual(plan.nextRows[0], history);
    assert.equal(plan.nextRows.length, 2);
  });

  test("uses UTC date calculation for current-day protection", () => {
    assert.equal(todayIso(new Date("2026-06-14T23:30:00-03:00")), "2026-06-15");

    const plan = buildCloseWeekPlan({
      baseRows: [baseLedgerRow()],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow()],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.report.validation_passed, true);
  });

  test("rejects an in-progress week", () => {
    const plan = buildCloseWeekPlan({
      baseRows: [baseLedgerRow()],
      playersRows: [PLAYER],
      tournamentRows: [{ ...TOURNAMENT, week_start: "2026-06-15", week_end: "2026-06-21" }],
      liveRows: [liveRow()],
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.report.validation_passed, false);
    assert.match(plan.report.safety_errors.join("\n"), /Semana ainda em andamento/);
  });

  test("rejects a tournament ending after week_end", () => {
    const plan = buildCloseWeekPlan({
      baseRows: [baseLedgerRow()],
      playersRows: [PLAYER],
      tournamentRows: [{ ...TOURNAMENT, end_date: "2026-06-15" }],
      liveRows: [liveRow()],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.report.validation_passed, false);
    assert.match(
      plan.report.safety_errors.join("\n"),
      /torneios com end_date ausente ou posterior/
    );
  });

  test("rejects invalid live rows", () => {
    const plan = buildCloseWeekPlan({
      baseRows: [baseLedgerRow()],
      playersRows: [PLAYER],
      tournamentRows: [TOURNAMENT],
      liveRows: [liveRow({ player_id: "", points: "abc" })],
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      currentDate: "2026-06-15",
    });

    assert.equal(plan.rejectedRows.length, 1);
    assert.equal(plan.report.validation_passed, false);
  });

  test("dry-run accepts files directly in source-dir and does not alter points_ledger.csv", async () => {
    const { root, sourceDir } = await makeFixture({ layout: "direct" });
    const ledgerPath = path.join(root, "data/clean/points_ledger.csv");
    const before = await fs.readFile(ledgerPath, "utf8");

    execFileSync(process.execPath, [
      SCRIPT_PATH,
      `--source-dir=${sourceDir}`,
      "--week-start=2026-06-08",
      "--week-end=2026-06-14",
      "--mode=dry-run",
    ], { cwd: root });

    const after = await fs.readFile(ledgerPath, "utf8");

    assert.equal(after, before);
    assert.ok(
      await fs.stat(path.join(root, "data/staging/week_close_2026-06-14/close_week_report.json"))
    );
  });

  test("dry-run accepts archived files under source-dir/data/clean", async () => {
    const { root, sourceDir } = await makeFixture({ layout: "archived" });

    execFileSync(process.execPath, [
      SCRIPT_PATH,
      `--source-dir=${sourceDir}`,
      "--week-start=2026-06-08",
      "--week-end=2026-06-14",
      "--mode=dry-run",
    ], { cwd: root });

    const report = JSON.parse(
      await fs.readFile(
        path.join(root, "data/staging/week_close_2026-06-14/close_week_report.json"),
        "utf8"
      )
    );

    assert.equal(report.validation_passed, true);
  });

  test("fails when a required source file is missing", async () => {
    const { root, sourceDir } = await makeFixture({
      omitRequiredFile: "week_matches.csv",
    });

    assert.throws(() => {
      execFileSync(process.execPath, [
        SCRIPT_PATH,
        `--source-dir=${sourceDir}`,
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        "--mode=dry-run",
      ], { cwd: root, stdio: "pipe" });
    }, /Command failed/);
  });

  test("apply writes .next safely and creates backup", async () => {
    const { root, sourceDir } = await makeFixture();

    execFileSync(process.execPath, [
      SCRIPT_PATH,
      `--source-dir=${sourceDir}`,
      "--week-start=2026-06-08",
      "--week-end=2026-06-14",
      "--mode=apply",
      "--confirm-closed-week=true",
    ], { cwd: root });

    const rows = await readCsv(path.join(root, "data/clean/points_ledger.csv"));

    assert.equal(rows.length, 2);
    assert.ok(
      await fs.stat(path.join(root, "data/backups/week_close_2026-06-14/points_ledger.csv"))
    );

    await assert.rejects(
      fs.stat(path.join(root, "data/clean/points_ledger.csv.next"))
    );
  });

  test("apply keeps the original ledger and removes .next after validation failure", async () => {
    const { root, sourceDir } = await makeFixture({ invalidBase: true });
    const ledgerPath = path.join(root, "data/clean/points_ledger.csv");
    const before = await fs.readFile(ledgerPath, "utf8");

    assert.throws(() => {
      execFileSync(process.execPath, [
        SCRIPT_PATH,
        `--source-dir=${sourceDir}`,
        "--week-start=2026-06-08",
        "--week-end=2026-06-14",
        "--mode=apply",
        "--confirm-closed-week=true",
      ], { cwd: root, stdio: "pipe" });
    }, /Command failed/);

    const after = await fs.readFile(ledgerPath, "utf8");
    assert.equal(after, before);
    assert.ok(
      await fs.stat(path.join(root, "data/backups/week_close_2026-06-14/points_ledger.csv"))
    );
    await assert.rejects(
      fs.stat(path.join(root, "data/clean/points_ledger.csv.next"))
    );
  });
});
