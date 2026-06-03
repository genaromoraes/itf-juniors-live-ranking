import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = process.cwd();

const LOG_DIR = path.resolve("logs");
const RUN_LOG_FILE = path.join(LOG_DIR, "live_update_last_run.log");

const STEPS = [
  {
    name: "Buscar torneios da semana",
    command: "node",
    args: ["scripts/04_fetch_week_tournaments.mjs"],
    requiredOutputs: [
      "data/clean/week_tournaments.csv",
    ],
  },
  {
    name: "Buscar resultados da semana",
    command: "node",
    args: ["scripts/05_fetch_week_results.mjs"],
    requiredOutputs: [
      "data/clean/week_matches.csv",
      "data/clean/week_player_results.csv",
    ],
  },
  {
    name: "Calcular pontos live da semana",
    command: "node",
    args: ["scripts/06_calculate_week_live_points.mjs"],
    requiredOutputs: [
      "data/clean/week_live_points.csv",
      "data/clean/week_live_ledger_rows.csv",
    ],
  },
  {
    name: "Calcular live ranking com drops",
    command: "node",
    args: ["scripts/08_calculate_live_ranking_with_drops.mjs"],
    requiredOutputs: [
      "data/clean/live_ranking_with_drops.csv",
      "data/clean/live_ranking_with_drops_top500.csv",
      "data/clean/live_ranking_with_drops_changes.csv",
    ],
  },
  {
    name: "Gerar página HTML",
    command: "node",
    args: ["scripts/09_generate_live_ranking_html.mjs"],
    requiredOutputs: [
      "data/exports/live_ranking.html",
    ],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${minutes}min ${restSeconds}s`;
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

async function checkRequiredOutputs(step) {
  const missing = [];

  for (const output of step.requiredOutputs || []) {
    const exists = await fileExists(output);

    if (!exists) {
      missing.push(output);
    }
  }

  return missing;
}

function runCommand(step) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    console.log("");
    console.log("==================================================");
    console.log(`▶ ${step.name}`);
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
        console.log(`✅ Etapa concluída: ${step.name} (${duration})`);
        resolve();
      } else {
        reject(
          new Error(
            `A etapa "${step.name}" falhou com código ${code}. Veja o log em ${RUN_LOG_FILE}`
          )
        );
      }
    });
  });
}

async function printFinalSummary(startedAt) {
  const duration = formatDuration(Date.now() - startedAt);

  console.log("");
  console.log("==================================================");
  console.log("✅ ATUALIZAÇÃO FINALIZADA COM SUCESSO");
  console.log("==================================================");
  console.log(`Duração total: ${duration}`);
  console.log("");
  console.log("Arquivos principais gerados:");
  console.log("data/clean/week_tournaments.csv");
  console.log("data/clean/week_matches.csv");
  console.log("data/clean/week_player_results.csv");
  console.log("data/clean/week_live_points.csv");
  console.log("data/clean/week_live_ledger_rows.csv");
  console.log("data/clean/live_ranking_with_drops.csv");
  console.log("data/exports/live_ranking.html");
  console.log("");
  console.log("Abra no navegador:");
  console.log(
    `file:///${path.resolve("data/exports/live_ranking.html").replaceAll("\\", "/")}`
  );
  console.log("");
  console.log(`Log salvo em: ${RUN_LOG_FILE}`);
}

async function main() {
  const startedAt = Date.now();

  await ensureDirs();

  await fs.writeFile(
    RUN_LOG_FILE,
    `ITF Juniors live update started at ${nowIso()}\n\n`,
    "utf8"
  );

  console.log("");
  console.log("==================================================");
  console.log("ITF JUNIORS LIVE RANKING — UPDATE COMPLETO");
  console.log("==================================================");
  console.log(`Início: ${nowIso()}`);
  console.log("");

  for (const step of STEPS) {
    await appendLog("");
    await appendLog("==================================================");
    await appendLog(`STEP: ${step.name}`);
    await appendLog("==================================================");

    await runCommand(step);

    const missingOutputs = await checkRequiredOutputs(step);

    if (missingOutputs.length) {
      throw new Error(
        [
          `A etapa "${step.name}" terminou, mas alguns arquivos esperados não foram encontrados:`,
          ...missingOutputs.map((file) => `- ${file}`),
        ].join("\n")
      );
    }
  }

  await printFinalSummary(startedAt);
}

main().catch(async (err) => {
  console.error("");
  console.error("==================================================");
  console.error("❌ ATUALIZAÇÃO INTERROMPIDA");
  console.error("==================================================");
  console.error(err.message || err);
  console.error("");
  console.error(`Veja o log em: ${RUN_LOG_FILE}`);

  try {
    await appendLog("");
    await appendLog("FAILED");
    await appendLog(err.stack || String(err));
  } catch {
    // ignore log write errors
  }

  process.exit(1);
});