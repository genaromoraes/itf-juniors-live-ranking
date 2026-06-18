import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  LEDGER_COLUMNS,
  buildResultKey,
  cleanText,
  isIsoDate,
  toNumber,
} from "./lib/weekly_ledger.mjs";
import {
  OFFICIAL_PLAYER_COLUMNS,
  OFFICIAL_SNAPSHOT_COLUMNS,
  normalizeGender,
} from "./lib/official_ledger_validation.mjs";
import {
  TRACKED_BASE_LIMIT_PER_GENDER,
  TRACKED_BASE_TOTAL,
} from "./lib/ranking_limits.mjs";

export const REQUIRED_SOURCE_FILES = [
  "players.next.csv",
  "rankings_snapshot.next.csv",
  "points_ledger.next_official.csv",
  "official_reconciliation_summary.json",
  "final_validation.csv",
  "removed_players_ledger_archive.csv",
];

export const DESTINATION_FILES = {
  players: "data/clean/players.csv",
  snapshot: "data/clean/rankings_snapshot.csv",
  ledger: "data/clean/points_ledger.csv",
};

const EXPECTED_SUMMARY_VALUES = {
  final_total: TRACKED_BASE_TOTAL,
  final_exact: TRACKED_BASE_TOTAL,
  final_divergent: 0,
  final_missing_ledger: 0,
  unique_ledger_players: TRACKED_BASE_TOTAL,
  ledger_players_outside_official: 0,
  breakdowns_failed: 0,
  mode_safe_for_promotion: true,
};

function parseArgs(argv = process.argv.slice(2)) {
  const readArg = (name, fallback = "") => {
    const prefix = `--${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
  };

  return {
    sourceDir: cleanText(readArg("source-dir")),
    rankingDate: cleanText(readArg("ranking-date")),
    mode: cleanText(readArg("mode", "dry-run")) || "dry-run",
    confirmPromotion:
      cleanText(readArg("confirm-promotion", "false")).toLowerCase() === "true",
  };
}

function resolvePath(cwd, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(rows, { header: true, columns }), "utf8");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function collectFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

export async function locateSourceFiles(sourceDir) {
  const files = await collectFiles(sourceDir);
  const result = {};

  for (const fileName of REQUIRED_SOURCE_FILES) {
    const matches = files.filter((filePath) => path.basename(filePath) === fileName);
    if (matches.length !== 1) {
      throw new Error(
        `Esperado exatamente 1 arquivo ${fileName} em ${sourceDir}, encontrado ${matches.length}.`
      );
    }
    result[fileName] = matches[0];
  }

  return {
    playersFile: result["players.next.csv"],
    snapshotFile: result["rankings_snapshot.next.csv"],
    ledgerFile: result["points_ledger.next_official.csv"],
    summaryFile: result["official_reconciliation_summary.json"],
    finalValidationFile: result["final_validation.csv"],
    removedArchiveFile: result["removed_players_ledger_archive.csv"],
  };
}

function validateUniqueIds(rows, label, errors) {
  const seen = new Set();
  for (const row of rows) {
    const id = cleanText(row.player_id);
    if (!id) {
      errors.push(`${label}: linha sem player_id.`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label}: player_id duplicado ${id}.`);
    }
    seen.add(id);
  }
  return seen;
}

