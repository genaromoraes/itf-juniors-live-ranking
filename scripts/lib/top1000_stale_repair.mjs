import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { stringify } from "csv-stringify/sync";
import {
  BASELINE_POLICY,
  calculateLedgerPoints,
  compareCalculatedAgainstSnapshot,
  validateLedgerRows,
} from "./official_ledger_validation.mjs";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  loadStaging,
  readCsv,
  readJson,
  resolveTop1000Paths,
  sha256File,
  summarizeStaging,
  validateTop1000Rows,
  writeCsvAtomic,
  writeJsonAtomic,
} from "./top1000_migration.mjs";
import {
  cleanText,
  extractLedgerRowsFromRankingPoints,
  getRawBreakdownPath,
  toNumber,
} from "./player_breakdown.mjs";

export const REPAIR_OPERATION = "repair_top1000_stale_ledgers";
export const REPAIR_SCHEMA_VERSION = 1;
export const EXPECTED_REPAIR_COUNT = 63;
export const EXPECTED_RANKING_DATE = "2026-06-15";
export const EXPECTED_TOTAL_PLAYERS = 2000;

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function isInsideDir(filePath, dirPath) {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertNoDataCleanPath(filePath, cwd = process.cwd()) {
  const cleanDir = path.resolve(cwd, "data", "clean");
  if (isInsideDir(filePath, cleanDir)) {
    throw new Error(`Caminho dentro de data/clean nao permitido: ${filePath}`);
  }
}

export function canonicalCsv(rows, columns) {
  return stringify(rows, { header: true, columns });
}

export function canonicalCsvHash(rows, columns) {
  return sha256Text(canonicalCsv(rows, columns));
}

function rowsHash(rows, columns = LEDGER_COLUMNS) {
  return sha256Text(stringify(rows, { header: false, columns }));
}

function groupRowsByPlayer(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const playerId = cleanText(row.player_id);
    if (!playerId) continue;
    if (!grouped.has(playerId)) grouped.set(playerId, []);
    grouped.get(playerId).push(row);
  }
  return grouped;
}

function buildMap(rows, key) {
  return new Map(rows.map((row) => [cleanText(row[key]), row]).filter(([value]) => value));
}

function numberEqual(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;
}

function normalizeRelativePath(filePath, cwd = process.cwd()) {
  return path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, "/");
}

function validateManifestShape(manifest) {
  if (manifest?.schema_version !== REPAIR_SCHEMA_VERSION) {
    throw new Error("Manifesto com schema_version invalido.");
  }
  if (manifest?.operation !== REPAIR_OPERATION) {
    throw new Error("Manifesto com operation invalida.");
  }
  if (manifest?.ranking_date !== EXPECTED_RANKING_DATE) {
    throw new Error(`Manifesto com ranking_date diferente de ${EXPECTED_RANKING_DATE}.`);
  }
  if (manifest?.baseline_policy !== BASELINE_POLICY) {
    throw new Error(`Manifesto precisa usar BASELINE_POLICY=${BASELINE_POLICY}.`);
  }
  if (manifest?.expected_repair_count !== EXPECTED_REPAIR_COUNT) {
    throw new Error(`Manifesto precisa declarar ${EXPECTED_REPAIR_COUNT} reparos.`);
  }
  if (!Array.isArray(manifest?.players) || manifest.players.length !== EXPECTED_REPAIR_COUNT) {
    throw new Error(`Manifesto precisa conter exatamente ${EXPECTED_REPAIR_COUNT} jogadores.`);
  }
  const ids = manifest.players.map((entry) => cleanText(entry.player_id));
  if (new Set(ids).size !== ids.length) {
    throw new Error("Manifesto contem player_id duplicado.");
  }
}

export async function loadRepairManifest(manifestPath, cwd = process.cwd()) {
  const resolved = path.resolve(cwd, manifestPath);
  assertNoDataCleanPath(resolved, cwd);
  const manifest = await readJson(resolved);
  validateManifestShape(manifest);
  return {
    path: resolved,
    relativePath: normalizeRelativePath(resolved, cwd),
    sha256: await sha256File(resolved),
    manifest,
  };
}

