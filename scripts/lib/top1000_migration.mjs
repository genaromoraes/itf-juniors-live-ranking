import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  BASE_STATE_FILE,
  BASE_STATE_LEGACY_500,
  BASE_STATE_TOP1000_ACTIVE,
  BASE_STATE_TOP1000_STAGING,
  TOP1000_BASE_LIMIT_PER_GENDER,
  TRACKED_BASE_TOTAL,
} from "./ranking_limits.mjs";
import {
  BASELINE_POLICY,
  calculateLedgerPoints,
  compareCalculatedAgainstSnapshot,
  validateLedgerRows,
} from "./official_ledger_validation.mjs";
import {
  LEDGER_COLUMNS,
  cleanText,
  toNumber,
} from "./player_breakdown.mjs";

export { LEDGER_COLUMNS };

export const STAGING_RELATIVE_DIR = path.join("data", "staging", "top1000_base");

export const STAGING_FILES = {
  players: "players.csv",
  snapshot: "rankings_snapshot.csv",
  ledger: "points_ledger.csv",
  summary: "breakdown_summary.csv",
  errors: "breakdown_errors.csv",
  status: "migration_status.json",
  validation: "validation_report.json",
};

export const PLAYER_COLUMNS = [
  "player_id",
  "player_name",
  "first_name",
  "last_name",
  "gender",
  "itf_gender_code",
  "country",
  "country_name",
  "birth_date",
  "birth_year",
  "junior_last_year",
  "active_junior",
  "profile_url",
  "current_rank",
  "current_points",
  "first_seen_date",
  "last_seen_date",
  "raw_json",
];

export const SNAPSHOT_COLUMNS = [
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
];

export const BREAKDOWN_SUMMARY_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "rank",
  "ranking_date",
  "status",
  "ledger_rows",
  "updated_at",
];

export const BREAKDOWN_ERROR_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "rank",
  "ranking_date",
  "error_message",
  "updated_at",
];

export function resolveTop1000Paths(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const stagingDir = path.join(root, STAGING_RELATIVE_DIR);
  const cleanDir = path.join(root, "data", "clean");
  const backupDir = path.join(root, "data", "backups");
  return {
    root,
    stagingDir,
    cleanDir,
    backupDir,
    configState: path.join(root, BASE_STATE_FILE),
    staging: {
      players: path.join(stagingDir, STAGING_FILES.players),
      snapshot: path.join(stagingDir, STAGING_FILES.snapshot),
      ledger: path.join(stagingDir, STAGING_FILES.ledger),
      summary: path.join(stagingDir, STAGING_FILES.summary),
      errors: path.join(stagingDir, STAGING_FILES.errors),
      status: path.join(stagingDir, STAGING_FILES.status),
      validation: path.join(stagingDir, STAGING_FILES.validation),
    },
    clean: {
      players: path.join(cleanDir, "players.csv"),
      snapshot: path.join(cleanDir, "rankings_snapshot.csv"),
      ledger: path.join(cleanDir, "points_ledger.csv"),
    },
  };
}

