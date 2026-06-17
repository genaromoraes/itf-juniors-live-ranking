import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FINAL_VALIDATION_POLICY,
  NETWORK_MODE_AUTO,
  NETWORK_MODE_BROWSER,
  NETWORK_MODE_DIRECT,
  buildRankingPointsUrl,
  buildReconciledLedger,
  buildPlayersNext,
  fetchSelectedBreakdowns,
  isSafeForPromotion,
  loadReconciliationInputs,
  mapRefreshPlayers,
  runFinalValidation,
  validateInputs,
  validateLedgerForOfficialPlayers,
  writeJson,
  writeReconciliationArtifacts,
} from "./lib/official_breakdown_reconciliation.mjs";
import { cleanText, isIsoDate } from "./lib/weekly_ledger.mjs";
import { TRACKED_BASE_TOTAL } from "./lib/ranking_limits.mjs";

const EXPECTED_OFFICIAL_TOTAL = TRACKED_BASE_TOTAL;

function parseArgs(argv = process.argv.slice(2)) {
  const readArg = (name, fallback = "") => {
    const prefix = `--${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
  };

  const validationDir = cleanText(readArg("validation-dir"));
  const weekCloseDir = cleanText(readArg("week-close-dir"));
  const oldPlayersFile = cleanText(readArg("old-players-file"));
  const outputDir = cleanText(readArg("output-dir"));
  const breakdownCacheDir = cleanText(readArg("breakdown-cache-dir"));

  return {
    validationDir: validationDir ? path.resolve(validationDir) : "",
    weekCloseDir: weekCloseDir ? path.resolve(weekCloseDir) : "",
    oldPlayersFile: oldPlayersFile ? path.resolve(oldPlayersFile) : "",
    rankingDate: cleanText(readArg("ranking-date")),
    dropCutoff: cleanText(readArg("drop-cutoff")),
    outputDir: outputDir ? path.resolve(outputDir) : "",
    breakdownCacheDir: breakdownCacheDir ? path.resolve(breakdownCacheDir) : "",
    networkMode:
      cleanText(readArg("network-mode", NETWORK_MODE_AUTO)).toLowerCase() ||
      NETWORK_MODE_AUTO,
    mode: cleanText(readArg("mode", "dry-run")) || "dry-run",
  };
}

function ensureArg(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validateArgs(args) {
  const errors = [];

  ensureArg(args.validationDir, "Informe --validation-dir.", errors);
  ensureArg(args.weekCloseDir, "Informe --week-close-dir.", errors);
  ensureArg(args.oldPlayersFile, "Informe --old-players-file.", errors);
  ensureArg(args.rankingDate, "Informe --ranking-date=YYYY-MM-DD.", errors);
  ensureArg(args.outputDir, "Informe --output-dir.", errors);
  ensureArg(!args.dropCutoff || isIsoDate(args.dropCutoff), "Use --drop-cutoff=YYYY-MM-DD.", errors);
  if (args.mode === "run") {
    ensureArg(args.dropCutoff, "Informe --drop-cutoff=YYYY-MM-DD em mode=run.", errors);
  }
  ensureArg(
    ["dry-run", "run"].includes(args.mode),
    "Use --mode=dry-run ou --mode=run.",
    errors
  );
  ensureArg(
    [NETWORK_MODE_DIRECT, NETWORK_MODE_BROWSER, NETWORK_MODE_AUTO].includes(
      args.networkMode
    ),
    "Use --network-mode=direct, --network-mode=browser ou --network-mode=auto.",
    errors
  );

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function createLogger(logFile) {
  return {
    async log(message) {
      const line = `[${new Date().toISOString()}] ${message}`;
      console.log(line);
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, `${line}\n`, "utf8");
    },
  };
}

function buildDryRunEndpoints(playersToRefresh) {
  return playersToRefresh.map((row) => buildRankingPointsUrl(row.player_id));
}

export function buildSummary({
  args,
  startedAt,
  finishedAt,
  inputValidation,
  fetchResult,
  ledgerParts,
  ledgerValidation,
  finalValidation,
  safeForPromotion,
}) {
  return {
    ranking_date: args.rankingDate,
    mode: args.mode,
    network_mode: args.networkMode,
    source_validation_dir: args.validationDir,
    source_week_close_dir: args.weekCloseDir,
    old_players_file: args.oldPlayersFile,
    output_dir: args.outputDir,
    breakdown_cache_dir: args.breakdownCacheDir,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_seconds:
      (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    input_guardrails_valid: inputValidation.valid,
    input_guardrail_errors: inputValidation.errors,
    players_to_refresh: inputValidation.playersToRefresh,
    players_to_preserve: inputValidation.playersToPreserve,
    point_difference_players: inputValidation.pointDifferencePlayers,
    new_top500_entrants: inputValidation.newPlayers,
    removed_from_top500: inputValidation.removedPlayers,
    breakdowns_requested: inputValidation.playersToRefresh,
    breakdowns_ok: fetchResult.summaries.filter((row) => row.status === "ok").length,
    breakdowns_failed: fetchResult.errors.length,
    cached_breakdowns: fetchResult.networkReport.cached_breakdowns,
    network_breakdowns: fetchResult.networkReport.network_breakdowns,
    get_rankings_calls: fetchResult.networkReport.get_rankings_calls,
    get_ranking_points_calls: fetchResult.networkReport.get_ranking_points_calls,
    direct_attempts: fetchResult.networkReport.direct_attempts,
    browser_attempts: fetchResult.networkReport.browser_attempts,
    html_responses: fetchResult.networkReport.html_responses,
    incapsula_responses: fetchResult.networkReport.incapsula_responses,
    imperva_responses: fetchResult.networkReport.imperva_responses,
    http_403: fetchResult.networkReport.http_403,
    timeouts: fetchResult.networkReport.timeouts,
    ledger_rows_preserved: ledgerParts.preservedRows.length,
    ledger_rows_refreshed_removed: ledgerParts.refreshedOldRows.length,
    ledger_rows_added_from_breakdowns: ledgerParts.addedRows.length,
    removed_players_ledger_rows_archived: ledgerParts.removedArchiveRows.length,
    final_ledger_rows: ledgerParts.nextRows.length,
    ledger_validation_passed: ledgerValidation.valid,
    ledger_validation_errors: ledgerValidation.errors,
    final_validation_policy: finalValidation.finalValidationPolicy,
    final_drop_cutoff: finalValidation.finalDropCutoff,
    final_expired_rows_ignored: finalValidation.finalExpiredRowsIgnored,
    final_total: finalValidation.finalTotal,
    final_exact: finalValidation.finalExact,
    final_percentage: finalValidation.finalPercentage,
    final_divergent: finalValidation.finalDivergent,
    final_missing_ledger: finalValidation.finalMissingLedger,
    unique_ledger_players: finalValidation.uniqueLedgerPlayers,
    ledger_players_outside_official:
      finalValidation.ledgerPlayersOutsideOfficial,
    expected_official_total: EXPECTED_OFFICIAL_TOTAL,
    mode_safe_for_promotion: safeForPromotion,
  };
}

export async function runReconciliation(args, deps = {}) {
  validateArgs(args);
  const outputDir = args.outputDir;
  const logFile = path.join(outputDir, "validation_run.log");
  const logger = deps.logger || createLogger(logFile);
  const startedAt = new Date().toISOString();

  if (args.mode === "dry-run") {
    const inputs = await loadReconciliationInputs(args);
    const inputValidation = validateInputs({
      ...inputs,
      rankingDate: args.rankingDate,
    });

    console.log("Dry-run validado com sucesso.");
    console.log(`validation-dir: ${args.validationDir}`);
    console.log(`week-close-dir: ${args.weekCloseDir}`);
    console.log(`old-players-file: ${args.oldPlayersFile}`);
    console.log(`ranking-date: ${args.rankingDate}`);
    console.log(`final-validation-policy: ${FINAL_VALIDATION_POLICY}`);
    console.log(`final-drop-cutoff: ${args.dropCutoff}`);
    console.log(`network-mode: ${args.networkMode}`);
    console.log(`breakdown-cache-dir: ${args.breakdownCacheDir}`);
    console.log(`players-to-refresh: ${inputValidation.playersToRefresh}`);
    console.log("endpoints PlayerRankApi/GetRankingPoints:");
    for (const endpoint of buildDryRunEndpoints(inputs.playersToRefresh)) {
      console.log(endpoint);
    }

    if (!inputValidation.valid) {
      throw new Error(inputValidation.errors.join("\n"));
    }

    return {
      dryRun: true,
      inputValidation,
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  await logger.log("Iniciando reconciliacao seletiva de breakdowns oficiais.");
  const inputs = await loadReconciliationInputs(args);
  const inputValidation = validateInputs({
    ...inputs,
    rankingDate: args.rankingDate,
  });

  await writeJson(path.join(outputDir, "input_guardrails.json"), inputValidation);

  if (!inputValidation.valid) {
    throw new Error(inputValidation.errors.join("\n"));
  }

  await logger.log(
    `Guardrails aprovados. Jogadores a atualizar: ${inputValidation.playersToRefresh}.`
  );

  const refreshPlayers = mapRefreshPlayers(
    inputs.playersToRefresh,
    inputs.officialPlayers
  );
  const fetchResult = await fetchSelectedBreakdowns({
    players: refreshPlayers,
    outputDir,
    networkMode: args.networkMode,
    breakdownCacheDir: args.breakdownCacheDir,
    deps,
  });

  const playersNext = buildPlayersNext({
    officialPlayers: inputs.officialPlayers,
    oldPlayers: inputs.oldPlayers,
  });
  const ledgerParts = buildReconciledLedger({
    weekCloseLedgerRows: inputs.weekCloseLedgerRows,
    playersNextRows: playersNext,
    playersToRefresh: inputs.playersToRefresh,
    removedPlayers: inputs.removedPlayers,
    breakdownRowsByPlayer: fetchResult.byPlayerId,
  });
  const ledgerValidation = validateLedgerForOfficialPlayers({
    ledgerRows: ledgerParts.nextRows,
    playersNextRows: playersNext,
  });
  const finalValidation = runFinalValidation({
    ledgerRows: ledgerParts.nextRows,
    snapshotRows: inputs.officialSnapshot,
    dropCutoff: args.dropCutoff,
    policy: FINAL_VALIDATION_POLICY,
  });
  const safeForPromotion = isSafeForPromotion({
    inputValidation,
    fetchResult,
    ledgerValidation,
    finalValidation,
    expectedOfficialTotal: EXPECTED_OFFICIAL_TOTAL,
  });
  const finishedAt = new Date().toISOString();
  const summary = buildSummary({
    args,
    startedAt,
    finishedAt,
    inputValidation,
    fetchResult,
    ledgerParts,
    ledgerValidation,
    finalValidation,
    safeForPromotion,
  });

  await writeReconciliationArtifacts({
    outputDir,
    playersNext,
    snapshotNext: inputs.officialSnapshot,
    ledgerNext: ledgerParts.nextRows,
    fetchResult,
    playersToRefresh: inputs.playersToRefresh,
    playersToPreserve: inputs.playersToPreserve,
    newEntrants: inputs.newEntrants,
    removedPlayers: inputs.removedPlayers,
    removedArchiveRows: ledgerParts.removedArchiveRows,
    finalValidation,
    summary,
  });

  await logger.log(
    `Validacao final: ${finalValidation.finalExact}/${finalValidation.finalTotal}.`
  );

  if (!safeForPromotion) {
    throw new Error(
      `Reconciliacao nao ficou segura para promocao: ${finalValidation.finalExact}/${EXPECTED_OFFICIAL_TOTAL} reconciliados.`
    );
  }

  await logger.log("Reconciliacao seletiva concluida e segura para promocao.");
  return {
    summary,
    fetchResult,
    finalValidation,
  };
}

async function main() {
  const args = parseArgs();
  await runReconciliation(args);
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