async function loadFreshPayload({ entry, cwd }) {
  const jsonPath = path.resolve(cwd, entry.fresh_json_path);
  assertNoDataCleanPath(jsonPath, cwd);
  if (!isInsideDir(jsonPath, path.resolve(cwd, "logs"))) {
    throw new Error(`JSON fresco fora de logs/: ${entry.fresh_json_path}`);
  }
  const fileName = path.basename(jsonPath);
  if (!fileName.includes(cleanText(entry.player_id))) {
    throw new Error(`Nome do JSON nao contem player_id ${entry.player_id}: ${entry.fresh_json_path}`);
  }
  const hash = await sha256File(jsonPath);
  if (hash !== cleanText(entry.fresh_json_sha256).toLowerCase()) {
    throw new Error(`Hash do JSON fresco divergente para ${entry.player_id}.`);
  }
  const wrapper = await readJson(jsonPath);
  if (!wrapper?.json || typeof wrapper.json !== "object") {
    throw new Error(`Payload JSON invalido para ${entry.player_id}.`);
  }
  const serialized = JSON.stringify(wrapper.json).toLowerCase();
  if (
    serialized.includes("<html") ||
    serialized.includes("incapsula") ||
    serialized.includes("imperva") ||
    serialized.includes("_incapsula_resource")
  ) {
    throw new Error(`Payload JSON contem HTML/bloqueio para ${entry.player_id}.`);
  }
  return {
    jsonPath,
    hash,
    wrapper,
    sourceUrl: cleanText(wrapper.source_url || entry.source_url),
  };
}

function validateExtractedRows(rows, entry, player) {
  if (rows.length < 1) {
    throw new Error(`Nenhuma linha extraida para ${entry.player_id}.`);
  }
  if (rows.length !== Number(entry.fresh_ledger_rows)) {
    throw new Error(`Quantidade fresca divergente para ${entry.player_id}.`);
  }
  for (const row of rows) {
    if (cleanText(row.player_id) !== cleanText(entry.player_id)) {
      throw new Error(`Linha extraida com player_id inesperado para ${entry.player_id}.`);
    }
    if (cleanText(row.gender) !== cleanText(player.gender)) {
      throw new Error(`Linha extraida com genero inesperado para ${entry.player_id}.`);
    }
  }
  const calculated = calculateLedgerPoints(rows, { policy: BASELINE_POLICY })[0];
  if (!numberEqual(calculated?.calculated_total, entry.official_points)) {
    throw new Error(`Total fresco diferente do oficial para ${entry.player_id}.`);
  }
  if (!numberEqual(calculated?.calculated_total, entry.fresh_calculated_points)) {
    throw new Error(`Total fresco diferente do manifesto para ${entry.player_id}.`);
  }
}

function stampFreshRows(rows, freshPayload, entry) {
  const collectedAt =
    cleanText(freshPayload.wrapper.requested_at) ||
    cleanText(freshPayload.wrapper.collected_at) ||
    cleanText(entry.collected_at);
  if (!collectedAt) {
    throw new Error(`Payload fresco sem requested_at/collected_at para ${entry.player_id}.`);
  }
  return rows.map((row) => ({
    ...row,
    collected_at: collectedAt,
  }));
}

function validateCandidateRows(candidateRows, playerIds) {
  const validation = validateLedgerRows(candidateRows);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }
  const fullRows = new Set();
  for (const row of candidateRows) {
    const key = JSON.stringify(LEDGER_COLUMNS.map((column) => cleanText(row[column])));
    if (fullRows.has(key)) {
      throw new Error(`Linha integralmente duplicada para ${cleanText(row.player_id)}.`);
    }
    fullRows.add(key);
    if (!playerIds.has(cleanText(row.player_id))) {
      throw new Error(`Ledger candidato contem jogador fora do staging: ${cleanText(row.player_id)}`);
    }
  }
}

function buildCandidateLedger({ sourceRows, replacementRowsById, targetIds }) {
  const inserted = new Set();
  const candidateRows = [];

  for (const row of sourceRows) {
    const playerId = cleanText(row.player_id);
    if (!targetIds.has(playerId)) {
      candidateRows.push(row);
      continue;
    }
    if (!inserted.has(playerId)) {
      candidateRows.push(...replacementRowsById.get(playerId));
      inserted.add(playerId);
    }
  }

  const missingOldRows = [...targetIds].filter((playerId) => !inserted.has(playerId));
  if (missingOldRows.length) {
    throw new Error(`Jogador alvo sem linha antiga no ledger: ${missingOldRows.join(", ")}`);
  }
  return candidateRows;
}

