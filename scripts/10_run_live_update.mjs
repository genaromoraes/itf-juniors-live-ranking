import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = process.cwd();

const LOG_DIR = path.resolve("logs");
const RUN_LOG_FILE = path.join(LOG_DIR, "live_update_last_run.log");
const DEFAULT_PIPELINE_TIMEOUT_MS = 32 * 60 * 1000;
const PIPELINE_TIMEOUT_MS_ENV = Number(process.env.ITF_PIPELINE_TIMEOUT_MS);
const PIPELINE_TIMEOUT_MS =
  Number.isFinite(PIPELINE_TIMEOUT_MS_ENV) && PIPELINE_TIMEOUT_MS_ENV > 0
    ? PIPELINE_TIMEOUT_MS_ENV
    : DEFAULT_PIPELINE_TIMEOUT_MS;

const STEPS = [
  {
    name: "Buscar torneios da semana",
    command: "node",
    args: ["scripts/04_fetch_week_tournaments.mjs"],
    requiredOutputs: ["data/clean/week_tournaments.csv"],
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
      "data/clean/live_combined_ledger_with_drops.csv",
      "data/clean/live_dropped_points.csv",
      "data/clean/live_ranking_with_drops.csv",
      "data/clean/live_ranking_with_drops_top500.csv",
      "data/clean/live_ranking_with_drops_changes.csv",
    ],
  },
  {
    name: "Gerar página HTML principal",
    command: "node",
    args: ["scripts/09_generate_live_ranking_html.mjs"],
    requiredOutputs: ["data/exports/live_ranking.html"],
  },
  {
    name: "Gerar auditoria por jogador",
    command: "node",
    args: ["scripts/11_generate_player_audit.mjs"],
    requiredOutputs: [
      "data/audit/player_audit_summary.csv",
      "data/audit/player_audit_details.csv",
      "data/audit/player_audit_brazilians.csv",
      "data/audit/player_audit.html",
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

class PipelineTimeoutError extends Error {
  constructor(pipelineTimeoutMs, stepName = "") {
    const limit = formatDuration(pipelineTimeoutMs);
    const stepSuffix = stepName ? ` na etapa "${stepName}"` : "";

    super(
      `A atualização excedeu o limite total de ${limit}${stepSuffix} e foi interrompida de forma controlada.`
    );

    this.name = "PipelineTimeoutError";
    this.pipelineTimeoutMs = pipelineTimeoutMs;
    this.stepName = stepName;
  }
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

function runCommand(step, pipelineStartedAt, pipelineTimeoutMs) {
  const elapsedBeforeStart = Date.now() - pipelineStartedAt;
  const remainingMs = pipelineTimeoutMs - elapsedBeforeStart;

  if (remainingMs <= 0) {
    throw new PipelineTimeoutError(pipelineTimeoutMs, step.name);
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let pipelineTimer = null;
    let forceKillTimer = null;

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

    const cleanup = () => {
      if (pipelineTimer) {
        clearTimeout(pipelineTimer);
        pipelineTimer = null;
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const stopChildProcess = () => {
      if (!child.pid) {
        return;
      }

      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          {
            stdio: "ignore",
            shell: false,
          }
        );

        killer.on("error", () => {
          // ignora falha ao tentar encerrar processo
        });

        return;
      }

      try {
        child.kill("SIGTERM");
      } catch {
        // ignora falha ao tentar encerrar processo
      }

      forceKillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignora falha ao tentar encerrar processo
        }
      }, 5000);
    };

    pipelineTimer = setTimeout(() => {
      timedOut = true;

      const timeoutError = new PipelineTimeoutError(pipelineTimeoutMs, step.name);

      console.error("");
      console.error(`Limite total atingido durante a etapa: ${step.name}`);
      appendLog(`TIMEOUT: ${timeoutError.message}`).catch(() => {});

      stopChildProcess();
    }, remainingMs);

    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      appendLog(text.trimEnd()).catch(() => {
        // ignora erro de escrita no log
      });
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);
      appendLog(text.trimEnd()).catch(() => {
        // ignora erro de escrita no log
      });
    });

    child.on("error", (error) => {
      if (timedOut) {
        settleReject(new PipelineTimeoutError(pipelineTimeoutMs, step.name));
        return;
      }

      settleReject(error);
    });

    child.on("close", (code) => {
      const duration = formatDuration(Date.now() - startedAt);

      if (timedOut) {
        console.error(`Etapa interrompida por timeout global: ${step.name}`);
        settleReject(new PipelineTimeoutError(pipelineTimeoutMs, step.name));
        return;
      }

      if (code === 0) {
        console.log("");
        console.log(`✅ Etapa concluída: ${step.name} (${duration})`);
        settleResolve();
      } else {
        settleReject(
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
  console.log("Arquivos de auditoria gerados:");
  console.log("data/audit/player_audit_summary.csv");
  console.log("data/audit/player_audit_details.csv");
  console.log("data/audit/player_audit_brazilians.csv");
  console.log("data/audit/player_audit.html");
  console.log("");
  console.log("Abra o live ranking no navegador:");
  console.log(
    `file:///${path.resolve("data/exports/live_ranking.html").replaceAll("\\", "/")}`
  );
  console.log("");
  console.log("Abra a auditoria no navegador:");
  console.log(
    `file:///${path.resolve("data/audit/player_audit.html").replaceAll("\\", "/")}`
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
  await appendLog(`Limite total do pipeline: ${formatDuration(PIPELINE_TIMEOUT_MS)}`);

  console.log("");
  console.log("==================================================");
  console.log("ITF JUNIORS LIVE RANKING — UPDATE COMPLETO");
  console.log("==================================================");
  console.log(`Início: ${nowIso()}`);
  console.log(`Limite total do pipeline: ${formatDuration(PIPELINE_TIMEOUT_MS)}`);
  console.log("");

  for (const step of STEPS) {
    if (Date.now() - startedAt >= PIPELINE_TIMEOUT_MS) {
      throw new PipelineTimeoutError(PIPELINE_TIMEOUT_MS, step.name);
    }

    await appendLog("");
    await appendLog("==================================================");
    await appendLog(`STEP: ${step.name}`);
    await appendLog("==================================================");

    await runCommand(step, startedAt, PIPELINE_TIMEOUT_MS);

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

  if (err instanceof PipelineTimeoutError) {
    console.error(
      `A atualização excedeu o limite total de ${formatDuration(err.pipelineTimeoutMs)} e foi interrompida de forma controlada.`
    );
  } else {
    console.error(err.message || err);
  }

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
