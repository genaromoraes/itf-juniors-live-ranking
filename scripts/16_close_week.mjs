import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  LEDGER_COLUMNS,
  REQUIRED_SOURCE_FILES,
  buildCloseWeekPlan,
  buildResultKey,
  cleanText,
  isIsoDate,
  todayIso,
  toNumber,
} from "./lib/weekly_ledger.mjs";

const CLEAN_DIR = path.resolve("data/clean");
const POINTS_LEDGER_FILE = path.join(CLEAN_DIR, "points_ledger.csv");
const PLAYERS_FILE = path.join(CLEAN_DIR, "players.csv");

const MODE_DRY_RUN = "dry-run";
const MODE_APPLY = "apply";

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function parseArgs() {
  const mode = cleanText(getArg("mode", MODE_DRY_RUN));

  if (mode !== MODE_DRY_RUN && mode !== MODE_APPLY) {
    throw new Error("Modo invalido. Use --mode=dry-run ou --mode=apply.");
  }

  return {
    sourceDir: cleanText(getArg("source-dir")),
    weekStart: cleanText(getArg("week-start")),
    weekEnd: cleanText(getArg("week-end")),
    mode,
    confirmClosedWeek: cleanText(getArg("confirm-closed-week")).toLowerCase() ===
      "true",
  };
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
  const csv = await fs.readFile(filePath, "utf8");
  return parse(csv, { columns: true, skip_empty_lines: true });
}

async function readCsvIfExists(filePath) {
  if (!(await fileExists(filePath))) return [];
  return readCsv(filePath);
}

async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

function uniqueColumns(rows, fallbackColumns) {
  const columns = [...fallbackColumns];
  const seen = new Set(columns);

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  return columns;
}

async function detectSourceLayout(sourceDir) {
  const layouts = [
    {
      name: "direct",
      root: path.resolve(sourceDir),
    },
    {
      name: "archived-data-clean",
      root: path.resolve(sourceDir, "data/clean"),
    },
  ];

  for (const layout of layouts) {
    const missing = [];

    for (const fileName of REQUIRED_SOURCE_FILES) {
      if (!(await fileExists(path.join(layout.root, fileName)))) {
        missing.push(fileName);
      }
    }

    if (missing.length === 0) {
      return layout;
    }
  }

  throw new Error(
    [
      "Arquivos obrigatorios nao encontrados em um layout suportado.",
      `Source dir: ${path.resolve(sourceDir)}`,
      "Layouts aceitos:",
      "- <source-dir>/<arquivo>",
      "- <source-dir>/data/clean/<arquivo>",
      `Arquivos obrigatorios: ${REQUIRED_SOURCE_FILES.join(", ")}`,
    ].join("\n")
  );
}

async function resolveRequiredSourceFiles(sourceDir) {
  const layout = await detectSourceLayout(sourceDir);
  const resolved = {
    _layout: layout.name,
    _root: layout.root,
  };

  for (const fileName of REQUIRED_SOURCE_FILES) {
    resolved[fileName] = path.join(layout.root, fileName);
  }

  const directErrors = path.resolve(sourceDir, "week_results_errors.csv");
  const archivedErrors = path.resolve(
    sourceDir,
    "data/clean/week_results_errors.csv"
  );
  const optionalErrors = [
    path.join(layout.root, "week_results_errors.csv"),
    layout.name === "direct" ? archivedErrors : directErrors,
  ];

  resolved["week_results_errors.csv"] = "";

  for (const candidate of optionalErrors) {
    if (await fileExists(candidate)) {
      resolved["week_results_errors.csv"] = candidate;
      break;
    }
  }

  return resolved;
}

async function validateNextFile(filePath) {
  const rows = await readCsv(filePath);
  const seen = new Set();
  const invalid = [];

  for (const row of rows) {
    const key = buildResultKey(row);

    if (
      !cleanText(row.player_id) ||
      cleanText(row.is_live).toLowerCase() === "true" ||
      !isIsoDate(row.drop_date_calculated) ||
      toNumber(row.points) === null ||
      seen.has(key)
    ) {
      invalid.push(row);
    }

    seen.add(key);
  }

  if (invalid.length > 0) {
    throw new Error(
      `points_ledger.csv.next invalido: ${invalid.length} linhas falharam na validacao final.`
    );
  }
}

async function writeStaging({ stagingDir, plan }) {
  await fs.mkdir(stagingDir, { recursive: true });

  await writeCsv(
    path.join(stagingDir, "points_ledger.next.csv"),
    plan.nextRows,
    LEDGER_COLUMNS
  );
  await writeCsv(path.join(stagingDir, "rows_added.csv"), plan.addedRows, LEDGER_COLUMNS);
  await writeCsv(
    path.join(stagingDir, "rows_replaced.csv"),
    plan.replacedRows,
    LEDGER_COLUMNS
  );
  await writeCsv(
    path.join(stagingDir, "rows_preserved.csv"),
    plan.preservedRows,
    LEDGER_COLUMNS
  );
  await writeCsv(
    path.join(stagingDir, "rows_rejected.csv"),
    plan.rejectedRows,
    uniqueColumns(plan.rejectedRows, [...LEDGER_COLUMNS, "rejection_reason"])
  );
  await writeCsv(path.join(stagingDir, "players_affected.csv"), plan.affectedPlayers, [
    "player_id",
    "player_name",
    "gender",
    "rows_added_or_replaced",
  ]);

  await fs.writeFile(
    path.join(stagingDir, "close_week_report.json"),
    `${JSON.stringify(plan.report, null, 2)}\n`,
    "utf8"
  );
}

