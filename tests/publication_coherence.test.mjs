import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { stringify } from "csv-stringify/sync";
import { validatePublication } from "../scripts/26_validate_publication_coherence.mjs";

const RANKING_DATE = "2026-07-13";
const WEEK_END = "2026-07-19";

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(rows, { header: true, columns }), "utf8");
}

function rankingRows() {
  return ["M", "F"].flatMap((gender) =>
    Array.from({ length: 1000 }, (_, index) => ({
      ranking_date: RANKING_DATE,
      gender,
      player_id: `${gender}-${index + 1}`,
    }))
  );
}

async function createFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "publication-coherence-"));
  const cleanDir = path.join(cwd, "data", "clean");
  const exportsDir = path.join(cwd, "data", "exports");
  const rows = rankingRows();

  await writeCsv(path.join(cleanDir, "rankings_snapshot.csv"), rows, [
    "ranking_date",
    "gender",
    "player_id",
  ]);
  await writeCsv(path.join(cleanDir, "live_ranking_with_drops.csv"), rows, [
    "ranking_date",
    "gender",
    "player_id",
  ]);
  await writeCsv(
    path.join(cleanDir, "week_tournaments.csv"),
    [
      {
        week_start: RANKING_DATE,
        week_end: WEEK_END,
        tournament_key: "J-J100-TEST-2026-001",
        tournament_name: "J100 Test",
      },
    ],
    ["week_start", "week_end", "tournament_key", "tournament_name"]
  );
  await writeCsv(path.join(cleanDir, "week_results_errors.csv"), [], [
    "tournament_key",
    "error",
  ]);
  await fs.mkdir(exportsDir, { recursive: true });
  await fs.writeFile(
    path.join(exportsDir, "index.html"),
    `<script>const data=[{\"ranking_date\":\"${RANKING_DATE}\"}]</script>`,
    "utf8"
  );

  return { cwd, cleanDir };
}

test("accepts a coherent publication package", async () => {
  const fixture = await createFixture();
  const report = await validatePublication({ cwd: fixture.cwd });
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
});

test("blocks cached tournament data from the previous week", async () => {
  const fixture = await createFixture();
  await writeCsv(
    path.join(fixture.cleanDir, "week_tournaments.csv"),
    [
      {
        week_start: "2026-07-06",
        week_end: "2026-07-12",
        tournament_key: "J-J100-OLD-2026-001",
        tournament_name: "J100 Old",
      },
    ],
    ["week_start", "week_end", "tournament_key", "tournament_name"]
  );

  const report = await validatePublication({ cwd: fixture.cwd });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /semana publicada comeca em 2026-07-06/);
});

test("blocks publication when collection errors exist", async () => {
  const fixture = await createFixture();
  await writeCsv(
    path.join(fixture.cleanDir, "week_results_errors.csv"),
    [{ tournament_key: "J-J100-TEST-2026-001", error: "network" }],
    ["tournament_key", "error"]
  );

  const report = await validatePublication({ cwd: fixture.cwd });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /1 erro\(s\) de coleta/);
});
