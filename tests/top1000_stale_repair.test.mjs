import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRepairPlan,
  canonicalCsvHash,
  loadRepairManifest,
  runTop1000StaleRepair,
  sha256Text,
} from "../scripts/lib/top1000_stale_repair.mjs";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  PLAYER_COLUMNS,
  SNAPSHOT_COLUMNS,
  readCsv,
  writeCsvAtomic,
  writeJsonAtomic,
} from "../scripts/lib/top1000_migration.mjs";
import { extractLedgerRowsFromRankingPoints } from "../scripts/lib/player_breakdown.mjs";

const RANKING_DATE = "2026-06-15";
const TARGET_COUNT = 63;

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "top1000-stale-repair-"));
}

function playerRow(index) {
  const gender = index <= 1000 ? "M" : "F";
  const rank = index <= 1000 ? index : index - 1000;
  const playerId = `p${String(index).padStart(4, "0")}`;
  return {
    player_id: playerId,
    player_name: `Player ${index}`,
    first_name: "Player",
    last_name: String(index),
    gender,
    itf_gender_code: gender === "M" ? "B" : "G",
    country: "BRA",
    country_name: "Brazil",
    birth_date: "",
    birth_year: "2009",
    junior_last_year: "",
    active_junior: "",
    profile_url: "",
    current_rank: String(rank),
    current_points: index <= TARGET_COUNT ? "10" : "5",
    first_seen_date: RANKING_DATE,
    last_seen_date: RANKING_DATE,
    raw_json: "",
  };
}

function snapshotRow(player) {
  return {
    ranking_date: RANKING_DATE,
    gender: player.gender,
    rank: player.current_rank,
    player_id: player.player_id,
    player_name: player.player_name,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    official_points: player.current_points,
    source_url: "fixture",
    collected_at: "2026-06-18T00:00:00.000Z",
  };
}

function ledgerRow(player, points, suffix = "") {
  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,
    event_type: "singles",
    countable_status: "countable",
    tournament_name: `Tournament ${player.player_id}${suffix}`,
    category: "J100",
    draw_type: "Main Draw",
    host_nation: "Brazil",
    host_nation_code: "BRA",
    surface: "Hard",
    surface_code: "H",
    start_date: "2026-05-01",
    drop_date_calculated: "2027-04-30",
    round: "Winner",
    points: String(points),
    tournament_link: "https://example.test",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_from_fixture",
    source_url: "fixture",
    collected_at: "2026-06-18T00:00:00.000Z",
    raw_json: "{}",
  };
}

function rankingPointsJson(player, points) {
  return {
    countable: [
      {
        title: "Singles",
        countablePoints: {
          totalPoints: points,
          pointsBreakdown: [
            {
              tournamentName: `Tournament ${player.player_id}-fresh`,
              category: "J100",
              drawType: "Main Draw",
              hostNation: "Brazil",
              hostNationCode: "BRA",
              surfaceDesc: "Hard",
              surfaceCode: "H",
              startDate: "2026-05-01",
              round: "Winner",
              points,
              tournamentLink: "https://example.test",
            },
          ],
        },
        nonCountablePoints: { totalPoints: 0, pointsBreakdown: [] },
      },
      {
        title: "Doubles",
        countablePoints: { totalPoints: 0, pointsBreakdown: [] },
        nonCountablePoints: { totalPoints: 0, pointsBreakdown: [] },
      },
    ],
  };
}

