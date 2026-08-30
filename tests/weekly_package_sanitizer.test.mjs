import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  sanitizeWeeklyPackage,
  splitWeeklyTournaments,
} from "../scripts/27_sanitize_weekly_package.mjs";

const WEEK_COLUMNS = [
  "week_start",
  "week_end",
  "tournament_key",
  "tournament_name",
  "start_date",
  "end_date",
];

const CURRENT = {
  week_start: "2026-08-24",
  week_end: "2026-08-30",
  tournament_key: "J-J300-USA-2026-003",
  tournament_name: "J300 College Park",
  start_date: "2026-08-24",
  end_date: "2026-08-29",
};

const NEXT = {
  week_start: "2026-08-24",
  week_end: "2026-08-30",
  tournament_key: "J-J300-CAN-2026-001",
  tournament_name: "J300 Repentigny",
  start_date: "2026-08-29",
  end_date: "2026-09-04",
};

async function writeCsv(filePath, rows, columns) {
  await fs.writeFile(filePath, stringify(rows, { header: true, columns }), "utf8");
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

test("weekly package classifier assigns Repentigny to the following week", () => {
  const result = splitWeeklyTournaments([CURRENT, NEXT]);

  assert.deepEqual(result.accepted.map((row) => row.tournament_key), [
    CURRENT.tournament_key,
  ]);
  assert.deepEqual(result.rejected.map((row) => row.tournament_key), [
    NEXT.tournament_key,
  ]);
});

test("weekly package sanitizer removes an out-of-week tournament and its rows", async () => {
  const cleanDir = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-sanitizer-"));
  const relatedColumns = ["tournament_key", "tournament_name", "value"];

  await writeCsv(
    path.join(cleanDir, "week_tournaments.csv"),
    [CURRENT, NEXT],
    WEEK_COLUMNS
  );

  for (const file of [
    "week_matches.csv",
    "week_player_results.csv",
    "week_results_errors.csv",
    "week_results_summary.csv",
  ]) {
    await writeCsv(
      path.join(cleanDir, file),
      [
        {
          tournament_key: CURRENT.tournament_key,
          tournament_name: CURRENT.tournament_name,
          value: "keep",
        },
        {
          tournament_key: NEXT.tournament_key,
          tournament_name: NEXT.tournament_name,
          value: "remove",
        },
      ],
      relatedColumns
    );
  }

  const report = await sanitizeWeeklyPackage(cleanDir);

  assert.equal(report.tournamentsBefore, 2);
  assert.equal(report.tournamentsAfter, 1);
  assert.deepEqual(report.removedTournamentKeys, [NEXT.tournament_key]);

  for (const file of [
    "week_tournaments.csv",
    "week_matches.csv",
    "week_player_results.csv",
    "week_results_errors.csv",
    "week_results_summary.csv",
  ]) {
    const rows = await readCsv(path.join(cleanDir, file));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tournament_key, CURRENT.tournament_key);
  }
});