async function applyPlan({ weekEnd, plan }) {
  const backupDir = path.resolve("data/backups", `week_close_${weekEnd}`);
  const nextFile = `${POINTS_LEDGER_FILE}.next`;

  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(
    POINTS_LEDGER_FILE,
    path.join(backupDir, "points_ledger.csv")
  );

  try {
    await writeCsv(nextFile, plan.nextRows, LEDGER_COLUMNS);
    await validateNextFile(nextFile);
    await fs.rename(nextFile, POINTS_LEDGER_FILE);
  } catch (err) {
    if (await fileExists(nextFile)) {
      await fs.rm(nextFile, { force: true });
    }

    throw err;
  }

  return backupDir;
}

export async function main() {
  const args = parseArgs();

  if (!args.sourceDir) {
    throw new Error("Informe --source-dir=<diretorio>.");
  }

  if (!args.weekStart || !args.weekEnd) {
    throw new Error("Informe --week-start=YYYY-MM-DD e --week-end=YYYY-MM-DD.");
  }

  if (args.mode === MODE_APPLY && !args.confirmClosedWeek) {
    throw new Error(
      "Apply bloqueado. Use --confirm-closed-week=true somente apos validar que a semana esta encerrada."
    );
  }

  const sourceFiles = await resolveRequiredSourceFiles(args.sourceDir);

  const baseRows = await readCsv(POINTS_LEDGER_FILE);
  const playersRows = await readCsv(PLAYERS_FILE);
  const tournamentRows = await readCsv(sourceFiles["week_tournaments.csv"]);
  const liveRows = await readCsv(sourceFiles["week_live_ledger_rows.csv"]);
  const weekErrorRows = await readCsvIfExists(sourceFiles["week_results_errors.csv"]);

  // Read these required inputs to prove the source directory is complete.
  await readCsv(sourceFiles["week_player_results.csv"]);
  await readCsv(sourceFiles["week_matches.csv"]);

  const plan = buildCloseWeekPlan({
    baseRows,
    playersRows,
    tournamentRows,
    liveRows,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    currentDate: todayIso(),
    weekErrorRows,
  });

  const stagingDir = path.resolve(
    "data/staging",
    `week_close_${args.weekEnd}`
  );

  await writeStaging({ stagingDir, plan });

  console.log("");
  console.log("Fechamento semanal incremental");
  console.log(`Modo: ${args.mode}`);
  console.log(`Semana: ${args.weekStart} ate ${args.weekEnd}`);
  console.log(`Source dir: ${path.resolve(args.sourceDir)}`);
  console.log(`Layout: ${sourceFiles._layout}`);
  console.log(`Staging: ${stagingDir}`);
  console.log("");
  console.log(`Linhas base antes: ${plan.report.base_rows_before}`);
  console.log(`Linhas live recebidas: ${plan.report.live_rows_received}`);
  console.log(`Linhas com pontos > 0: ${plan.report.live_rows_positive_points}`);
  console.log(`Linhas adicionadas: ${plan.report.rows_added}`);
  console.log(`Linhas substituidas: ${plan.report.rows_replaced}`);
  console.log(`Linhas preservadas: ${plan.report.rows_preserved}`);
  console.log(`Linhas rejeitadas: ${plan.report.rows_rejected}`);
  console.log(`Jogadores afetados: ${plan.report.players_affected}`);
  console.log(
    `Linhas expiradas ate week_end: ${plan.report.expired_rows_through_week_end}`
  );
  console.log(`Total final: ${plan.report.total_final}`);
  console.log(`Validacao: ${plan.report.validation_passed ? "OK" : "FALHOU"}`);

  if (plan.report.safety_errors.length > 0) {
    console.log("");
    console.log("Erros de seguranca:");
    for (const error of plan.report.safety_errors) {
      console.log(`- ${error}`);
    }
  }

  if (plan.report.validation_errors.length > 0) {
    console.log("");
    console.log("Erros de validacao:");
    for (const error of plan.report.validation_errors) {
      console.log(`- ${error}`);
    }
  }

  if (args.mode === MODE_DRY_RUN) {
    console.log("");
    console.log("Dry-run concluido. points_ledger.csv nao foi alterado.");
    return;
  }

  if (!plan.report.validation_passed) {
    throw new Error(
      "Apply bloqueado porque a validacao do fechamento nao passou."
    );
  }

  const backupDir = await applyPlan({
    weekEnd: args.weekEnd,
    plan,
  });

  console.log("");
  console.log("Apply concluido.");
  console.log(`Backup: ${backupDir}`);
}

const isCli = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCli) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err?.message || err);
    process.exit(1);
  });
}