async function writeFixture(overrides = {}) {
  const cwd = await makeTempDir();
  const stagingDir = path.join(cwd, "data", "staging", "top1000_base");
  const logsDir = path.join(cwd, "logs");
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const players = Array.from({ length: 2000 }, (_, index) => playerRow(index + 1));
  if (overrides.rankAbove500) {
    players[0].current_rank = "501";
  }
  const snapshot = players.map(snapshotRow);
  const ledger = players.map((player, index) =>
    ledgerRow(player, index < TARGET_COUNT ? 11 : 5)
  );
  const summary = players.map((player) => ({
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    rank: player.current_rank,
    ranking_date: RANKING_DATE,
    status: "fetched",
    ledger_rows: "1",
    updated_at: "2026-06-18T00:00:00.000Z",
  }));

  await writeCsvAtomic(path.join(stagingDir, "players.csv"), players, PLAYER_COLUMNS);
  await writeCsvAtomic(path.join(stagingDir, "rankings_snapshot.csv"), snapshot, SNAPSHOT_COLUMNS);
  await writeCsvAtomic(path.join(stagingDir, "points_ledger.csv"), ledger, LEDGER_COLUMNS);
  await writeCsvAtomic(
    path.join(stagingDir, "breakdown_summary.csv"),
    summary,
    BREAKDOWN_SUMMARY_COLUMNS
  );
  await writeCsvAtomic(path.join(stagingDir, "breakdown_errors.csv"), [], BREAKDOWN_ERROR_COLUMNS);
  await writeJsonAtomic(path.join(stagingDir, "migration_status.json"), { state: "TOP1000_STAGING" });
  await writeJsonAtomic(path.join(stagingDir, "validation_report.json"), { valid: false });

  const manifestPlayers = [];
  const replacementRows = new Map();
  for (let index = 0; index < TARGET_COUNT; index += 1) {
    const player = players[index];
    const points = overrides.freshTotalMismatch && index === 0 ? 9 : 10;
    const validPayload = {
      player,
      requested_at: "2026-06-18T00:00:00.000Z",
      source_url: `https://example.test/${player.player_id}`,
      json: rankingPointsJson(player, points),
    };
    const payload =
      overrides.invalidJson && index === 0
        ? { blocked: "<html>Incapsula</html>" }
        : validPayload;
    const jsonPath = path.join(logsDir, `fresh_${player.player_id}.json`);
    await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    const freshHash = sha256Text(await fs.readFile(jsonPath, "utf8"));
    const freshRows = extractLedgerRowsFromRankingPoints(
      validPayload.json,
      player,
      validPayload.source_url,
      {
        status: "confirmed_from_top1000_stale_repair",
      }
    ).map((row) => ({ ...row, collected_at: validPayload.requested_at }));
    replacementRows.set(player.player_id, freshRows);
    manifestPlayers.push({
      player_id: overrides.outsideStaging && index === 0 ? "missing-player" : player.player_id,
      player_name: player.player_name,
      gender: player.gender,
      rank: Number(player.current_rank),
      official_points: 10,
      old_calculated_points: 11,
      fresh_calculated_points: 10,
      old_ledger_rows: 1,
      fresh_ledger_rows: 1,
      fresh_json_path: path.relative(cwd, overrides.missingJson && index === 0 ? `${jsonPath}.missing` : jsonPath).replace(/\\/g, "/"),
      fresh_json_sha256: overrides.hashMismatch && index === 0 ? "bad" : freshHash,
      source_url: `https://example.test/${player.player_id}`,
      classification: "STALE_REUSED_LEDGER",
      exact_match: true,
    });
  }

  const writtenLedger = await readCsv(path.join(stagingDir, "points_ledger.csv"));
  let candidateLedger = [];
  const targetIds = new Set(manifestPlayers.map((entry) => entry.player_id));
  const inserted = new Set();
  for (const row of writtenLedger) {
    if (!targetIds.has(row.player_id)) {
      candidateLedger.push(row);
    } else if (!inserted.has(row.player_id)) {
      candidateLedger.push(...replacementRows.get(row.player_id));
      inserted.add(row.player_id);
    }
  }
  const sourceHash = canonicalCsvHash(writtenLedger, LEDGER_COLUMNS);
  const candidateHash = canonicalCsvHash(candidateLedger, LEDGER_COLUMNS);
  const manifest = {
    schema_version: 1,
    operation: "repair_top1000_stale_ledgers",
    ranking_date: overrides.badRankingDate ? "2026-06-08" : RANKING_DATE,
    baseline_policy: "as_collected",
    expected_repair_count: TARGET_COUNT,
    expected_total_players: 2000,
    expected_preserved_players: 1937,
    expected_source_ledger_rows: 2000,
    expected_candidate_ledger_rows: 2000,
    expected_source_ledger_sha256: overrides.sourceHashMismatch ? "bad" : sourceHash,
    expected_candidate_reconciliation_exact: 2000,
    expected_candidate_reconciliation_total: 2000,
    expected_candidate_ledger_sha256: overrides.candidateHashMismatch ? "bad" : candidateHash,
    players: overrides.wrongCount
      ? manifestPlayers.slice(0, 62)
      : overrides.duplicateId
        ? [{ ...manifestPlayers[0] }, ...manifestPlayers.slice(0, 62)]
        : manifestPlayers,
  };
  const manifestPath = path.join(logsDir, "manifest.json");
  await writeJsonAtomic(manifestPath, manifest);
  return { cwd, manifestPath, players, ledger, summary };
}