function assertPreservedRowsUnchanged(sourceRows, candidateRows, targetIds) {
  const before = groupRowsByPlayer(sourceRows);
  const after = groupRowsByPlayer(candidateRows);
  const preservedHashes = {};
  let preserved = 0;

  for (const [playerId, rows] of before) {
    if (targetIds.has(playerId)) continue;
    const beforeHash = rowsHash(rows);
    const afterHash = rowsHash(after.get(playerId) || []);
    if (beforeHash !== afterHash) {
      throw new Error(`Jogador preservado foi alterado: ${playerId}`);
    }
    preservedHashes[playerId] = beforeHash;
    preserved += 1;
  }

  return { preserved, preservedHashes };
}

function updateBreakdownSummary({ summaryRows, manifestPlayers, nowIso }) {
  const entriesById = new Map(manifestPlayers.map((entry) => [cleanText(entry.player_id), entry]));
  const seen = new Set();

  const candidateRows = summaryRows.map((row) => {
    const playerId = cleanText(row.player_id);
    const entry = entriesById.get(playerId);
    if (!entry) return row;
    seen.add(playerId);
    return {
      ...row,
      player_name: cleanText(row.player_name) || cleanText(entry.player_name),
      gender: cleanText(row.gender) || cleanText(entry.gender),
      rank: cleanText(row.rank) || String(entry.rank),
      ranking_date: EXPECTED_RANKING_DATE,
      status: "fetched",
      ledger_rows: String(entry.fresh_ledger_rows),
      updated_at: nowIso,
    };
  });

  const missing = [...entriesById.keys()].filter((playerId) => !seen.has(playerId));
  if (missing.length) {
    throw new Error(`breakdown_summary sem jogadores reparados: ${missing.join(", ")}`);
  }

  if (new Set(candidateRows.map((row) => cleanText(row.player_id))).size !== EXPECTED_TOTAL_PLAYERS) {
    throw new Error("breakdown_summary candidato nao contem 2000 player_id unicos.");
  }

  return candidateRows;
}

function buildRepairReport({ mode, manifestInfo, sourceHash, candidateHash, plan, backupPath = "" }) {
  return {
    mode,
    manifest_path: manifestInfo.relativePath,
    manifest_sha256: manifestInfo.sha256,
    source_ledger_sha256: sourceHash,
    candidate_ledger_sha256: candidateHash,
    source_ledger_rows: plan.sourceRows.length,
    candidate_ledger_rows: plan.candidateRows.length,
    repaired_players: plan.targetIds.size,
    preserved_players: plan.preservedCount,
    reconciliation_before: plan.beforeComparison.exact,
    reconciliation_before_total: plan.beforeComparison.total,
    reconciliation_after: plan.afterComparison.exact,
    reconciliation_after_total: plan.afterComparison.total,
    divergences_before: plan.beforeComparison.total - plan.beforeComparison.exact,
    divergences_after: plan.afterComparison.total - plan.afterComparison.exact,
    player_rows: plan.playerReports,
    preserved_player_hashes: plan.preservedHashes,
    backup_path: backupPath,
    cache_files_written: [],
    rollback_performed: false,
    generated_at: new Date().toISOString(),
  };
}

async function writeRunReport(report, cwd = process.cwd()) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fileName =
    report.mode === "apply"
      ? `top1000_stale_repair_apply_${timestamp}.json`
      : `top1000_stale_repair_dry_run_${timestamp}.json`;
  const reportPath = path.join(cwd, "logs", fileName);
  await writeJsonAtomic(reportPath, report);
  return reportPath;
}