export function validateSourceRows({
  summary,
  playersRows,
  snapshotRows,
  ledgerRows,
  rankingDate,
}) {
  const errors = [];

  if (summary.ranking_date !== rankingDate) {
    errors.push(`summary.ranking_date esperado ${rankingDate}, recebido ${summary.ranking_date}.`);
  }
  for (const [key, expected] of Object.entries(EXPECTED_SUMMARY_VALUES)) {
    if (summary[key] !== expected) {
      errors.push(`summary.${key} esperado ${expected}, recebido ${summary[key]}.`);
    }
  }

  if (playersRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`players.next.csv precisa ter ${TRACKED_BASE_TOTAL} linhas, recebeu ${playersRows.length}.`);
  }
  const playerIds = validateUniqueIds(playersRows, "players.next.csv", errors);
  const playerGenderCounts = { M: 0, F: 0 };
  for (const row of playersRows) {
    const gender = normalizeGender(row.gender);
    if (gender === "M" || gender === "F") playerGenderCounts[gender] += 1;
  }
  if (playerGenderCounts.M !== TRACKED_BASE_LIMIT_PER_GENDER) {
    errors.push(`players.next.csv precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} M, recebeu ${playerGenderCounts.M}.`);
  }
  if (playerGenderCounts.F !== TRACKED_BASE_LIMIT_PER_GENDER) {
    errors.push(`players.next.csv precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} F, recebeu ${playerGenderCounts.F}.`);
  }

  if (snapshotRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`rankings_snapshot.next.csv precisa ter ${TRACKED_BASE_TOTAL} linhas, recebeu ${snapshotRows.length}.`);
  }
  validateUniqueIds(snapshotRows, "rankings_snapshot.next.csv", errors);
  const ranksByGender = { M: [], F: [] };
  for (const row of snapshotRows) {
    if (cleanText(row.ranking_date) !== rankingDate) {
      errors.push(`Snapshot com ranking_date invalido: ${cleanText(row.player_id)}.`);
    }
    const gender = normalizeGender(row.gender);
    if (gender === "M" || gender === "F") {
      ranksByGender[gender].push(toNumber(row.rank));
    }
  }
  for (const gender of ["M", "F"]) {
    const ranks = ranksByGender[gender].sort((a, b) => (a ?? 0) - (b ?? 0));
    if (ranks.length !== TRACKED_BASE_LIMIT_PER_GENDER) {
      errors.push(`Snapshot precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} ranks ${gender}, recebeu ${ranks.length}.`);
      continue;
    }
    for (let index = 0; index < ranks.length; index++) {
      if (ranks[index] !== index + 1) {
        errors.push(`Ranks ${gender} invalidos: esperado ${index + 1}, recebido ${ranks[index]}.`);
        break;
      }
    }
  }

  const ledgerPlayerIds = new Set();
  const ledgerKeys = new Set();
  for (const row of ledgerRows) {
    const playerId = cleanText(row.player_id);
    ledgerPlayerIds.add(playerId);
    if (!playerIds.has(playerId)) {
      errors.push(`Ledger contem jogador fora de players.next.csv: ${playerId}.`);
    }
    if (cleanText(row.is_live).toLowerCase() === "true") {
      errors.push(`Ledger contem is_live=true: ${buildResultKey(row)}.`);
    }
    if (!["singles", "doubles"].includes(cleanText(row.event_type).toLowerCase())) {
      errors.push(`Ledger contem event_type invalido: ${buildResultKey(row)}.`);
    }
    if (toNumber(row.points) === null) {
      errors.push(`Ledger contem points invalido: ${buildResultKey(row)}.`);
    }
    const key = buildResultKey(row);
    if (ledgerKeys.has(key)) {
      errors.push(`Ledger contem duplicata pela chave: ${key}.`);
    }
    ledgerKeys.add(key);
  }
  if (ledgerPlayerIds.size !== TRACKED_BASE_TOTAL) {
    errors.push(`Ledger precisa ter ${TRACKED_BASE_TOTAL} jogadores unicos, recebeu ${ledgerPlayerIds.size}.`);
  }

  return {
    validationPassed: errors.length === 0,
    errors,
    playerGenderCounts,
    ledgerUniquePlayers: ledgerPlayerIds.size,
  };
}

async function fileInfo(filePath) {
  const rows = filePath.endsWith(".csv") ? await readCsv(filePath) : [];
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    size: stat.size,
    sha256: await sha256File(filePath),
    rows: rows.length,
    ranking_date: rows[0]?.ranking_date || "",
  };
}

