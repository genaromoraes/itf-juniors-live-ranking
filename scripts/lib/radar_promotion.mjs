import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import {
  BASE_STATE_FILE,
  BASE_STATE_LEGACY_500,
  BASE_STATE_RADAR1500_ACTIVE,
  RADAR_LIMIT_PER_GENDER,
} from "./ranking_limits.mjs";

const PUBLIC_LIMIT_PER_GENDER = 1000;
const TOTAL = RADAR_LIMIT_PER_GENDER * 2;
const REQUIRED_FILES = ["players.csv", "rankings_snapshot.csv", "points_ledger.csv"];

function clean(value) {
  return String(value ?? "").trim();
}

async function readJson(filePath, optional = false) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function copyFileAtomic(source, destination) {
  const temporary = `${destination}.radar1500.tmp`;
  await fs.copyFile(source, temporary);
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.radar1500.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function resolveRadarPromotionPaths(cwd = process.cwd(), baseDir = "data/staging/radar_2026-09-07/base") {
  const root = path.resolve(cwd);
  const stagingDir = path.resolve(root, baseDir);
  const cleanDir = path.join(root, "data", "clean");
  return {
    root,
    stagingDir,
    cleanDir,
    configState: path.join(root, BASE_STATE_FILE),
    backupDir: path.join(root, "data", "backups"),
    staging: Object.fromEntries(REQUIRED_FILES.map((file) => [file, path.join(stagingDir, file)])),
    clean: Object.fromEntries(REQUIRED_FILES.map((file) => [file, path.join(cleanDir, file)])),
    manifest: path.join(stagingDir, "manifest.json"),
    validation: path.join(stagingDir, "validation.json"),
    queue: path.join(stagingDir, "queue.csv"),
  };
}

export async function getRadarStagingValidation(paths) {
  const errors = [];
  const manifest = await readJson(paths.manifest, true);
  const validation = await readJson(paths.validation, true);

  if (!manifest) errors.push("Manifesto da base radar ausente.");
  if (!validation) errors.push("validation.json da base radar ausente.");
  if (!manifest || !validation) {
    return { valid: false, errors, manifest, validation, fileHashes: {} };
  }

  for (const file of REQUIRED_FILES) {
    try {
      await fs.access(paths.staging[file]);
    } catch {
      errors.push(`Arquivo de staging ausente: ${file}.`);
    }
  }

  if (manifest.radar_limit_per_gender !== RADAR_LIMIT_PER_GENDER) {
    errors.push(`Manifesto precisa declarar radar ${RADAR_LIMIT_PER_GENDER} por gênero.`);
  }
  if (manifest.public_limit_per_gender !== PUBLIC_LIMIT_PER_GENDER) {
    errors.push(`Manifesto precisa declarar público ${PUBLIC_LIMIT_PER_GENDER} por gênero.`);
  }
  if (validation.valid !== true) errors.push("A validação da base radar não está aprovada.");
  if (validation.radar_limit_per_gender !== RADAR_LIMIT_PER_GENDER) {
    errors.push("validation.json não confirma o limite RADAR1500.");
  }
  if (validation.public_limit_per_gender !== PUBLIC_LIMIT_PER_GENDER) {
    errors.push("validation.json não confirma o limite público Top1000.");
  }
  if (validation.exact !== TOTAL || validation.total !== TOTAL) {
    errors.push(`Reconciliação precisa ser exata para ${TOTAL} atletas.`);
  }
  if (validation.pending_additional !== 0 || validation.errors?.length) {
    errors.push("A base radar ainda possui pendências ou erros.");
  }

  const players = await readCsv(paths.staging["players.csv"]);
  const snapshot = await readCsv(paths.staging["rankings_snapshot.csv"]);
  const queue = await readCsv(paths.queue).catch(() => []);
  if (players.length !== TOTAL || snapshot.length !== TOTAL) {
    errors.push(`Staging precisa conter ${TOTAL} players e ${TOTAL} snapshots.`);
  }
  for (const gender of ["M", "F"]) {
    if (players.filter((row) => clean(row.gender) === gender).length !== RADAR_LIMIT_PER_GENDER) {
      errors.push(`players.csv não contém ${RADAR_LIMIT_PER_GENDER} atletas ${gender}.`);
    }
    if (snapshot.filter((row) => clean(row.gender) === gender).length !== RADAR_LIMIT_PER_GENDER) {
      errors.push(`rankings_snapshot.csv não contém ${RADAR_LIMIT_PER_GENDER} atletas ${gender}.`);
    }
  }
  if (queue.some((row) => clean(row.status) !== "BREAKDOWN_VALIDATED")) {
    errors.push("A fila de breakdowns contém atletas não validados.");
  }

  const fileHashes = {};
  for (const file of REQUIRED_FILES) {
    if (await fs.access(paths.staging[file]).then(() => true).catch(() => false)) {
      fileHashes[file] = await sha256File(paths.staging[file]);
      const expected = validation.hashes?.[file];
      if (expected && expected !== fileHashes[file]) {
        errors.push(`Hash divergente no staging: ${file}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors, manifest, validation, fileHashes };
}

async function readCurrentState(configState) {
  const state = await readJson(configState, true);
  return clean(state?.state) || BASE_STATE_LEGACY_500;
}

async function backupProduction(paths, timestamp) {
  const backupRoot = path.join(paths.backupDir, `radar1500_base_${timestamp}`);
  await fs.mkdir(backupRoot, { recursive: true });
  for (const file of REQUIRED_FILES) await fs.copyFile(paths.clean[file], path.join(backupRoot, file));
  const stateExists = await fs.access(paths.configState).then(() => true).catch(() => false);
  if (stateExists) await fs.copyFile(paths.configState, path.join(backupRoot, "base_state.json"));
  await fs.writeFile(path.join(backupRoot, "state_present.txt"), stateExists ? "true\n" : "false\n", "utf8");
  return backupRoot;
}

export async function promoteRadar1500Base({
  cwd = process.cwd(),
  baseDir = "data/staging/radar_2026-09-07/base",
  confirm = false,
  now = new Date(),
  failAfterFirstCopy = false,
} = {}) {
  const paths = resolveRadarPromotionPaths(cwd, baseDir);
  const validation = await getRadarStagingValidation(paths);
  const currentState = await readCurrentState(paths.configState);
  const plan = {
    would_promote: validation.valid,
    confirm_required: true,
    valid: validation.valid,
    current_state: currentState,
    target_state: BASE_STATE_RADAR1500_ACTIVE,
    errors: validation.errors,
  };
  if (!confirm) return plan;
  if (!validation.valid) throw new Error(`Staging RADAR1500 inválido:\n${validation.errors.join("\n")}`);

  const currentFilesExist = await Promise.all(REQUIRED_FILES.map((file) =>
    fs.access(paths.clean[file]).then(() => true).catch(() => false)
  ));
  if (currentFilesExist.some((exists) => !exists)) {
    throw new Error("A produção precisa conter os três arquivos oficiais antes da promoção.");
  }

  if (currentState === BASE_STATE_RADAR1500_ACTIVE) {
    const sameFiles = await Promise.all(REQUIRED_FILES.map(async (file) =>
      (await sha256File(paths.clean[file])) === validation.fileHashes[file]
    ));
    if (sameFiles.every(Boolean)) return { ...plan, promoted: false, already_active: true };
    throw new Error("RADAR1500 já está ativo, mas os arquivos de produção divergem do staging.");
  }

  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const backupRoot = await backupProduction(paths, timestamp);
  const cleanBackup = Object.fromEntries(REQUIRED_FILES.map((file) => [file, path.join(backupRoot, file)]));
  const stateBackup = path.join(backupRoot, "base_state.json");
  try {
    await copyFileAtomic(paths.staging["players.csv"], paths.clean["players.csv"]);
    if (failAfterFirstCopy) throw new Error("Falha simulada após primeira cópia da promoção RADAR1500.");
    await copyFileAtomic(paths.staging["rankings_snapshot.csv"], paths.clean["rankings_snapshot.csv"]);
    await copyFileAtomic(paths.staging["points_ledger.csv"], paths.clean["points_ledger.csv"]);
    await writeJsonAtomic(paths.configState, { state: BASE_STATE_RADAR1500_ACTIVE, updated_at: new Date().toISOString() });
    return { promoted: true, backup_dir: backupRoot, validation: validation.validation };
  } catch (error) {
    for (const file of REQUIRED_FILES) await copyFileAtomic(cleanBackup[file], paths.clean[file]).catch(() => {});
    if (await fs.access(stateBackup).then(() => true).catch(() => false)) {
      await copyFileAtomic(stateBackup, paths.configState).catch(() => {});
    } else {
      await fs.rm(paths.configState, { force: true }).catch(() => {});
    }
    throw error;
  }
}