test("valid manifest builds a full repair plan", async () => {
  const fixture = await writeFixture();
  const plan = await buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath });
  assert.equal(plan.targetIds.size, 63);
  assert.equal(plan.preservedCount, 1937);
  assert.equal(plan.afterComparison.exact, 2000);
  assert.equal(plan.afterComparison.total, 2000);
});

test("rejects invalid manifest counts", async () => {
  const fixture = await writeFixture({ wrongCount: true });
  await assert.rejects(
    () => loadRepairManifest(fixture.manifestPath, fixture.cwd),
    /exatamente 63/
  );
});

test("rejects duplicate player ids", async () => {
  const fixture = await writeFixture({ duplicateId: true });
  await assert.rejects(
    () => loadRepairManifest(fixture.manifestPath, fixture.cwd),
    /duplicado/
  );
});

test("rejects player outside staging", async () => {
  const fixture = await writeFixture({ outsideStaging: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /fora do staging/);
});

test("rejects target players above rank 500", async () => {
  const fixture = await writeFixture({ rankAbove500: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /Top 500/);
});

test("rejects different ranking date", async () => {
  const fixture = await writeFixture({ badRankingDate: true });
  await assert.rejects(() => loadRepairManifest(fixture.manifestPath, fixture.cwd), /ranking_date/);
});

test("rejects source ledger hash mismatch", async () => {
  const fixture = await writeFixture({ sourceHashMismatch: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /origem/);
});

test("rejects missing fresh JSON", async () => {
  const fixture = await writeFixture({ missingJson: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /ENOENT/);
});

test("rejects fresh JSON hash mismatch", async () => {
  const fixture = await writeFixture({ hashMismatch: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /Hash do JSON/);
});

test("rejects invalid JSON payload", async () => {
  const fixture = await writeFixture({ invalidJson: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /Payload JSON invalido|HTML/);
});

test("rejects fresh total different from official", async () => {
  const fixture = await writeFixture({ freshTotalMismatch: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /Total fresco/);
});

test("dry-run writes only a report and does not modify staging files", async () => {
  const fixture = await writeFixture();
  const ledgerPath = path.join(fixture.cwd, "data", "staging", "top1000_base", "points_ledger.csv");
  const before = await fs.readFile(ledgerPath, "utf8");
  const result = await runTop1000StaleRepair({
    cwd: fixture.cwd,
    manifestPath: fixture.manifestPath,
  });
  const after = await fs.readFile(ledgerPath, "utf8");
  assert.equal(before, after);
  assert.equal(result.report.mode, "dry-run");
  assert.match(result.report.report_path, /logs\/top1000_stale_repair_dry_run_/);
});

test("only authorized ids are replaced and preserved rows keep relative order", async () => {
  const fixture = await writeFixture();
  const plan = await buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath });
  assert.equal(Number(plan.candidateRows[0].points), 10);
  assert.equal(plan.candidateRows[63].player_id, "p0064");
  assert.equal(plan.candidateRows[63].points, "5");
  assert.equal(plan.candidateRows[1999].player_id, "p2000");
  assert.equal(plan.preservedCount, 1937);
});

test("breakdown_summary updates only repaired players", async () => {
  const fixture = await writeFixture();
  const plan = await buildRepairPlan({
    cwd: fixture.cwd,
    manifestPath: fixture.manifestPath,
    now: new Date("2026-06-18T12:00:00.000Z"),
  });
  assert.equal(plan.summaryRows[0].ledger_rows, "1");
  assert.equal(plan.summaryRows[0].updated_at, "2026-06-18T12:00:00.000Z");
  assert.equal(plan.summaryRows[63].updated_at, "2026-06-18T00:00:00.000Z");
});

test("rejects candidate hash mismatch", async () => {
  const fixture = await writeFixture({ candidateHashMismatch: true });
  await assert.rejects(() => buildRepairPlan({ cwd: fixture.cwd, manifestPath: fixture.manifestPath }), /candidato/);
});

test("apply writes atomically, validates, and creates backup", async () => {
  const fixture = await writeFixture();
  const result = await runTop1000StaleRepair({
    cwd: fixture.cwd,
    manifestPath: fixture.manifestPath,
    confirm: true,
    now: new Date("2026-06-18T12:00:00.000Z"),
  });
  assert.equal(result.report.post_write_validation.valid, true);
  assert.equal(result.report.post_write_validation.reconciliation_exact, 2000);
  assert.match(result.report.backup_path, /stale_repair_63_/);
  await fs.access(path.join(fixture.cwd, result.report.backup_path, "points_ledger.csv"));
});

test("rollback restores staging after simulated cache failure", async () => {
  const fixture = await writeFixture();
  const ledgerPath = path.join(fixture.cwd, "data", "staging", "top1000_base", "points_ledger.csv");
  const before = await fs.readFile(ledgerPath, "utf8");
  await assert.rejects(
    () =>
      runTop1000StaleRepair({
        cwd: fixture.cwd,
        manifestPath: fixture.manifestPath,
        confirm: true,
        failAfterCacheWrite: true,
      }),
    /Falha simulada/
  );
  const after = await fs.readFile(ledgerPath, "utf8");
  assert.equal(after, before);
});

test("canonical caches are compatible with readCachedBreakdown format", async () => {
  const fixture = await writeFixture();
  const result = await runTop1000StaleRepair({
    cwd: fixture.cwd,
    manifestPath: fixture.manifestPath,
    confirm: true,
  });
  const written = result.report.cache_files_written.filter((item) => item.action === "written");
  assert.ok(written.length > 0);
  const payload = JSON.parse(await fs.readFile(path.join(fixture.cwd, written[0].path), "utf8"));
  assert.ok(payload.player);
  assert.ok(payload.source_url);
  assert.ok(payload.json);
});

test("does not allow a manifest path inside data/clean", async () => {
  const fixture = await writeFixture();
  const cleanManifest = path.join(fixture.cwd, "data", "clean", "manifest.json");
  await fs.mkdir(path.dirname(cleanManifest), { recursive: true });
  await fs.copyFile(fixture.manifestPath, cleanManifest);
  await assert.rejects(() => loadRepairManifest(cleanManifest, fixture.cwd), /data\/clean/);
});

test("BASELINE_POLICY remains the effective policy", async () => {
  const fixture = await writeFixture();
  const result = await runTop1000StaleRepair({
    cwd: fixture.cwd,
    manifestPath: fixture.manifestPath,
  });
  assert.equal(result.plan.manifestInfo.manifest.baseline_policy, "as_collected");
  assert.equal(result.report.reconciliation_after, 2000);
});
