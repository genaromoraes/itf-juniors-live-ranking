import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = process.cwd();
const LOG_DIR = path.resolve("logs");
const RUN_LOG_FILE = path.join(LOG_DIR, "start_week_last_run.log");

const DEFAULT_LIVE_FILE = "data/clean/live_ranking_with_drops.csv";

const WEEKLY_ARTIFACTS = [
  "data/clean/week_tournaments.csv",
  "data/clean/week_tournaments_debug_all.csv",
  "data/clean/week_matches.csv",
  "data/clean/week_player_results.csv",
  "data/clean/week_results_errors.csv",
  "data/clean/week_results_summary.csv",
  "data/clean/week_live_points.csv",
  "data/clean/week_live_ledger_rows.csv",
  "data/clean/live_combined_ledger_with_drops.csv",
  "data/clean/live_dropped_points.csv",
  "data/clean/live_ranking_with_drops.csv",
  "data/clean/live_ranking_with_drops_top500.csv",
  "data/clean/live_ranking_with_drops_changes.csv",
  "data/exports/live_ranking.html",
  "data/exports/index.html",
  "data/audit/player_audit_summary.csv",
  "data/audit/player_audit_details.csv",
  "data/audit/player_audit_brazilians.csv",
  "data/audit/player_audit.html",
];

function nowIso() {
  return new Date().toISOString();
}

function timestampForPath() {
  return nowIso().replaceAll(":", "").replaceAll(".", "");
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${minutes}min ${restSeconds}s`;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

async function ensureDirs() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function appendLog(message = "") {
  await fs.appendFile(RUN_LOG_FILE, `${message}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(path.resolve(filePath));
    return true;
  } catch {
    return false;
  }
}

async function moveIfExists(sourcePath, archiveRoot) {
  const absoluteSource = path.resolve(sourcePath);

  if (!(await fileExists(absoluteSource))) {
    return null;
  }

  const relative = path.relative(PROJECT_ROOT, absoluteSource);
  const target = path.join(archiveRoot, relative);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(absoluteSource, target);

  return {
    source: relative,
    target: path.relative(PROJECT_ROOT, target),
  };
}

async function archiveWeeklyArtifacts() {
  const archiveRoot = path.resolve(
    "data/raw/week_rollovers",
    timestampForPath()
  );
  const moved = [];

  for (const filePath of WEEKLY_ARTIFACTS) {
    const result = await moveIfExists(filePath, archiveRoot);

    if (result) moved.push(result);
  }

  return {
    archiveRoot,
    moved,
  };
}

async function previewWeeklyArtifacts() {
  const existing = [];

  for (const filePath of WEEKLY_ARTIFACTS) {
    if (await fileExists(filePath)) {
      existing.push(filePath);
    }
  }

  return existing;
}

function runCommand(step) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    console.log("");
    console.log("==================================================");
    console.log(`> ${step.name}`);
    console.log("==================================================");
    console.log(`Comando: ${step.command} ${step.args.join(" ")}`);
    console.log("");

    const child = spawn(step.command, step.args, {
      cwd: PROJECT_ROOT,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "1",
      },
    });

    child.stdout.on("data", async (data) => {
      const text = data.toString();
      process.stdout.write(text);
      await appendLog(text.trimEnd());
    });

    child.stderr.on("data", async (data) => {
      const text = data.toString();
      process.stderr.write(text);
      await appendLog(text.trimEnd());
    });

    child.on("error", reject);

    child.on("close", (code) => {
      const duration = formatDuration(Date.now() - startedAt);

      if (code === 0) {
        console.log("");
        console.log(`Etapa concluida: ${step.name} (${duration})`);
        resolve();
      } else {
        reject(
          new Error(
            `A etapa "${step.name}" falhou com codigo ${code}. Veja o log em ${RUN_LOG_FILE}`
          )
        );
      }
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const skipReconcile = hasFlag("skip-reconcile");
  const skipFetch = hasFlag("skip-fetch");
  const dryRun = hasFlag("dry-run");
  const liveFile = getArg("live-file", DEFAULT_LIVE_FILE);

  await ensureDirs();

  await fs.writeFile(
    RUN_LOG_FILE,
    `ITF Juniors start week started at ${nowIso()}\n\n`,
    "utf8"
  );

  console.log("");
  console.log("==================================================");
  console.log("ITF JUNIORS LIVE RANKING - VIRADA DE SEMANA");
  console.log("==================================================");
  console.log(`Inicio: ${nowIso()}`);
  if (dryRun) console.log("Modo dry-run: nenhuma alteracao sera feita.");
  console.log("");

  if (dryRun) {
    console.log("Etapas que seriam executadas:");
    console.log(
      skipReconcile
        ? "- reconciliacao oficial: pulada"
        : `- reconciliacao oficial usando ${liveFile}`
    );
    console.log("- arquivar artefatos semanais antigos");
    console.log(
      skipFetch
        ? "- coleta da semana nova: pulada"
        : "- update completo da semana nova"
    );

    const existing = await previewWeeklyArtifacts();

    console.log("");
    console.log("Artefatos semanais que seriam arquivados:");

    if (existing.length) {
      for (const filePath of existing) console.log(`- ${filePath}`);
    } else {
      console.log("- nenhum artefato semanal antigo encontrado");
    }

    return;
  }

  if (!skipReconcile) {
    await runCommand({
      name: "Reconciliar base com ranking oficial ITF",
      command: "node",
      args: [
        "scripts/12_reconcile_official_ranking.mjs",
        "--mode=diff",
        `--live-file=${liveFile}`,
      ],
    });
  } else {
    console.log("Pulando reconciliacao oficial (--skip-reconcile).");
  }

  const archive = await archiveWeeklyArtifacts();

  console.log("");
  console.log("Artefatos semanais arquivados:");
  console.log(path.relative(PROJECT_ROOT, archive.archiveRoot));

  if (archive.moved.length) {
    for (const item of archive.moved) {
      console.log(`- ${item.source} -> ${item.target}`);
      await appendLog(`ARCHIVED ${item.source} -> ${item.target}`);
    }
  } else {
    console.log("- nenhum artefato semanal antigo encontrado");
  }

  if (!skipFetch) {
    await runCommand({
      name: "Buscar torneios/resultados da semana nova e gerar live ranking",
      command: "node",
      args: ["scripts/10_run_live_update.mjs"],
    });
  } else {
    console.log("");
    console.log("Pulando coleta da semana nova (--skip-fetch).");
  }

  console.log("");
  console.log("==================================================");
  console.log("VIRADA DE SEMANA FINALIZADA");
  console.log("==================================================");
  console.log(`Duracao total: ${formatDuration(Date.now() - startedAt)}`);
  console.log(`Log salvo em: ${RUN_LOG_FILE}`);
}

main().catch(async (err) => {
  console.error("");
  console.error("==================================================");
  console.error("VIRADA DE SEMANA INTERROMPIDA");
  console.error("==================================================");
  console.error(err.message || err);
  console.error("");
  console.error(`Veja o log em: ${RUN_LOG_FILE}`);

  try {
    await appendLog("");
    await appendLog("FAILED");
    await appendLog(err.stack || String(err));
  } catch {
    // ignora erro de escrita no log
  }

  process.exit(1);
});