export async function buildRepairPlan({ manifestPath, cwd = process.cwd(), now = new Date() }) {
  const manifestInfo = await loadRepairManifest(manifestPath, cwd);
  const loaded = await loadStaging(cwd);
  const manifest = manifestInfo.manifest;
  const sourceHash = await sha256File(loaded.paths.staging.ledger);

  if (sourceHash !== cleanText(manifest.expected_source_ledger_sha256).toLowerCase()) {
    throw new Error("Hash do ledger de origem diverge do manifesto.");
  }

  if (loaded.playersRows.length !== manifest.expected_total_players) {
    throw new Error("Staging possui quantidade inesperada de jogadores.");
  }
  if (loaded.errorRows.length !== 0) {
    throw new Error("breakdown_errors.csv nao esta vazio.");
  }

  const playersById = buildMap(loaded.playersRows, "player_id");
  const snapshotById = buildMap(loaded.snapshotRows, "player_id");
  const sourceRowsById = groupRowsByPlayer(loaded.ledgerRows);
  const targetIds = new Set();
  const replacementRowsById = new Map();
  const playerReports = [];

  for (const entry of manifest.players) {
    const playerId = cleanText(entry.player_id);
    targetIds.add(playerId);
    const player = playersById.get(playerId);
    const snapshot = snapshotById.get(playerId);
    if (!player || !snapshot) {
      throw new Error(`Jogador fora do staging: ${playerId}`);
    }
    const rank = Number(player.current_rank || snapshot.rank || entry.rank);
    if (rank < 1 || rank > 500) {
      throw new Error(`Jogador fora do Top 500: ${playerId}`);
    }
    if (
      cleanText(player.player_name) !== cleanText(entry.player_name) ||
      cleanText(player.gender) !== cleanText(entry.gender) ||
      Number(player.current_rank || snapshot.rank) !== Number(entry.rank)
    ) {
      throw new Error(`Metadados do staging divergem do manifesto para ${playerId}.`);
    }
    if (cleanText(snapshot.ranking_date) !== EXPECTED_RANKING_DATE) {
      throw new Error(`ranking_date do snapshot diverge para ${playerId}.`);
    }
    if (!numberEqual(snapshot.official_points, entry.official_points)) {
      throw new Error(`Pontos oficiais divergem para ${playerId}.`);
    }
    const oldRows = sourceRowsById.get(playerId) || [];
    if (oldRows.length !== Number(entry.old_ledger_rows)) {
      throw new Error(`Quantidade antiga divergente para ${playerId}.`);
    }
    const freshPayload = await loadFreshPayload({ entry, cwd });
    const freshRows = stampFreshRows(
      extractLedgerRowsFromRankingPoints(
        freshPayload.wrapper.json,
        player,
        freshPayload.sourceUrl,
        { status: "confirmed_from_top1000_stale_repair" }
      ),
      freshPayload,
      entry
    );
    validateExtractedRows(freshRows, entry, player);
    replacementRowsById.set(playerId, freshRows);
    playerReports.push({
      player_id: playerId,
      player_name: cleanText(entry.player_name),
      rank: Number(entry.rank),
      old_ledger_rows: oldRows.length,
      fresh_ledger_rows: freshRows.length,
      old_calculated_points: Number(entry.old_calculated_points),
      fresh_calculated_points: Number(entry.fresh_calculated_points),
      official_points: Number(entry.official_points),
      fresh_json_path: cleanText(entry.fresh_json_path),
    });
  }

  const candidateRows = buildCandidateLedger({
    sourceRows: loaded.ledgerRows,
    replacementRowsById,
    targetIds,
  });
  const candidateHash = canonicalCsvHash(candidateRows, LEDGER_COLUMNS);
  if (candidateHash !== cleanText(manifest.expected_candidate_ledger_sha256).toLowerCase()) {
    throw new Error("Hash do ledger candidato diverge do manifesto.");
  }
  if (candidateRows.length !== Number(manifest.expected_candidate_ledger_rows)) {
    throw new Error("Quantidade de linhas do ledger candidato diverge do manifesto.");
  }

  const playerIds = new Set(loaded.playersRows.map((row) => cleanText(row.player_id)));
  validateCandidateRows(candidateRows, playerIds);
  const { preserved, preservedHashes } = assertPreservedRowsUnchanged(
    loaded.ledgerRows,
    candidateRows,
    targetIds
  );
  if (preserved !== Number(manifest.expected_preserved_players)) {
    throw new Error("Quantidade de jogadores preservados diverge do manifesto.");
  }

  const beforeCalculated = calculateLedgerPoints(loaded.ledgerRows, { policy: BASELINE_POLICY });
  const beforeComparison = compareCalculatedAgainstSnapshot(beforeCalculated, loaded.snapshotRows, {
    baselinePolicy: BASELINE_POLICY,
  });
  const afterCalculated = calculateLedgerPoints(candidateRows, { policy: BASELINE_POLICY });
  const afterComparison = compareCalculatedAgainstSnapshot(afterCalculated, loaded.snapshotRows, {
    baselinePolicy: BASELINE_POLICY,
  });
  if (
    afterComparison.exact !== Number(manifest.expected_candidate_reconciliation_exact) ||
    afterComparison.total !== Number(manifest.expected_candidate_reconciliation_total) ||
    !afterComparison.valid
  ) {
    throw new Error("Ledger candidato nao alcancou reconciliacao total.");
  }

  const summaryRows = updateBreakdownSummary({
    summaryRows: loaded.summaryRows,
    manifestPlayers: manifest.players,
    nowIso: now.toISOString(),
  });

  return {
    manifestInfo,
    loaded,
    sourceHash,
    candidateHash,
    sourceRows: loaded.ledgerRows,
    candidateRows,
    summaryRows,
    targetIds,
    replacementRowsById,
    beforeComparison,
    afterComparison,
    preservedCount: preserved,
    preservedHashes,
    playerReports,
  };
}