async function buildFileHashMap(files) {
  const result = {};
  for (const [label, filePath] of Object.entries(files)) {
    result[label] = await fileInfo(filePath);
  }
  return result;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function buildBackupDir(cwd, timestamp) {
  return path.join(
    cwd,
    "data",
    "backups",
    `official_base_2026-06-08_before_promotion_${timestamp}`
  );
}

async function copyFileEnsuringDir(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function createBackup({ cwd, destinationFiles, timestamp }) {
  const backupDir = buildBackupDir(cwd, timestamp);
  if (await fileExists(backupDir)) {
    throw new Error(`Backup ja existe: ${backupDir}`);
  }
  await fs.mkdir(path.dirname(backupDir), { recursive: true });
  await fs.mkdir(backupDir, { recursive: false });

  const manifest = {
    backup_dir: backupDir,
    timestamp,
    files: {},
  };

  for (const [label, destination] of Object.entries(destinationFiles)) {
    const backupFile = path.join(backupDir, path.basename(destination));
    await fs.copyFile(destination, backupFile);
    manifest.files[label] = await fileInfo(backupFile);
  }

  await writeJson(path.join(backupDir, "backup_manifest.json"), manifest);
  return { backupDir, manifest };
}

async function restoreBackup({ destinationFiles, backupDir }) {
  for (const destination of Object.values(destinationFiles)) {
    const backupFile = path.join(backupDir, path.basename(destination));
    if (await fileExists(backupFile)) {
      await fs.copyFile(backupFile, destination);
    }
    const nextFile = `${destination}.next`;
    if (await fileExists(nextFile)) {
      await fs.rm(nextFile, { force: true });
    }
  }
}

function comparePlayers(oldPlayers, newPlayers) {
  const oldIds = new Set(oldPlayers.map((row) => cleanText(row.player_id)));
  const newIds = new Set(newPlayers.map((row) => cleanText(row.player_id)));
  return {
    added: [...newIds].filter((id) => !oldIds.has(id)).sort(),
    removed: [...oldIds].filter((id) => !newIds.has(id)).sort(),
  };
}

export async function loadPromotionData({ cwd, sourceDir, rankingDate }) {
  const sourceFiles = await locateSourceFiles(sourceDir);
  const summary = JSON.parse(await fs.readFile(sourceFiles.summaryFile, "utf8"));
  const playersRows = await readCsv(sourceFiles.playersFile);
  const snapshotRows = await readCsv(sourceFiles.snapshotFile);
  const ledgerRows = await readCsv(sourceFiles.ledgerFile);
  const finalValidationRows = await readCsv(sourceFiles.finalValidationFile);
  const removedArchiveRows = await readCsv(sourceFiles.removedArchiveFile);
  const destinationFiles = {
    players: resolvePath(cwd, DESTINATION_FILES.players),
    snapshot: resolvePath(cwd, DESTINATION_FILES.snapshot),
    ledger: resolvePath(cwd, DESTINATION_FILES.ledger),
  };
  const oldPlayersRows = await readCsv(destinationFiles.players);
  const oldSnapshotRows = await readCsv(destinationFiles.snapshot);
  const oldLedgerRows = await readCsv(destinationFiles.ledger);
  const validation = validateSourceRows({
    summary,
    playersRows,
    snapshotRows,
    ledgerRows,
    rankingDate,
  });
  const playerDiff = comparePlayers(oldPlayersRows, playersRows);

  return {
    sourceFiles,
    destinationFiles,
    summary,
    playersRows,
    snapshotRows,
    ledgerRows,
    finalValidationRows,
    removedArchiveRows,
    oldPlayersRows,
    oldSnapshotRows,
    oldLedgerRows,
    validation,
    playerDiff,
  };
}

function buildReport({
  args,
  data,
  backupDir,
  validationPassed,
  promotionCompleted,
  rollbackPerformed,
  errors,
  warnings,
  startedAt,
  finishedAt,
}) {
  return {
    old_ranking_date: cleanText(data.oldSnapshotRows[0]?.ranking_date),
    new_ranking_date: args.rankingDate,
    old_players: data.oldPlayersRows.length,
    new_players: data.playersRows.length,
    old_ledger_rows: data.oldLedgerRows.length,
    new_ledger_rows: data.ledgerRows.length,
    players_added: data.playerDiff.added.length,
    players_removed: data.playerDiff.removed.length,
    players_added_ids: data.playerDiff.added,
    players_removed_ids: data.playerDiff.removed,
    backup_dir: backupDir,
    validation_passed: validationPassed,
    mode: args.mode,
    promotion_completed: promotionCompleted,
    rollback_performed: rollbackPerformed,
    errors,
    warnings,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}

async function writeReports({ reportDir, report, sourceHashes, beforeHashes, afterHashes }) {
  await writeJson(path.join(reportDir, "promotion_report.json"), report);
  await writeJson(path.join(reportDir, "source_hashes.json"), sourceHashes);
  await writeJson(path.join(reportDir, "destination_hashes_before.json"), beforeHashes);
  await writeJson(path.join(reportDir, "destination_hashes_after.json"), afterHashes);
  await writeJson(path.join(reportDir, "promotion_diff_summary.json"), {
    old_players: report.old_players,
    new_players: report.new_players,
    old_ledger_rows: report.old_ledger_rows,
    new_ledger_rows: report.new_ledger_rows,
    players_added: report.players_added,
    players_removed: report.players_removed,
    players_added_ids: report.players_added_ids,
    players_removed_ids: report.players_removed_ids,
  });
}

async function validateDestinationAfterApply(destinationFiles, rankingDate) {
  const summary = {
    ranking_date: rankingDate,
    ...EXPECTED_SUMMARY_VALUES,
  };
  const validation = validateSourceRows({
    summary,
    playersRows: await readCsv(destinationFiles.players),
    snapshotRows: await readCsv(destinationFiles.snapshot),
    ledgerRows: await readCsv(destinationFiles.ledger),
    rankingDate,
  });
  if (!validation.validationPassed) {
    throw new Error(validation.errors.join("\n"));
  }
}

export async function runPromotion(rawArgs, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const startedAt = new Date().toISOString();
  const args = {
    sourceDir: resolvePath(cwd, rawArgs.sourceDir || ""),
    rankingDate: cleanText(rawArgs.rankingDate),
    mode: cleanText(rawArgs.mode || "dry-run"),
    confirmPromotion: rawArgs.confirmPromotion === true,
  };
  const errors = [];
  const warnings = [];

  if (!args.sourceDir) errors.push("Informe --source-dir.");
  if (!isIsoDate(args.rankingDate)) errors.push("Informe --ranking-date=YYYY-MM-DD.");
  if (!["dry-run", "apply"].includes(args.mode)) errors.push("Use --mode=dry-run ou --mode=apply.");
  if (args.mode === "apply" && !args.confirmPromotion) {
    errors.push("Apply exige --confirm-promotion=true.");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const timestamp = timestampForPath(deps.now || new Date());
  const reportDir = path.join(cwd, "data", "staging", `promotion_${args.rankingDate}`);
  const data = await loadPromotionData({
    cwd,
    sourceDir: args.sourceDir,
    rankingDate: args.rankingDate,
  });
  const sourceHashes = await buildFileHashMap({
    players: data.sourceFiles.playersFile,
    snapshot: data.sourceFiles.snapshotFile,
    ledger: data.sourceFiles.ledgerFile,
    final_validation: data.sourceFiles.finalValidationFile,
    removed_archive: data.sourceFiles.removedArchiveFile,
  });
  const beforeHashes = await buildFileHashMap(data.destinationFiles);
  let afterHashes = beforeHashes;
  let backupDir = buildBackupDir(cwd, timestamp);
  let promotionCompleted = false;
  let rollbackPerformed = false;
  const validationErrors = [...data.validation.errors];

  if (!data.validation.validationPassed) {
    errors.push(...validationErrors);
  }

  if (args.mode === "apply" && errors.length === 0) {
    try {
      const backup = await createBackup({
        cwd,
        destinationFiles: data.destinationFiles,
        timestamp,
      });
      backupDir = backup.backupDir;

      await copyFileEnsuringDir(data.sourceFiles.playersFile, `${data.destinationFiles.players}.next`);
      await copyFileEnsuringDir(data.sourceFiles.snapshotFile, `${data.destinationFiles.snapshot}.next`);
      await copyFileEnsuringDir(data.sourceFiles.ledgerFile, `${data.destinationFiles.ledger}.next`);
      if (deps.failAfterNextWrite) {
        throw new Error("Falha simulada apos gravar arquivos .next.");
      }

      validateSourceRows({
        summary: data.summary,
        playersRows: await readCsv(`${data.destinationFiles.players}.next`),
        snapshotRows: await readCsv(`${data.destinationFiles.snapshot}.next`),
        ledgerRows: await readCsv(`${data.destinationFiles.ledger}.next`),
        rankingDate: args.rankingDate,
      }).errors.forEach((error) => {
        throw new Error(error);
      });

      await fs.rename(`${data.destinationFiles.players}.next`, data.destinationFiles.players);
      if (deps.failAfterFirstRename) {
        throw new Error("Falha simulada apos primeiro rename.");
      }
      await fs.rename(`${data.destinationFiles.snapshot}.next`, data.destinationFiles.snapshot);
      await fs.rename(`${data.destinationFiles.ledger}.next`, data.destinationFiles.ledger);
      await validateDestinationAfterApply(data.destinationFiles, args.rankingDate);
      afterHashes = await buildFileHashMap(data.destinationFiles);
      promotionCompleted = true;
    } catch (error) {
      errors.push(error?.message || String(error));
      rollbackPerformed = true;
      await restoreBackup({ destinationFiles: data.destinationFiles, backupDir });
      afterHashes = await buildFileHashMap(data.destinationFiles);
      promotionCompleted = false;
    }
  } else {
    afterHashes = await buildFileHashMap(data.destinationFiles);
  }

  const finishedAt = new Date().toISOString();
  const report = buildReport({
    args,
    data,
    backupDir,
    validationPassed: data.validation.validationPassed && errors.length === 0,
    promotionCompleted,
    rollbackPerformed,
    errors,
    warnings,
    startedAt,
    finishedAt,
  });

  await writeReports({
    reportDir,
    report,
    sourceHashes,
    beforeHashes,
    afterHashes,
  });

  if (errors.length > 0 && args.mode === "apply") {
    throw new Error(errors.join("\n"));
  }

  if (!data.validation.validationPassed) {
    throw new Error(data.validation.errors.join("\n"));
  }

  return {
    report,
    sourceHashes,
    beforeHashes,
    afterHashes,
    reportDir,
    data,
  };
}

async function main() {
  const args = parseArgs();
  const result = await runPromotion(args);

  console.log("Promocao oficial validada.");
  console.log(JSON.stringify(result.report, null, 2));
  console.log("Arquivos que seriam substituidos:");
  console.log(`${result.data.sourceFiles.playersFile} -> ${result.data.destinationFiles.players}`);
  console.log(`${result.data.sourceFiles.snapshotFile} -> ${result.data.destinationFiles.snapshot}`);
  console.log(`${result.data.sourceFiles.ledgerFile} -> ${result.data.destinationFiles.ledger}`);
  console.log(`Relatorio: ${path.join(result.reportDir, "promotion_report.json")}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
