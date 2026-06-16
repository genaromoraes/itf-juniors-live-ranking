import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const MODE_DRY_RUN = "dry-run";
const MODE_RUN = "run";
const REQUIRED_ARTIFACTS = [
  "week_tournaments.csv",
  "week_tournaments_debug_all.csv",
  "week_matches.csv",
  "week_player_results.csv",
  "week_results_errors.csv",
  "week_results_summary.csv",
  "week_live_points.csv",
  "week_live_ledger_rows.csv",
  path.join("raw", "week_tournaments.json"),
];

function getArg(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function parseIsoDateUtc(value, label) {
  const text = cleanText(value);

  if (!isIsoDate(text)) {
    throw new Error(`${label} invalida. Use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} invalida. Use YYYY-MM-DD.`);
  }

  return parsed;
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function toCsvCount(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

export function parseArgs(argv = process.argv.slice(2)) {
  return {
    weekStart: cleanText(getArg("week-start", argv)),
    weekEnd: cleanText(getArg("week-end", argv)),
    outputDir: cleanText(getArg("output-dir", argv)),
    mode: cleanText(getArg("mode", argv)) || MODE_DRY_RUN,
  };
}

export function buildBackfillConfig(args = parseArgs(), now = new Date()) {
  if (!args.weekStart || !args.weekEnd) {
    throw new Error("Informe --week-start=YYYY-MM-DD e --week-end=YYYY-MM-DD.");
  }

  if (args.mode !== MODE_DRY_RUN && args.mode !== MODE_RUN) {
    throw new Error("Modo invalido. Use --mode=dry-run ou --mode=run.");
  }

  const weekStartDate = parseIsoDateUtc(args.weekStart, "week-start");
  const weekEndDate = parseIsoDateUtc(args.weekEnd, "week-end");

  if (weekStartDate.getTime() > weekEndDate.getTime()) {
    throw new Error("week-start nao pode ser posterior a week-end.");
  }

  const currentDateIso = todayIso(now);

  if (toIsoDateUtc(weekEndDate) >= currentDateIso) {
    throw new Error(
      `Backfill bloqueado. week-end (${toIsoDateUtc(weekEndDate)}) precisa ser anterior a ${currentDateIso} em UTC.`
    );
  }

  const outputDir = args.outputDir
    ? path.resolve(args.outputDir)
    : path.resolve("data/backfills", `week_${args.weekStart}_${args.weekEnd}`);

  return {
    weekStart: toIsoDateUtc(weekStartDate),
    weekEnd: toIsoDateUtc(weekEndDate),
    searchStart: toIsoDateUtc(addUtcDays(weekStartDate, -2)),
    searchEnd: toIsoDateUtc(weekEndDate),
    outputDir,
    rawDir: path.join(outputDir, "raw"),
    rawResultsDir: path.join(outputDir, "raw", "week_results"),
    logFile: path.join(outputDir, "backfill.log"),
    reportFile: path.join(outputDir, "backfill_report.json"),
    mode: args.mode,
  };
}

export function buildStepCommands(config) {
  return [
    {
      name: "Buscar torneios historicos",
      command: process.execPath,
      args: [
        "scripts/04_fetch_week_tournaments.mjs",
        `--week-start=${config.weekStart}`,
        `--week-end=${config.weekEnd}`,
        `--output-dir=${config.outputDir}`,
      ],
    },
    {
      name: "Buscar resultados historicos",
      command: process.execPath,
      args: [
        "scripts/05_fetch_week_results.mjs",
        `--input-dir=${config.outputDir}`,
        `--output-dir=${config.outputDir}`,
      ],
    },
    {
      name: "Calcular pontos live historicos",
      command: process.execPath,
      args: [
        "scripts/06_calculate_week_live_points.mjs",
        `--input-dir=${config.outputDir}`,
        `--output-dir=${config.outputDir}`,
      ],
    },
  ];
}

async function appendLog(logFile, message = "") {
  await fs.appendFile(logFile, `${message}\n`, "utf8");
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

async function assertFileExists(filePath) {
  if (!(await fileExists(filePath))) {
    throw new Error(`Arquivo obrigatorio ausente: ${filePath}`);
  }
}

function errorLooksBlocked(message) {
  const text = cleanText(message).toLowerCase();

  return (
    text.includes("http 403") ||
    text.includes("incapsula") ||
    text.includes("imperva") ||
    text.includes("_incapsula_resource") ||
    text.includes("<html") ||
    text.includes("text/html")
  );
}

export async function validateBackfillArtifacts(config) {
  const validationErrors = [];

  for (const relativeFile of REQUIRED_ARTIFACTS) {
    const filePath = path.join(config.outputDir, relativeFile);

    if (!(await fileExists(filePath))) {
      validationErrors.push(`Arquivo obrigatorio ausente: ${relativeFile}`);
    }
  }

  if (!(await fileExists(config.rawResultsDir))) {
    validationErrors.push("Diretorio raw/week_results ausente.");
  }

  if (validationErrors.length > 0) {
    return {
      validation_passed: false,
      validation_errors: validationErrors,
      tournaments: 0,
      events: 0,
      matches: 0,
      player_results: 0,
      live_ledger_rows: 0,
      errors: 0,
    };
  }

  const tournaments = await readCsv(path.join(config.outputDir, "week_tournaments.csv"));
  const summaries = await readCsv(path.join(config.outputDir, "week_results_summary.csv"));
  const matches = await readCsv(path.join(config.outputDir, "week_matches.csv"));
  const playerResults = await readCsv(path.join(config.outputDir, "week_player_results.csv"));
  const errorRows = await readCsv(path.join(config.outputDir, "week_results_errors.csv"));
  const liveLedgerRows = await readCsv(path.join(config.outputDir, "week_live_ledger_rows.csv"));
  await readCsv(path.join(config.outputDir, "week_live_points.csv"));
  await readCsv(path.join(config.outputDir, "week_tournaments_debug_all.csv"));

  if (tournaments.length === 0) {
    validationErrors.push("week_tournaments.csv esta vazio.");
  }

  for (const row of tournaments) {
    if (row.week_start !== config.weekStart || row.week_end !== config.weekEnd) {
      validationErrors.push(
        `Torneio fora da semana informada: ${row.tournament_name || row.tournament_key || "[sem nome]"}`
      );
      break;
    }
  }

  if (matches.length === 0) {
    validationErrors.push("week_matches.csv esta vazio.");
  }

  if (playerResults.length === 0) {
    validationErrors.push("week_player_results.csv esta vazio.");
  }

  if (liveLedgerRows.length === 0) {
    validationErrors.push("week_live_ledger_rows.csv esta vazio.");
  }

  const blockedErrors = errorRows.filter((row) => errorLooksBlocked(row.error_message));

  if (blockedErrors.length > 0) {
    validationErrors.push(
      `Bloqueio/HTML detectado em week_results_errors.csv (${blockedErrors.length} ocorrencias).`
    );
  }

  const logText = (await fs.readFile(config.logFile, "utf8")).toLowerCase();

  if (logText.includes("erro fatal")) {
    validationErrors.push("O log registrou erro fatal.");
  }

  if (errorLooksBlocked(logText)) {
    validationErrors.push("O log registrou HTTP 403 ou HTML/Incapsula/Imperva.");
  }

  const events = summaries.reduce((total, row) => total + Number(row.events_found || 0), 0);

  return {
    validation_passed: validationErrors.length === 0,
    validation_errors: validationErrors,
    tournaments: toCsvCount(tournaments),
    events,
    matches: toCsvCount(matches),
    player_results: toCsvCount(playerResults),
    live_ledger_rows: toCsvCount(liveLedgerRows),
    errors: toCsvCount(errorRows),
  };
}

async function defaultRunner(step, config) {
  await appendLog(config.logFile, "");
  await appendLog(config.logFile, `STEP: ${step.name}`);
  await appendLog(config.logFile, `${step.command} ${step.args.join(" ")}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      appendLog(config.logFile, text.trimEnd()).catch(() => {});
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      appendLog(config.logFile, text.trimEnd()).catch(() => {});
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`A etapa "${step.name}" falhou com codigo ${code}.`));
      }
    });
  });
}

async function writeReport(config, report) {
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.writeFile(config.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function main({
  argv = process.argv.slice(2),
  now = new Date(),
  runner = defaultRunner,
} = {}) {
  const startedAt = new Date();
  const config = buildBackfillConfig(parseArgs(argv), now);
  const steps = buildStepCommands(config);

  if (config.mode === MODE_DRY_RUN) {
    console.log("");
    console.log("Backfill historico da semana");
    console.log(`Modo: ${config.mode}`);
    console.log(`Semana: ${config.weekStart} ate ${config.weekEnd}`);
    console.log(`Janela de busca: ${config.searchStart} ate ${config.searchEnd}`);
    console.log(`Output dir: ${config.outputDir}`);
    console.log("");
    console.log("Comandos planejados:");
    for (const step of steps) {
      console.log(`${step.command} ${step.args.join(" ")}`);
    }
    console.log("");
    console.log("Dry-run concluido. Nenhum arquivo foi criado ou alterado.");
    return;
  }

  await fs.mkdir(config.rawResultsDir, { recursive: true });
  await fs.writeFile(
    config.logFile,
    `Backfill started at ${startedAt.toISOString()}\nSemana: ${config.weekStart} ate ${config.weekEnd}\n`,
    "utf8"
  );

  let validation = {
    validation_passed: false,
    validation_errors: [],
    tournaments: 0,
    events: 0,
    matches: 0,
    player_results: 0,
    live_ledger_rows: 0,
    errors: 0,
  };
  let fatalError = "";

  try {
    for (const step of steps) {
      await runner(step, config);
    }

    validation = await validateBackfillArtifacts(config);

    if (!validation.validation_passed) {
      throw new Error(validation.validation_errors.join("\n"));
    }
  } catch (err) {
    fatalError = err?.message || String(err);
    await appendLog(config.logFile, "");
    await appendLog(config.logFile, `ERRO FATAL: ${fatalError}`);
    throw err;
  } finally {
    const finishedAt = new Date();
    const report = {
      week_start: config.weekStart,
      week_end: config.weekEnd,
      search_start: config.searchStart,
      search_end: config.searchEnd,
      tournaments: validation.tournaments,
      events: validation.events,
      matches: validation.matches,
      player_results: validation.player_results,
      live_ledger_rows: validation.live_ledger_rows,
      errors: validation.errors,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration: `${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s`,
      validation_passed: validation.validation_passed && !fatalError,
      validation_errors: validation.validation_errors,
      fatal_error: fatalError,
    };

    await writeReport(config, report);
  }
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