export async function readCsv(filePath, { optional = false } = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parse(content, { columns: true, skip_empty_lines: true, bom: true });
  } catch (err) {
    if (optional && err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writeCsvAtomic(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(tmpFile, stringify(rows, { header: true, columns }), "utf8");
  await fs.rename(tmpFile, filePath);
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, filePath);
}

export async function readJson(filePath, { optional = false } = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (optional && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export function universeRowsToPlayers(universeRows) {
  return universeRows.map((row) => ({
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    first_name: "",
    last_name: "",
    gender: cleanText(row.gender),
    itf_gender_code: cleanText(row.gender) === "M" ? "B" : "G",
    country: cleanText(row.country),
    country_name: cleanText(row.country_name),
    birth_date: "",
    birth_year: cleanText(row.birth_year),
    junior_last_year: "",
    active_junior: "",
    profile_url: cleanText(row.profile_url),
    current_rank: cleanText(row.rank),
    current_points: cleanText(row.official_points),
    first_seen_date: cleanText(row.ranking_date),
    last_seen_date: cleanText(row.ranking_date),
    raw_json: "",
  }));
}

export function universeRowsToSnapshot(universeRows) {
  return universeRows.map((row) => ({
    ranking_date: cleanText(row.ranking_date),
    gender: cleanText(row.gender),
    rank: cleanText(row.rank),
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    country: cleanText(row.country),
    country_name: cleanText(row.country_name),
    birth_year: cleanText(row.birth_year),
    official_points: cleanText(row.official_points),
    source_url: cleanText(row.source_url),
    collected_at: cleanText(row.collected_at),
  }));
}

export function filterTop1000Universe(universeRows) {
  return universeRows
    .filter((row) => {
      const rank = toNumber(row.rank);
      const gender = cleanText(row.gender);
      return ["M", "F"].includes(gender) && rank >= 1 && rank <= TOP1000_BASE_LIMIT_PER_GENDER;
    })
    .sort((a, b) => {
      if (cleanText(a.gender) !== cleanText(b.gender)) {
        return cleanText(a.gender).localeCompare(cleanText(b.gender));
      }
      return toNumber(a.rank) - toNumber(b.rank);
    });
}

export function copyExistingLedgerForStaging(productionLedgerRows, stagingPlayerIds) {
  return productionLedgerRows.filter((row) =>
    stagingPlayerIds.has(cleanText(row.player_id))
  );
}

export function summarizeStaging({ playersRows, ledgerRows, summaryRows = [], errorRows = [] }) {
  const expectedIds = new Set(playersRows.map((row) => cleanText(row.player_id)).filter(Boolean));
  const ledgerIds = new Set(ledgerRows.map((row) => cleanText(row.player_id)).filter(Boolean));
  const processedIds = new Set(
    summaryRows
      .filter((row) => cleanText(row.status) === "fetched" || ledgerIds.has(cleanText(row.player_id)))
      .map((row) => cleanText(row.player_id))
      .filter(Boolean)
  );
  for (const id of ledgerIds) {
    if (expectedIds.has(id)) processedIds.add(id);
  }
  const missingIds = [...expectedIds].filter((id) => !processedIds.has(id));
  const lastSummary = summaryRows[summaryRows.length - 1] || {};
  const expectedTotal = TRACKED_BASE_TOTAL;
  const completed = Math.min(processedIds.size, expectedTotal);
  return {
    state: BASE_STATE_TOP1000_STAGING,
    expected_total: expectedTotal,
    expected_male: TOP1000_BASE_LIMIT_PER_GENDER,
    expected_female: TOP1000_BASE_LIMIT_PER_GENDER,
    players_total: playersRows.length,
    breakdowns_available: completed,
    breakdowns_missing: Math.max(0, expectedTotal - completed),
    errors: errorRows.length,
    last_player_id: cleanText(lastSummary.player_id),
    last_rank: cleanText(lastSummary.rank),
    percent_complete: expectedTotal ? Number(((completed / expectedTotal) * 100).toFixed(2)) : 0,
    ready_for_promotion: playersRows.length === expectedTotal && missingIds.length === 0 && errorRows.length === 0,
    missing_player_ids: missingIds,
    updated_at: new Date().toISOString(),
  };
}

export function validateTop1000Rows({
  playersRows,
  snapshotRows,
  ledgerRows,
  summaryRows = [],
  errorRows = [],
}) {
  const errors = [];
  const expectedTotal = TRACKED_BASE_TOTAL;
  const expectedPerGender = TOP1000_BASE_LIMIT_PER_GENDER;
  const playerIds = playersRows.map((row) => cleanText(row.player_id));
  const uniquePlayerIds = new Set(playerIds.filter(Boolean));
  const snapshotIds = snapshotRows.map((row) => cleanText(row.player_id));
  const uniqueSnapshotIds = new Set(snapshotIds.filter(Boolean));
  const ledgerIds = new Set(ledgerRows.map((row) => cleanText(row.player_id)).filter(Boolean));
  const rankingDate = cleanText(snapshotRows[0]?.ranking_date);

  if (playersRows.length !== expectedTotal) errors.push(`players.csv precisa ter ${expectedTotal} jogadores.`);
  if (snapshotRows.length !== expectedTotal) errors.push(`rankings_snapshot.csv precisa ter ${expectedTotal} jogadores.`);
  if (uniquePlayerIds.size !== playersRows.length) errors.push("players.csv possui player_id vazio ou duplicado.");
  if (uniqueSnapshotIds.size !== snapshotRows.length) errors.push("rankings_snapshot.csv possui player_id vazio ou duplicado.");
  if (uniquePlayerIds.size !== uniqueSnapshotIds.size || [...uniquePlayerIds].some((id) => !uniqueSnapshotIds.has(id))) {
    errors.push("players.csv e rankings_snapshot.csv possuem conjuntos de player_id diferentes.");
  }

  for (const gender of ["M", "F"]) {
    const ranks = snapshotRows
      .filter((row) => cleanText(row.gender) === gender)
      .map((row) => toNumber(row.rank))
      .sort((a, b) => a - b);
    if (ranks.length !== expectedPerGender) {
      errors.push(`rankings_snapshot.csv precisa ter ${expectedPerGender} ${gender}.`);
    }
    for (let index = 0; index < ranks.length; index += 1) {
      if (ranks[index] !== index + 1) {
        errors.push(`Ranking ${gender} incompleto ou duplicado na posicao ${index + 1}.`);
        break;
      }
    }
  }

  if (errorRows.length > 0) errors.push(`Existem ${errorRows.length} erros de breakdown pendentes.`);

  const summary = summarizeStaging({ playersRows, ledgerRows, summaryRows, errorRows });
  if (summary.breakdowns_missing > 0) {
    errors.push(`Existem ${summary.breakdowns_missing} breakdowns faltantes.`);
  }

  if ([...ledgerIds].some((id) => !uniquePlayerIds.has(id))) {
    errors.push("points_ledger.csv contem jogador fora da base de staging.");
  }

  const ledgerValidation = validateLedgerRows(ledgerRows);
  errors.push(...ledgerValidation.errors);

  const calculatedRows = calculateLedgerPoints(ledgerRows, {
    policy: BASELINE_POLICY,
  });
  const comparison = compareCalculatedAgainstSnapshot(calculatedRows, snapshotRows, {
    baselinePolicy: BASELINE_POLICY,
  });
  if (!comparison.valid) {
    errors.push(`Ledger reconciliou ${comparison.exact}/${comparison.total} jogadores oficiais.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    ranking_date: rankingDate,
    expected_total: expectedTotal,
    expected_male: expectedPerGender,
    expected_female: expectedPerGender,
    players_total: playersRows.length,
    snapshot_total: snapshotRows.length,
    unique_ledger_players: ledgerIds.size,
    breakdowns_missing: summary.breakdowns_missing,
    breakdown_errors: errorRows.length,
    reconciliation_exact: comparison.exact,
    reconciliation_total: comparison.total,
    generated_at: new Date().toISOString(),
  };
}

export async function loadStaging(cwd = process.cwd()) {
  const paths = resolveTop1000Paths(cwd);
  return {
    paths,
    playersRows: await readCsv(paths.staging.players, { optional: true }),
    snapshotRows: await readCsv(paths.staging.snapshot, { optional: true }),
    ledgerRows: await readCsv(paths.staging.ledger, { optional: true }),
    summaryRows: await readCsv(paths.staging.summary, { optional: true }),
    errorRows: await readCsv(paths.staging.errors, { optional: true }),
    status: await readJson(paths.staging.status, { optional: true }),
    validation: await readJson(paths.staging.validation, { optional: true }),
  };
}

export async function getStagingFileHashes(paths) {
  return {
    players: await sha256File(paths.staging.players),
    rankings_snapshot: await sha256File(paths.staging.snapshot),
    points_ledger: await sha256File(paths.staging.ledger),
  };
}

export async function validateAndWriteTop1000Report(cwd = process.cwd()) {
  const loaded = await loadStaging(cwd);
  const report = validateTop1000Rows(loaded);
  report.file_hashes = report.valid ? await getStagingFileHashes(loaded.paths) : {};
  await writeJsonAtomic(loaded.paths.staging.validation, report);
  await writeStagingStatus(cwd);
  return report;
}

export async function writeStagingStatus(cwd = process.cwd()) {
  const loaded = await loadStaging(cwd);
  const status = summarizeStaging(loaded);
  await writeJsonAtomic(loaded.paths.staging.status, status);
  return status;
}

export async function writeBaseState(cwd, state) {
  await writeJsonAtomic(path.resolve(cwd, BASE_STATE_FILE), {
    state,
    updated_at: new Date().toISOString(),
  });
}

async function copyFileAtomic(source, destination) {
  const tmpFile = `${destination}.tmp`;
  await fs.copyFile(source, tmpFile);
  await fs.rename(tmpFile, destination);
}

async function backupProduction(paths, timestamp) {
  const backupRoot = path.join(paths.backupDir, `top1000_base_${timestamp}`);
  await fs.mkdir(backupRoot, { recursive: true });
  for (const [name, source] of Object.entries(paths.clean)) {
    await fs.copyFile(source, path.join(backupRoot, path.basename(source)));
  }
  return backupRoot;
}

export async function promoteTop1000Base({
  cwd = process.cwd(),
  confirm = false,
  now = new Date(),
  failAfterFirstCopy = false,
} = {}) {
  const loaded = await loadStaging(cwd);
  const report = validateTop1000Rows(loaded);
  const currentValidation = await readJson(loaded.paths.staging.validation, { optional: true });
  const planned = {
    would_promote: true,
    confirm_required: true,
    valid: report.valid,
    errors: report.errors,
  };

  if (!confirm) return planned;
  if (!report.valid) {
    throw new Error(`Staging Top 1000 invalido:\n${report.errors.join("\n")}`);
  }
  const currentHashes = await getStagingFileHashes(loaded.paths);
  if (
    !currentValidation?.valid ||
    JSON.stringify(currentValidation.file_hashes || {}) !== JSON.stringify(currentHashes)
  ) {
    throw new Error("validation_report.json aprovado e atual e obrigatorio antes da promocao.");
  }

  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const backupRoot = await backupProduction(loaded.paths, timestamp);
  const cleanBackups = {
    players: path.join(backupRoot, "players.csv"),
    snapshot: path.join(backupRoot, "rankings_snapshot.csv"),
    ledger: path.join(backupRoot, "points_ledger.csv"),
  };

  try {
    await copyFileAtomic(loaded.paths.staging.players, loaded.paths.clean.players);
    if (failAfterFirstCopy) {
      throw new Error("Falha simulada apos primeira copia da promocao.");
    }
    await copyFileAtomic(loaded.paths.staging.snapshot, loaded.paths.clean.snapshot);
    await copyFileAtomic(loaded.paths.staging.ledger, loaded.paths.clean.ledger);
    await writeBaseState(cwd, BASE_STATE_TOP1000_ACTIVE);
    return { promoted: true, backup_dir: backupRoot, validation: report };
  } catch (err) {
    await copyFileAtomic(cleanBackups.players, loaded.paths.clean.players).catch(() => {});
    await copyFileAtomic(cleanBackups.snapshot, loaded.paths.clean.snapshot).catch(() => {});
    await copyFileAtomic(cleanBackups.ledger, loaded.paths.clean.ledger).catch(() => {});
    await writeBaseState(cwd, BASE_STATE_LEGACY_500).catch(() => {});
    throw err;
  }
}
