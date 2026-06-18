import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { validatePlayersBase } from "../scripts/08_calculate_live_ranking_with_drops.mjs";
import {
  BASE_STATE_LEGACY_500,
  BASE_STATE_TOP1000_ACTIVE,
  BASE_STATE_TOP1000_STAGING,
} from "../scripts/lib/ranking_limits.mjs";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  PLAYER_COLUMNS,
  SNAPSHOT_COLUMNS,
  copyExistingLedgerForStaging,
  promoteTop1000Base,
  resolveTop1000Paths,
  universeRowsToPlayers,
  universeRowsToSnapshot,
  validateAndWriteTop1000Report,
  validateTop1000Rows,
  writeCsvAtomic,
  writeJsonAtomic,
} from "../scripts/lib/top1000_migration.mjs";

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(rows, { header: true, columns }), "utf8");
}

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function readCsvRows(filePath) {
  return parse(await readText(filePath), { columns: true, skip_empty_lines: true });
}

function universeRow(index, overrides = {}) {
  const gender = index <= 1000 ? "M" : "F";
  const rank = gender === "M" ? index : index - 1000;
  return {
    ranking_date: "2026-06-15",
    gender,
    rank: String(rank),
    player_id: `p${index}`,
    player_name: `Player ${index}`,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    official_points: "100",
    profile_url: "",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

function ledgerRow(index, overrides = {}) {
  const row = universeRow(index);
  return {
    player_id: row.player_id,
    player_name: row.player_name,
    gender: row.gender,
    country: row.country,
    country_name: row.country_name,
    birth_year: row.birth_year,
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
    collected_at: "2026-06-15T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function legacyUniverseRows() {
  return [
    ...Array.from({ length: 500 }, (_, index) => universeRow(index + 1)),
    ...Array.from({ length: 500 }, (_, index) => universeRow(index + 1001)),
  ];
}

function summaryRow(index) {
  const row = universeRow(index);
  return {
    player_id: row.player_id,
    player_name: row.player_name,
    gender: row.gender,
    rank: row.rank,
    ranking_date: row.ranking_date,
    status: "fetched",
    ledger_rows: "1",
    updated_at: "2026-06-15T00:00:00.000Z",
  };
}

async function makeProject({ fullStaging = true, errors = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "top1000-migration-"));
  const paths = resolveTop1000Paths(root);
  const productionUniverse = legacyUniverseRows();
  const productionPlayers = universeRowsToPlayers(productionUniverse);
  const productionSnapshot = universeRowsToSnapshot(productionUniverse);
  const productionLedger = [
    ...Array.from({ length: 500 }, (_, index) => ledgerRow(index + 1)),
    ...Array.from({ length: 500 }, (_, index) => ledgerRow(index + 1001)),
  ];
  const stagingUniverse = Array.from({ length: 2000 }, (_, index) =>
    universeRow(index + 1)
  );
  const stagingPlayers = universeRowsToPlayers(stagingUniverse);
  const stagingSnapshot = universeRowsToSnapshot(stagingUniverse);
  const stagingLedger = Array.from(
    { length: fullStaging ? 2000 : 1000 },
    (_, index) => ledgerRow(index + 1)
  );
  const stagingSummary = Array.from(
    { length: fullStaging ? 2000 : 1000 },
    (_, index) => summaryRow(index + 1)
  );

  await writeCsv(paths.clean.players, productionPlayers, PLAYER_COLUMNS);
  await writeCsv(paths.clean.snapshot, productionSnapshot, SNAPSHOT_COLUMNS);
  await writeCsv(paths.clean.ledger, productionLedger, LEDGER_COLUMNS);
  await writeJsonAtomic(paths.configState, {
    state: BASE_STATE_LEGACY_500,
    updated_at: "",
  });
  await writeCsv(paths.staging.players, stagingPlayers, PLAYER_COLUMNS);
  await writeCsv(paths.staging.snapshot, stagingSnapshot, SNAPSHOT_COLUMNS);
  await writeCsv(paths.staging.ledger, stagingLedger, LEDGER_COLUMNS);
  await writeCsv(paths.staging.summary, stagingSummary, BREAKDOWN_SUMMARY_COLUMNS);
  await writeCsv(paths.staging.errors, errors, BREAKDOWN_ERROR_COLUMNS);
  await writeJsonAtomic(paths.staging.status, {
    state: BASE_STATE_TOP1000_STAGING,
  });

  return { root, paths, productionPlayers, productionSnapshot, productionLedger };
}

describe("safe Top 1000 base migration", () => {
  test("preparation helpers write staging candidates without modifying production files", async () => {
    const { root, paths } = await makeProject({ fullStaging: false });
    const beforePlayers = await readText(paths.clean.players);
    const beforeSnapshot = await readText(paths.clean.snapshot);
    const beforeLedger = await readText(paths.clean.ledger);
    const stagingPlayers = universeRowsToPlayers(
      Array.from({ length: 2000 }, (_, index) => universeRow(index + 1))
    );
    const stagingIds = new Set(stagingPlayers.map((row) => row.player_id));
    const copiedLedger = copyExistingLedgerForStaging(
      Array.from({ length: 1000 }, (_, index) => ledgerRow(index + 1)),
      stagingIds
    );

    await writeCsvAtomic(paths.staging.ledger, copiedLedger, LEDGER_COLUMNS);
    await writeJsonAtomic(paths.configState, {
      state: BASE_STATE_TOP1000_STAGING,
      updated_at: "2026-06-15T00:00:00.000Z",
    });

    assert.equal(await readText(paths.clean.players), beforePlayers);
    assert.equal(await readText(paths.clean.snapshot), beforeSnapshot);
    assert.equal(await readText(paths.clean.ledger), beforeLedger);
    assert.ok(root);
  });

  test("partial staging cannot be promoted", async () => {
    const { root } = await makeProject({ fullStaging: false });
    await assert.rejects(
      promoteTop1000Base({ cwd: root, confirm: true }),
      /breakdowns faltantes|Staging Top 1000 invalido/
    );
  });

  test("staging with pending errors cannot be promoted", async () => {
    const { root } = await makeProject({
      errors: [
        {
          player_id: "p1501",
          player_name: "Player 1501",
          gender: "F",
          rank: "501",
          ranking_date: "2026-06-15",
          error_message: "blocked",
          updated_at: "2026-06-15T00:00:00.000Z",
        },
      ],
    });
    await validateAndWriteTop1000Report(root);
    await assert.rejects(
      promoteTop1000Base({ cwd: root, confirm: true }),
      /erros de breakdown pendentes|Staging Top 1000 invalido/
    );
  });

  test("promotion without confirm=true does not modify production files", async () => {
    const { root, paths } = await makeProject();
    await validateAndWriteTop1000Report(root);
    const beforePlayers = await readText(paths.clean.players);
    const result = await promoteTop1000Base({ cwd: root, confirm: false });

    assert.equal(result.would_promote, true);
    assert.equal(await readText(paths.clean.players), beforePlayers);
  });

  test("valid promotion replaces the three production files and activates Top 1000", async () => {
    const { root, paths } = await makeProject();
    await validateAndWriteTop1000Report(root);
    const result = await promoteTop1000Base({
      cwd: root,
      confirm: true,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });
    const promotedPlayers = (await readCsvRows(paths.clean.players)).length;
    const state = JSON.parse(await readText(paths.configState));

    assert.equal(result.promoted, true);
    assert.equal(promotedPlayers, 2000);
    assert.equal(state.state, BASE_STATE_TOP1000_ACTIVE);
  });

  test("failure during promotion restores the three previous production files", async () => {
    const { root, paths } = await makeProject();
    await validateAndWriteTop1000Report(root);
    const beforePlayers = await readText(paths.clean.players);
    const beforeSnapshot = await readText(paths.clean.snapshot);
    const beforeLedger = await readText(paths.clean.ledger);

    await assert.rejects(
      promoteTop1000Base({ cwd: root, confirm: true, failAfterFirstCopy: true }),
      /Falha simulada/
    );

    assert.equal(await readText(paths.clean.players), beforePlayers);
    assert.equal(await readText(paths.clean.snapshot), beforeSnapshot);
    assert.equal(await readText(paths.clean.ledger), beforeLedger);
  });

  test("legacy base remains valid while migration is pending and Top 1000 is required after activation", async () => {
    const { root, paths } = await makeProject();
    const previousCwd = process.cwd();
    const legacyPlayers = universeRowsToPlayers(legacyUniverseRows());
    const top1000Players = universeRowsToPlayers(
      Array.from({ length: 2000 }, (_, index) => universeRow(index + 1))
    );

    try {
      process.chdir(root);
      await writeJsonAtomic(paths.configState, { state: BASE_STATE_LEGACY_500 });
      assert.equal(validatePlayersBase(legacyPlayers).isValid, true);
      await writeJsonAtomic(paths.configState, { state: BASE_STATE_TOP1000_ACTIVE });
      assert.equal(validatePlayersBase(legacyPlayers).isValid, false);
      assert.equal(validatePlayersBase(top1000Players).isValid, true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("validation report detects complete and incomplete staging", async () => {
    const complete = await makeProject();
    const incomplete = await makeProject({ fullStaging: false });

    assert.equal(validateTop1000Rows(await importStaging(complete.root)).valid, true);
    assert.equal(validateTop1000Rows(await importStaging(incomplete.root)).valid, false);
  });
});

async function importStaging(root) {
  const paths = resolveTop1000Paths(root);
  const { readCsv } = await import("../scripts/lib/top1000_migration.mjs");
  return {
    playersRows: await readCsv(paths.staging.players),
    snapshotRows: await readCsv(paths.staging.snapshot),
    ledgerRows: await readCsv(paths.staging.ledger),
    summaryRows: await readCsv(paths.staging.summary),
    errorRows: await readCsv(paths.staging.errors),
  };
}
