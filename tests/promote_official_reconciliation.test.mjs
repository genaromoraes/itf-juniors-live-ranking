import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { LEDGER_COLUMNS } from "../scripts/lib/weekly_ledger.mjs";
import {
  DESTINATION_FILES,
  runPromotion,
  validateSourceRows,
} from "../scripts/20_promote_official_reconciliation.mjs";
import {
  OFFICIAL_PLAYER_COLUMNS,
  OFFICIAL_SNAPSHOT_COLUMNS,
  sha256File,
} from "../scripts/lib/official_ledger_validation.mjs";

const RANKING_DATE = "2026-06-15";

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(rows, { header: true, columns }), "utf8");
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

function player(index, overrides = {}) {
  const gender = index <= 1000 ? "M" : "F";
  return {
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    first_name: "Player",
    last_name: String(index),
    gender,
    itf_gender_code: gender === "M" ? "B" : "G",
    country: "BRA",
    country_name: "Brazil",
    birth_date: "",
    birth_year: "2009",
    junior_last_year: "2027",
    active_junior: "",
    profile_url: "",
    current_rank: gender === "M" ? index : index - 1000,
    current_points: "100",
    first_seen_date: "2026-06-08",
    last_seen_date: RANKING_DATE,
    raw_json: "{}",
    ...overrides,
  };
}