async function copyIfExists(source, destination) {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

async function createBackup({ plan, timestamp, cwd }) {
  const backupPath = path.join(
    plan.loaded.paths.stagingDir,
    "backups",
    `stale_repair_63_${timestamp}`
  );
  await fs.mkdir(backupPath, { recursive: true });

  const copied = {};
  for (const [key, source] of Object.entries(plan.loaded.paths.staging)) {
    copied[key] = await copyIfExists(source, path.join(backupPath, path.basename(source)));
  }
  await fs.copyFile(plan.manifestInfo.path, path.join(backupPath, path.basename(plan.manifestInfo.path)));

  const rawDir = path.join(cwd, "data", "raw", "breakdowns");
  const existingCaches = [];
  const missingCaches = [];
  for (const entry of plan.manifestInfo.manifest.players) {
    const player = plan.loaded.playersRows.find(
      (row) => cleanText(row.player_id) === cleanText(entry.player_id)
    );
    const canonicalPath = getRawBreakdownPath({
      rawDir,
      rankingDate: EXPECTED_RANKING_DATE,
      player,
    });
    const destination = path.join(backupPath, "raw_breakdowns", path.basename(canonicalPath));
    if (await copyIfExists(canonicalPath, destination)) {
      existingCaches.push({
        path: normalizeRelativePath(canonicalPath, cwd),
        backup_path: normalizeRelativePath(destination, cwd),
        sha256: await sha256File(destination),
      });
    } else {
      missingCaches.push(normalizeRelativePath(canonicalPath, cwd));
    }
  }

  const backupManifest = {
    timestamp,
    operation: REPAIR_OPERATION,
    source_ledger_sha256: plan.sourceHash,
    candidate_ledger_sha256: plan.candidateHash,
    source_ledger_rows: plan.sourceRows.length,
    candidate_ledger_rows: plan.candidateRows.length,
    repaired_player_ids: [...plan.targetIds],
    copied_staging_files: copied,
    existing_cache_files: existingCaches,
    missing_cache_files: missingCaches,
    rollback_instructions:
      "Restore staging CSV/JSON files from this backup and restore existing cache files; remove cache files listed as previously missing.",
  };
  await writeJsonAtomic(path.join(backupPath, "backup_manifest.json"), backupManifest);
  return { backupPath, backupManifest };
}

async function writeCacheFiles({ plan, cwd, backupManifest, failAfterCacheWrite = false }) {
  const rawDir = path.join(cwd, "data", "raw", "breakdowns");
  const written = [];
  const playersById = buildMap(plan.loaded.playersRows, "player_id");

  for (const entry of plan.manifestInfo.manifest.players) {
    const player = playersById.get(cleanText(entry.player_id));
    const freshPayload = await loadFreshPayload({ entry, cwd });
    const canonicalPath = getRawBreakdownPath({
      rawDir,
      rankingDate: EXPECTED_RANKING_DATE,
      player,
    });
    assertNoDataCleanPath(canonicalPath, cwd);
    const payload = `${JSON.stringify(
      {
        player,
        source_url: freshPayload.sourceUrl,
        json: freshPayload.wrapper.json,
      },
      null,
      2
    )}\n`;
    let previousHash = "";
    let action = "written";
    try {
      const current = await fs.readFile(canonicalPath, "utf8");
      previousHash = sha256Text(current);
      if (current === payload) {
        action = "unchanged";
        written.push({
          path: normalizeRelativePath(canonicalPath, cwd),
          action,
          previous_sha256: previousHash,
          new_sha256: previousHash,
        });
        continue;
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
    const tmpPath = `${canonicalPath}.tmp`;
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, canonicalPath);
    written.push({
      path: normalizeRelativePath(canonicalPath, cwd),
      action,
      previous_sha256: previousHash,
      new_sha256: sha256Text(payload),
    });
  }

  if (failAfterCacheWrite) {
    throw new Error("Falha simulada apos escrita de caches.");
  }

  return written;
}

async function restoreFromBackup({ plan, backupManifest, backupPath, cwd }) {
  for (const [key, source] of Object.entries(plan.loaded.paths.staging)) {
    const backupFile = path.join(backupPath, path.basename(source));
    if (backupManifest.copied_staging_files[key]) {
      await fs.copyFile(backupFile, source);
    }
  }

  for (const item of backupManifest.existing_cache_files) {
    const source = path.resolve(cwd, item.backup_path);
    const destination = path.resolve(cwd, item.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  for (const item of backupManifest.missing_cache_files) {
    await fs.rm(path.resolve(cwd, item), { force: true });
  }
}

export async function runTop1000StaleRepair({
  manifestPath,
  confirm = false,
  cwd = process.cwd(),
  now = new Date(),
  failAfterCacheWrite = false,
} = {}) {
  if (!manifestPath) {
    throw new Error("Informe --manifest=<caminho-do-manifesto>.");
  }

  const plan = await buildRepairPlan({ manifestPath, cwd, now });
  const mode = confirm ? "apply" : "dry-run";
  const report = buildRepairReport({
    mode,
    manifestInfo: plan.manifestInfo,
    sourceHash: plan.sourceHash,
    candidateHash: plan.candidateHash,
    plan,
  });

  if (!confirm) {
    report.report_path = normalizeRelativePath(await writeRunReport(report, cwd), cwd);
    return { mode, plan, report };
  }

  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const { backupPath, backupManifest } = await createBackup({ plan, timestamp, cwd });
  report.backup_path = normalizeRelativePath(backupPath, cwd);

  try {
    report.cache_files_written = await writeCacheFiles({
      plan,
      cwd,
      backupManifest,
      failAfterCacheWrite,
    });
    await writeCsvAtomic(plan.loaded.paths.staging.ledger, plan.candidateRows, LEDGER_COLUMNS);
    await writeCsvAtomic(
      plan.loaded.paths.staging.summary,
      plan.summaryRows,
      BREAKDOWN_SUMMARY_COLUMNS
    );
    if (plan.loaded.errorRows.length === 0) {
      await writeCsvAtomic(
        plan.loaded.paths.staging.errors,
        [],
        BREAKDOWN_ERROR_COLUMNS
      );
    }

    const status = summarizeStaging({
      playersRows: plan.loaded.playersRows,
      ledgerRows: plan.candidateRows,
      summaryRows: plan.summaryRows,
      errorRows: plan.loaded.errorRows,
    });
    await writeJsonAtomic(plan.loaded.paths.staging.status, status);

    const written = await loadStaging(cwd);
    const validation = validateTop1000Rows(written);
    if (!validation.valid) {
      throw new Error(`Validacao pos-escrita falhou:\n${validation.errors.join("\n")}`);
    }
    validation.file_hashes = {
      players: await sha256File(written.paths.staging.players),
      rankings_snapshot: await sha256File(written.paths.staging.snapshot),
      points_ledger: await sha256File(written.paths.staging.ledger),
    };
    await writeJsonAtomic(written.paths.staging.validation, validation);
    if ((await sha256File(written.paths.staging.ledger)) !== plan.candidateHash) {
      throw new Error("Hash pos-escrita do ledger diverge do candidato.");
    }
    report.post_write_validation = validation;
  } catch (err) {
    try {
      await restoreFromBackup({ plan, backupManifest, backupPath, cwd });
      report.rollback_performed = true;
      report.rollback_status = "ROLLBACK_COMPLETED";
    } catch (rollbackErr) {
      report.rollback_performed = true;
      report.rollback_status = "ROLLBACK_FAILED";
      report.rollback_error = rollbackErr?.message || String(rollbackErr);
    }
    report.error = err?.message || String(err);
    report.report_path = normalizeRelativePath(await writeRunReport(report, cwd), cwd);
    throw err;
  }

  report.report_path = normalizeRelativePath(await writeRunReport(report, cwd), cwd);
  return { mode, plan, report };
}