function snapshot(index, overrides = {}) {
  const gender = index <= 1000 ? "M" : "F";
  return {
    ranking_date: RANKING_DATE,
    gender,
    rank: gender === "M" ? index : index - 1000,
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    official_points: "100",
    source_url: "",
    collected_at: "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}

function ledgerRow(index, overrides = {}) {
  const gender = index <= 1000 ? "M" : "F";
  return {
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    gender,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
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
    points: "100",
    tournament_link: "",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_official_reconciliation",
    source_url: "",
    collected_at: "2026-06-16T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function validSummary(overrides = {}) {
  return {
    ranking_date: RANKING_DATE,
    final_total: 2000,
    final_exact: 2000,
    final_divergent: 0,
    final_missing_ledger: 0,
    unique_ledger_players: 2000,
    ledger_players_outside_official: 0,
    breakdowns_failed: 0,
    mode_safe_for_promotion: true,
    ...overrides,
  };
}

async function writeSource(sourceDir, overrides = {}) {
  const players = overrides.players || Array.from({ length: 2000 }, (_, i) => player(i + 1));
  const snapshots =
    overrides.snapshots || Array.from({ length: 2000 }, (_, i) => snapshot(i + 1));
  const ledger = overrides.ledger || Array.from({ length: 2000 }, (_, i) => ledgerRow(i + 1));

  await writeCsv(path.join(sourceDir, "players.next.csv"), players, OFFICIAL_PLAYER_COLUMNS);
  await writeCsv(
    path.join(sourceDir, "rankings_snapshot.next.csv"),
    snapshots,
    OFFICIAL_SNAPSHOT_COLUMNS
  );
  await writeCsv(
    path.join(sourceDir, "points_ledger.next_official.csv"),
    ledger,
    LEDGER_COLUMNS
  );
  await writeCsv(path.join(sourceDir, "final_validation.csv"), [], [
    "player_id",
    "exact_match",
  ]);
  await writeCsv(
    path.join(sourceDir, "removed_players_ledger_archive.csv"),
    [],
    LEDGER_COLUMNS
  );
  await fs.writeFile(
    path.join(sourceDir, "official_reconciliation_summary.json"),
    `${JSON.stringify(overrides.summary || validSummary(), null, 2)}\n`,
    "utf8"
  );

  return { players, snapshots, ledger };
}

async function makeProject(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promote-official-"));
  const sourceDir = path.join(root, "source");
  const cleanDir = path.join(root, "data", "clean");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(cleanDir, { recursive: true });

  const oldPlayers = [
    ...Array.from({ length: 1990 }, (_, i) => player(i + 1)),
    ...Array.from({ length: 10 }, (_, i) =>
      player(i + 1991, { player_id: `old${i + 1}`, player_name: `Old ${i + 1}` })
    ),
  ];
  const oldSnapshot = oldPlayers.map((row, index) => ({
    ...snapshot(Math.min(index + 1, 2000)),
    ranking_date: "2026-06-08",
    player_id: row.player_id,
    player_name: row.player_name,
    rank: (index % 1000) + 1,
  }));
  const oldLedger = oldPlayers.map((row, index) =>
    ledgerRow(Math.min(index + 1, 2000), {
      player_id: row.player_id,
      player_name: row.player_name,
      tournament_name: `Old Tournament ${index + 1}`,
    })
  );

  await writeCsv(path.join(cleanDir, "players.csv"), oldPlayers, OFFICIAL_PLAYER_COLUMNS);
  await writeCsv(
    path.join(cleanDir, "rankings_snapshot.csv"),
    oldSnapshot,
    OFFICIAL_SNAPSHOT_COLUMNS
  );
  await writeCsv(path.join(cleanDir, "points_ledger.csv"), oldLedger, LEDGER_COLUMNS);
  const source = await writeSource(sourceDir, overrides);

  return { root, sourceDir, cleanDir, source };
}

async function destinationHashes(root) {
  const result = {};
  for (const [label, relativePath] of Object.entries(DESTINATION_FILES)) {
    result[label] = await sha256File(path.join(root, relativePath));
  }
  return result;
}

describe("official reconciliation promotion", () => {
  test("dry-run does not alter data/clean", async () => {
    const { root, sourceDir } = await makeProject();
    const before = await destinationHashes(root);

    const result = await runPromotion({
      sourceDir,
      rankingDate: RANKING_DATE,
      mode: "dry-run",
    }, { cwd: root, now: new Date("2026-06-16T00:00:00Z") });
    const after = await destinationHashes(root);

    assert.deepEqual(after, before);
    assert.equal(result.report.promotion_completed, false);
    assert.equal(result.report.validation_passed, true);
  });

  test("invalid summary blocks promotion", async () => {
    const { root, sourceDir } = await makeProject({
      summary: validSummary({ final_exact: 999 }),
    });

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "dry-run" }, { cwd: root }),
      /summary.final_exact/
    );
  });

  test("999 players blocks promotion", async () => {
    const { root, sourceDir } = await makeProject({
      players: Array.from({ length: 999 }, (_, i) => player(i + 1)),
    });

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "dry-run" }, { cwd: root }),
      /2000 linhas/
    );
  });

  test("duplicate identity blocks promotion", async () => {
    const ledger = Array.from({ length: 2000 }, (_, i) => ledgerRow(i + 1));
    ledger[1] = { ...ledger[0] };
    const { root, sourceDir } = await makeProject({ ledger });

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "dry-run" }, { cwd: root }),
      /duplicata pela chave/
    );
  });

  test("external player blocks promotion", async () => {
    const ledger = Array.from({ length: 2000 }, (_, i) => ledgerRow(i + 1));
    ledger[0] = ledgerRow(1, { player_id: "external" });
    const { root, sourceDir } = await makeProject({ ledger });

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "dry-run" }, { cwd: root }),
      /fora de players.next.csv/
    );
  });

  test("is_live true blocks promotion", async () => {
    const ledger = Array.from({ length: 2000 }, (_, i) => ledgerRow(i + 1));
    ledger[0] = ledgerRow(1, { is_live: "true" });
    const { root, sourceDir } = await makeProject({ ledger });

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "dry-run" }, { cwd: root }),
      /is_live=true/
    );
  });

  test("apply without confirmation blocks before writing", async () => {
    const { root, sourceDir } = await makeProject();
    const before = await destinationHashes(root);

    await assert.rejects(
      runPromotion({ sourceDir, rankingDate: RANKING_DATE, mode: "apply" }, { cwd: root }),
      /confirm-promotion=true/
    );
    assert.deepEqual(await destinationHashes(root), before);
  });

  test("apply creates backup and promotes atomically", async () => {
    const { root, sourceDir } = await makeProject();
    const result = await runPromotion({
      sourceDir,
      rankingDate: RANKING_DATE,
      mode: "apply",
      confirmPromotion: true,
    }, { cwd: root, now: new Date("2026-06-16T00:00:00Z") });

    assert.equal(result.report.promotion_completed, true);
    assert.ok(await fs.stat(path.join(result.report.backup_dir, "backup_manifest.json")));
    assert.equal((await readCsv(path.join(root, "data/clean/players.csv"))).length, 2000);
    assert.equal(
      (await readCsv(path.join(root, "data/clean/rankings_snapshot.csv")))[0].ranking_date,
      RANKING_DATE
    );
  });

  test("intermediate failure restores backup", async () => {
    const { root, sourceDir } = await makeProject();
    const before = await destinationHashes(root);

    await assert.rejects(
      runPromotion({
        sourceDir,
        rankingDate: RANKING_DATE,
        mode: "apply",
        confirmPromotion: true,
      }, {
        cwd: root,
        now: new Date("2026-06-16T00:00:00Z"),
        failAfterFirstRename: true,
      }),
      /Falha simulada/
    );

    assert.deepEqual(await destinationHashes(root), before);
  });

  test("second apply attempt is idempotent", async () => {
    const { root, sourceDir } = await makeProject();
    await runPromotion({
      sourceDir,
      rankingDate: RANKING_DATE,
      mode: "apply",
      confirmPromotion: true,
    }, { cwd: root, now: new Date("2026-06-16T00:00:00Z") });
    const first = await destinationHashes(root);
    await runPromotion({
      sourceDir,
      rankingDate: RANKING_DATE,
      mode: "apply",
      confirmPromotion: true,
    }, { cwd: root, now: new Date("2026-06-16T00:00:01Z") });

    assert.deepEqual(await destinationHashes(root), first);
  });

  test("final ranking_date is validated", () => {
    const validation = validateSourceRows({
      summary: validSummary(),
      playersRows: Array.from({ length: 2000 }, (_, i) => player(i + 1)),
      snapshotRows: Array.from({ length: 2000 }, (_, i) =>
        snapshot(i + 1, i === 0 ? { ranking_date: "2026-06-08" } : {})
      ),
      ledgerRows: Array.from({ length: 2000 }, (_, i) => ledgerRow(i + 1)),
      rankingDate: RANKING_DATE,
    });

    assert.equal(validation.validationPassed, false);
    assert.match(validation.errors.join("\n"), /ranking_date invalido/);
  });
});
