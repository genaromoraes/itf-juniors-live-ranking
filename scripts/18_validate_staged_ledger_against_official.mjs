import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  BASELINE_POLICY,
  STAGED_POLICY,
  BASELINE_VALIDATION_COLUMNS,
  GENDERS,
  OFFICIAL_COMPARISON_COLUMNS,
  OFFICIAL_PLAYER_COLUMNS,
  OFFICIAL_SNAPSHOT_COLUMNS,
  PAGE_SIZE,
  STAGED_CALCULATED_COLUMNS,
  TOP_LIMIT,
  REQUEST_TIMEOUT_MS,
  buildOfficialSnapshotRow,
  buildRankingUrl,
  buildValidationSummary,
  calculateLedgerPoints,
  classifyPlayers,
  cleanText,
  compareCalculatedAgainstSnapshot,
  detectBlockedHtml,
  normalizeOfficialPlayer,
  normalizeRankingDate,
  readCsv,
  sha256File,
  sleep,
  validateLedgerRows,
  validateOfficialSnapshotRows,
  writeCsv,
  writeJson,
} from "./lib/official_ledger_validation.mjs";

export const NETWORK_MODE_DIRECT = "direct";
export const NETWORK_MODE_BROWSER = "browser";
export const NETWORK_MODE_AUTO = "auto";
export const DIRECT_MAX_RETRIES = 2;
export const DIRECT_RETRY_DELAY_MS = 15000;
export const BETWEEN_PAGES_DELAY_MS = 750;
export const RANKING_PAGE_URL =
  "https://www.itftennis.com/en/rankings/juniors/";
export const NETWORK_ATTEMPT_COLUMNS = [
  "timestamp",
  "network_mode",
  "gender",
  "skip",
  "attempt",
  "url",
  "http_status",
  "content_type",
  "elapsed_ms",
  "response_bytes",
  "json_valid",
  "items_found",
  "rank_date",
  "blocked_html",
  "incapsula_detected",
  "imperva_detected",
  "captcha_detected",
  "timeout",
  "error_message",
  "raw_response_file",
];

export class OfficialCollectionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OfficialCollectionError";
    Object.assign(this, details);
  }
}

export function createDefaultNetworkReport(networkModeRequested) {
  return {
    network_mode_requested: networkModeRequested,
    direct_attempts: 0,
    browser_attempts: 0,
    successful_pages: 0,
    cached_pages: 0,
    failed_pages: 0,
    html_responses: 0,
    incapsula_responses: 0,
    imperva_responses: 0,
    captcha_responses: 0,
    http_403: 0,
    timeouts: 0,
    ranking_pages_expected: (TOP_LIMIT / PAGE_SIZE) * GENDERS.length,
    ranking_pages_completed: 0,
    get_rankings_calls: 0,
    get_ranking_points_calls: 0,
    comparison_started: false,
    comparison_completed: false,
    failure_reason: "",
    started_at: "",
    finished_at: "",
    duration: 0,
  };
}

function createLogger(logFile) {
  const lines = [];
  return {
    async log(message) {
      const line = `[${new Date().toISOString()}] ${message}`;
      lines.push(line);
      console.log(line);
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, `${line}\n`, "utf8");
    },
    getLines() {
      return [...lines];
    },
  };
}

function countBytes(text) {
  return Buffer.byteLength(text || "", "utf8");
}

function detectCaptcha(text) {
  const snippet = cleanText(text).toLowerCase();
  return (
    snippet.includes("captcha") ||
    snippet.includes("recaptcha") ||
    snippet.includes("hcaptcha") ||
    snippet.includes("cf-challenge")
  );
}

function inspectResponse(contentType, text) {
  const snippet = cleanText(text).toLowerCase();
  return {
    blockedHtml: detectBlockedHtml(contentType, text),
    incapsulaDetected:
      snippet.includes("incapsula") || snippet.includes("_incapsula_resource"),
    impervaDetected: snippet.includes("imperva"),
    captchaDetected: detectCaptcha(text),
  };
}

export function buildRankingPagePlan() {
  return GENDERS.flatMap((genderInfo) =>
    Array.from({ length: TOP_LIMIT / PAGE_SIZE }, (_, index) => index * PAGE_SIZE).map((skip) => ({
      genderInfo,
      skip,
      url: buildRankingUrl(genderInfo, skip, PAGE_SIZE),
    }))
  );
}

function normalizePolicyArg(value) {
  return cleanText(value).toLowerCase().replace(/-/g, "_");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const readArg = (name, fallback = "") => {
    const prefix = `--${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
  };

  const ledgerFile = cleanText(readArg("ledger-file"));
  const oldPlayersFile = cleanText(readArg("old-players-file"));
  const oldSnapshotFile = cleanText(readArg("old-snapshot-file"));
  const outputDir = cleanText(readArg("output-dir"));

  return {
    ledgerFile: ledgerFile ? path.resolve(ledgerFile) : "",
    oldPlayersFile: oldPlayersFile ? path.resolve(oldPlayersFile) : "",
    oldSnapshotFile: oldSnapshotFile ? path.resolve(oldSnapshotFile) : "",
    rankingDate: cleanText(readArg("ranking-date")),
    dropCutoff: cleanText(readArg("drop-cutoff")),
    baselinePolicy:
      normalizePolicyArg(readArg("baseline-policy", BASELINE_POLICY)) ||
      BASELINE_POLICY,
    networkMode:
      cleanText(readArg("network-mode", NETWORK_MODE_AUTO)).toLowerCase() ||
      NETWORK_MODE_AUTO,
    outputDir: outputDir ? path.resolve(outputDir) : "",
    mode: cleanText(readArg("mode", "dry-run")) || "dry-run",
  };
}

function ensureArg(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

async function ensureInputFiles(args) {
  for (const filePath of [
    args.ledgerFile,
    args.oldPlayersFile,
    args.oldSnapshotFile,
  ]) {
    await fs.access(filePath);
  }
}

export function buildOutputPaths(outputDir) {
  return {
    rawDir: path.join(outputDir, "raw"),
    rawRankingsDir: path.join(outputDir, "raw", "rankings"),
    rawFailuresDir: path.join(outputDir, "raw", "network_failures"),
    networkAttemptsFile: path.join(outputDir, "network_attempts.csv"),
    networkReportFile: path.join(outputDir, "network_report.json"),
    logFile: path.join(outputDir, "validation_run.log"),
    baselineValidationFile: path.join(outputDir, "baseline_validation.csv"),
    officialPlayersFile: path.join(outputDir, "official_players.csv"),
    officialSnapshotFile: path.join(outputDir, "official_rankings_snapshot.csv"),
    stagedCalculatedFile: path.join(outputDir, "staged_calculated_points.csv"),
    officialComparisonFile: path.join(outputDir, "official_comparison.csv"),
    exactMatchesFile: path.join(outputDir, "exact_matches.csv"),
    divergentPlayersFile: path.join(outputDir, "divergent_players.csv"),
    newEntrantsFile: path.join(outputDir, "new_top500_entrants.csv"),
    removedFile: path.join(outputDir, "removed_from_top500.csv"),
    missingLedgerFile: path.join(outputDir, "missing_ledger_players.csv"),
    playersToRefreshFile: path.join(outputDir, "players_to_refresh.csv"),
    playersToPreserveFile: path.join(outputDir, "players_to_preserve.csv"),
    summaryFile: path.join(outputDir, "validation_summary.json"),
  };
}

export function buildDryRunEndpoints() {
  return buildRankingPagePlan().map((page) => page.url);
}

function buildCacheFilePath(outputPaths, genderInfo, skip) {
  return path.join(
    outputPaths.rawRankingsDir,
    `${genderInfo.gender}_skip_${skip}.json`
  );
}

function buildFailureFilePath(outputPaths, genderInfo, skip, networkMode, attempt, extension = "html") {
  return path.join(
    outputPaths.rawFailuresDir,
    `${genderInfo.gender}_skip_${skip}_${networkMode}_attempt_${attempt}.${extension}`
  );
}

function toRelativeOutput(filePath, outputDir) {
  if (!filePath) return "";
  return path.relative(outputDir, filePath).replace(/\\/g, "/");
}

function validateRankingPayload(json, genderInfo, expectedRankingDate, url) {
  const rankDate = normalizeRankingDate(json?.rankDate);
  const items = Array.isArray(json?.items) ? json.items : [];

  if (!rankDate) {
    return {
      valid: false,
      rankDate: "",
      itemsFound: items.length,
      error: `A ITF nao retornou rankDate valido para ${url}.`,
    };
  }

  if (rankDate !== expectedRankingDate) {
    return {
      valid: false,
      rankDate,
      itemsFound: items.length,
      error: `rankDate divergente para ${url}. Esperado ${expectedRankingDate}, recebido ${rankDate}.`,
    };
  }

  if (items.length !== PAGE_SIZE) {
    return {
      valid: false,
      rankDate,
      itemsFound: items.length,
      error: `Quantidade invalida de items para ${url}. Esperado ${PAGE_SIZE}, recebido ${items.length}.`,
    };
  }

  const incompatible = items.find((item) => {
    const normalized = normalizeOfficialPlayer(item, genderInfo, rankDate, url);
    return normalized.gender !== genderInfo.gender || !normalized.player_id;
  });

  if (incompatible) {
    return {
      valid: false,
      rankDate,
      itemsFound: items.length,
      error: `Payload invalido para ${url}. Existe jogador sem player_id ou genero incompatível.`,
    };
  }

  return {
    valid: true,
    rankDate,
    itemsFound: items.length,
    error: "",
  };
}

async function tryLoadCachedRankingPage(filePath, genderInfo, expectedRankingDate, url) {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }

  try {
    const text = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(text);
    const validation = validateRankingPayload(
      json,
      genderInfo,
      expectedRankingDate,
      url
    );

    if (!validation.valid) {
      return null;
    }

    return {
      status: 200,
      contentType: "application/json",
      text,
      json,
      rankDate: validation.rankDate,
      itemsFound: validation.itemsFound,
      source: "cache",
      fromCache: true,
    };
  } catch {
    return null;
  }
}

async function saveRawResponse(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function createAttemptRecord(base) {
  return {
    timestamp: new Date().toISOString(),
    network_mode: base.networkMode,
    gender: base.gender,
    skip: String(base.skip),
    attempt: String(base.attempt),
    url: base.url,
    http_status: base.httpStatus ?? "",
    content_type: base.contentType || "",
    elapsed_ms: String(base.elapsedMs ?? 0),
    response_bytes: String(base.responseBytes ?? 0),
    json_valid: base.jsonValid ? "true" : "false",
    items_found: String(base.itemsFound ?? 0),
    rank_date: base.rankDate || "",
    blocked_html: base.blockedHtml ? "true" : "false",
    incapsula_detected: base.incapsulaDetected ? "true" : "false",
    imperva_detected: base.impervaDetected ? "true" : "false",
    captcha_detected: base.captchaDetected ? "true" : "false",
    timeout: base.timeout ? "true" : "false",
    error_message: base.errorMessage || "",
    raw_response_file: base.rawResponseFile || "",
  };
}

function applyAttemptToReport(report, attempt) {
  if (attempt.network_mode === NETWORK_MODE_DIRECT) {
    report.direct_attempts += 1;
  }
  if (attempt.network_mode === NETWORK_MODE_BROWSER) {
    report.browser_attempts += 1;
  }

  report.get_rankings_calls += 1;

  if (String(attempt.http_status) === "403") {
    report.http_403 += 1;
  }
  if (attempt.blocked_html === "true") {
    report.html_responses += 1;
  }
  if (attempt.incapsula_detected === "true") {
    report.incapsula_responses += 1;
  }
  if (attempt.imperva_detected === "true") {
    report.imperva_responses += 1;
  }
  if (attempt.captcha_detected === "true") {
    report.captcha_responses += 1;
  }
  if (attempt.timeout === "true") {
    report.timeouts += 1;
  }
}

async function defaultDirectRequest({ url, referer, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        referer: referer,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
    });

    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function defaultBrowserRequest({ url, referer, timeoutMs }, browserState) {
  if (!browserState.context) {
    browserState.browser = await chromium.launch({ headless: true });
    browserState.context = await browserState.browser.newContext();
    browserState.page = await browserState.context.newPage();
    await browserState.page.goto(RANKING_PAGE_URL, { waitUntil: "domcontentloaded" });
    await browserState.page.waitForTimeout(5000);

    const content = await browserState.page.content();
    if (inspectResponse("text/html", content).blockedHtml) {
      throw new Error("Browser page carregou challenge ou bloqueio HTML antes da coleta.");
    }
  }

  return browserState.page.evaluate(
    async ({ requestUrl, requestReferer, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetch(requestUrl, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
          headers: {
            accept: "application/json, text/plain, */*",
            referer: requestReferer,
          },
        });

        return {
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          text: await response.text(),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      requestUrl: url,
      requestReferer: referer,
      requestTimeoutMs: timeoutMs,
    }
  );
}

async function recordFailureBody(outputPaths, outputDir, genderInfo, skip, networkMode, attempt, text, extension = "html") {
  const filePath = buildFailureFilePath(
    outputPaths,
    genderInfo,
    skip,
    networkMode,
    attempt,
    extension
  );
  await saveRawResponse(filePath, text.slice(0, 20000));
  return toRelativeOutput(filePath, outputDir);
}

async function runSingleAttempt({
  requestFn,
  outputPaths,
  outputDir,
  genderInfo,
  skip,
  url,
  expectedRankingDate,
  networkMode,
  attempt,
  attempts,
  report,
  logger,
  browserState,
  deps,
}) {
  const startedAt = Date.now();

  try {
    const response = await requestFn(
      {
        genderInfo,
        skip,
        url,
        referer: RANKING_PAGE_URL,
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
      browserState,
      deps
    );
    const elapsedMs = Date.now() - startedAt;
    const inspection = inspectResponse(response.contentType, response.text);
    let json = null;
    let jsonValid = false;
    let rankDate = "";
    let itemsFound = 0;
    let errorMessage = "";
    let rawResponseFile = "";

    if (!inspection.blockedHtml) {
      try {
        json = JSON.parse(response.text);
        const validation = validateRankingPayload(
          json,
          genderInfo,
          expectedRankingDate,
          url
        );
        jsonValid = validation.valid;
        rankDate = validation.rankDate;
        itemsFound = validation.itemsFound;
        errorMessage = validation.valid ? "" : validation.error;
      } catch {
        errorMessage = `JSON invalido para ${url}.`;
      }
    } else {
      rawResponseFile = await recordFailureBody(
        outputPaths,
        outputDir,
        genderInfo,
        skip,
        networkMode,
        attempt,
        response.text,
        "html"
      );
      errorMessage = `HTML/bloqueio detectado para ${url}.`;
    }

    const attemptRecord = createAttemptRecord({
      networkMode,
      gender: genderInfo.gender,
      skip,
      attempt,
      url,
      httpStatus: response.status,
      contentType: response.contentType,
      elapsedMs,
      responseBytes: countBytes(response.text),
      jsonValid,
      itemsFound,
      rankDate,
      blockedHtml: inspection.blockedHtml,
      incapsulaDetected: inspection.incapsulaDetected,
      impervaDetected: inspection.impervaDetected,
      captchaDetected: inspection.captchaDetected,
      timeout: false,
      errorMessage,
      rawResponseFile,
    });

    attempts.push(attemptRecord);
    applyAttemptToReport(report, attemptRecord);
    await logger.log(
      `${networkMode.toUpperCase()} ${genderInfo.gender} skip=${skip} attempt=${attempt} status=${response.status} contentType=${response.contentType || "<empty>"} jsonValid=${jsonValid}`
    );

    if (!jsonValid) {
      return {
        ok: false,
        errorMessage: errorMessage || `Resposta invalida para ${url}.`,
        blockedHtml: inspection.blockedHtml,
        incapsulaDetected: inspection.incapsulaDetected,
        impervaDetected: inspection.impervaDetected,
        captchaDetected: inspection.captchaDetected,
      };
    }

    return {
      ok: true,
      status: response.status,
      contentType: response.contentType,
      text: response.text,
      json,
      rankDate,
      itemsFound,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timeout = error?.name === "AbortError" || cleanText(error?.message).includes("timeout");
    const attemptRecord = createAttemptRecord({
      networkMode,
      gender: genderInfo.gender,
      skip,
      attempt,
      url,
      httpStatus: "",
      contentType: "",
      elapsedMs,
      responseBytes: 0,
      jsonValid: false,
      itemsFound: 0,
      rankDate: "",
      blockedHtml: false,
      incapsulaDetected: false,
      impervaDetected: false,
      captchaDetected: false,
      timeout,
      errorMessage: error?.message || String(error),
      rawResponseFile: "",
    });

    attempts.push(attemptRecord);
    applyAttemptToReport(report, attemptRecord);
    await logger.log(
      `${networkMode.toUpperCase()} ${genderInfo.gender} skip=${skip} attempt=${attempt} falhou: ${attemptRecord.error_message}`
    );

    return {
      ok: false,
      errorMessage: attemptRecord.error_message,
      blockedHtml: false,
      incapsulaDetected: false,
      impervaDetected: false,
      captchaDetected: false,
      timeout,
    };
  }
}

async function fetchDirectRankingPage(context) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= DIRECT_MAX_RETRIES; attempt++) {
    const result = await runSingleAttempt({
      ...context,
      networkMode: NETWORK_MODE_DIRECT,
      attempt,
      requestFn: context.deps.directRequest || defaultDirectRequest,
    });

    if (result.ok) {
      return result;
    }

    lastFailure = result;

    if (attempt < DIRECT_MAX_RETRIES) {
      await (context.deps.sleep || sleep)(DIRECT_RETRY_DELAY_MS);
    }
  }

  return {
    ok: false,
    errorMessage:
      lastFailure?.errorMessage || `Falha no modo direct para ${context.url}.`,
    blockedHtml: lastFailure?.blockedHtml || false,
    incapsulaDetected: lastFailure?.incapsulaDetected || false,
    impervaDetected: lastFailure?.impervaDetected || false,
    captchaDetected: lastFailure?.captchaDetected || false,
    timeout: lastFailure?.timeout || false,
  };
}

async function fetchBrowserRankingPage(context) {
  const result = await runSingleAttempt({
    ...context,
    networkMode: NETWORK_MODE_BROWSER,
    attempt: 1,
    requestFn: context.deps.browserRequest || defaultBrowserRequest,
  });

  if (result.ok) {
    return result;
  }

  return {
    ok: false,
    errorMessage:
      result.errorMessage || `Falha no modo browser para ${context.url}.`,
    blockedHtml: result.blockedHtml || false,
    incapsulaDetected: result.incapsulaDetected || false,
    impervaDetected: result.impervaDetected || false,
    captchaDetected: result.captchaDetected || false,
    timeout: result.timeout || false,
  };
}

async function closeBrowserState(browserState) {
  if (browserState.page) {
    await browserState.page.close().catch(() => {});
  }
  if (browserState.context) {
    await browserState.context.close().catch(() => {});
  }
  if (browserState.browser) {
    await browserState.browser.close().catch(() => {});
  }
}

function combineFailureReason(page, directFailure, browserFailure, networkMode) {
  const parts = [
    `Falha ao coletar ${page.genderInfo.gender} skip=${page.skip} no modo ${networkMode}.`,
  ];

  if (directFailure) {
    parts.push(`direct: ${directFailure.errorMessage}`);
  }
  if (browserFailure) {
    parts.push(`browser: ${browserFailure.errorMessage}`);
  }

  return parts.join(" ");
}

export async function collectOfficialRanking(args, outputPaths, deps = {}) {
  const pagePlan = deps.pagePlan || buildRankingPagePlan();
  const attempts = deps.attempts || [];
  const report =
    deps.networkReport || createDefaultNetworkReport(args.networkMode);
  const logger = deps.logger || {
    async log() {},
  };
  const browserState = {};
  const allPlayers = [];
  const allSnapshots = [];
  let receivedRankingDate = "";

  await fs.mkdir(outputPaths.rawRankingsDir, { recursive: true });
  await fs.mkdir(outputPaths.rawFailuresDir, { recursive: true });

  try {
    for (const page of pagePlan) {
      const cacheFile = buildCacheFilePath(
        outputPaths,
        page.genderInfo,
        page.skip
      );
      const cached = await tryLoadCachedRankingPage(
        cacheFile,
        page.genderInfo,
        args.rankingDate,
        page.url
      );

      if (cached) {
        report.cached_pages += 1;
        report.successful_pages += 1;
        report.ranking_pages_completed += 1;
        receivedRankingDate ||= cached.rankDate;
        await logger.log(
          `CACHE ${page.genderInfo.gender} skip=${page.skip} reutilizado com sucesso.`
        );

        for (const item of cached.json.items) {
          const player = normalizeOfficialPlayer(
            item,
            page.genderInfo,
            cached.rankDate,
            page.url
          );
          allPlayers.push(player);
          allSnapshots.push(buildOfficialSnapshotRow(player, cached.rankDate));
        }

        continue;
      }

      const context = {
        outputPaths,
        outputDir: args.outputDir,
        genderInfo: page.genderInfo,
        skip: page.skip,
        url: page.url,
        expectedRankingDate: args.rankingDate,
        attempts,
        report,
        logger,
        browserState,
        deps,
      };

      let result = null;
      let directFailure = null;
      let browserFailure = null;

      if (args.networkMode === NETWORK_MODE_DIRECT) {
        result = await fetchDirectRankingPage(context);
        if (!result.ok) {
          directFailure = result;
        }
      } else if (args.networkMode === NETWORK_MODE_BROWSER) {
        result = await fetchBrowserRankingPage(context);
        if (!result.ok) {
          browserFailure = result;
        }
      } else {
        result = await fetchDirectRankingPage(context);
        if (!result.ok) {
          directFailure = result;
          if (
            result.blockedHtml ||
            result.incapsulaDetected ||
            result.impervaDetected ||
            result.captchaDetected ||
            cleanText(result.errorMessage).toLowerCase().includes("json invalido")
          ) {
            result = await fetchBrowserRankingPage(context);
            if (!result.ok) {
              browserFailure = result;
            }
          }
        }
      }

      if (!result?.ok) {
        report.failed_pages += 1;
        throw new OfficialCollectionError(
          combineFailureReason(page, directFailure, browserFailure, args.networkMode),
          {
            partialPlayers: allPlayers,
            partialSnapshots: allSnapshots,
            receivedRankingDate,
            failedPage: {
              gender: page.genderInfo.gender,
              skip: page.skip,
              url: page.url,
              networkMode: args.networkMode,
            },
            firstFailure:
              attempts.find((attempt) => attempt.error_message) || null,
            lastFailure:
              [...attempts].reverse().find((attempt) => attempt.error_message) ||
              null,
          }
        );
      }

      await saveRawResponse(cacheFile, result.text);
      report.successful_pages += 1;
      report.ranking_pages_completed += 1;
      receivedRankingDate ||= result.rankDate;

      for (const item of result.json.items) {
        const player = normalizeOfficialPlayer(
          item,
          page.genderInfo,
          result.rankDate,
          page.url
        );
        allPlayers.push(player);
        allSnapshots.push(buildOfficialSnapshotRow(player, result.rankDate));
      }

      await (deps.sleep || sleep)(BETWEEN_PAGES_DELAY_MS);
    }
  } finally {
    await closeBrowserState(browserState);
  }

  if (receivedRankingDate !== args.rankingDate) {
    throw new OfficialCollectionError(
      `Data oficial divergente. Esperada ${args.rankingDate}, recebida ${receivedRankingDate}.`,
      {
        partialPlayers: allPlayers,
        partialSnapshots: allSnapshots,
        receivedRankingDate,
      }
    );
  }

  return {
    receivedRankingDate,
    players: allPlayers,
    snapshots: allSnapshots,
  };
}

async function writeComparisonOutputs(outputPaths, result) {
  await writeCsv(
    outputPaths.baselineValidationFile,
    result.baseline.rows,
    BASELINE_VALIDATION_COLUMNS
  );
  await writeCsv(
    outputPaths.officialPlayersFile,
    result.official.players,
    OFFICIAL_PLAYER_COLUMNS
  );
  await writeCsv(
    outputPaths.officialSnapshotFile,
    result.official.snapshots,
    OFFICIAL_SNAPSHOT_COLUMNS
  );
  await writeCsv(
    outputPaths.stagedCalculatedFile,
    result.stagedCalculatedRows,
    STAGED_CALCULATED_COLUMNS
  );
  await writeCsv(
    outputPaths.officialComparisonFile,
    result.comparison.comparisonRows,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.exactMatchesFile,
    result.comparison.exactMatches,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.divergentPlayersFile,
    [
      ...result.comparison.pointDifferences,
      ...result.comparison.newEntrants,
      ...result.comparison.missingLedgerRows,
      ...result.comparison.invalidPlayers,
    ],
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.newEntrantsFile,
    result.comparison.newEntrants,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.removedFile,
    result.comparison.removedRows,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.missingLedgerFile,
    result.comparison.missingLedgerRows,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.playersToRefreshFile,
    result.comparison.playersToRefresh,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeCsv(
    outputPaths.playersToPreserveFile,
    result.comparison.playersToPreserve,
    OFFICIAL_COMPARISON_COLUMNS
  );
  await writeJson(outputPaths.summaryFile, result.summary);
}

export async function writeNetworkArtifacts(outputPaths, attempts, networkReport) {
  await writeCsv(outputPaths.networkAttemptsFile, attempts, NETWORK_ATTEMPT_COLUMNS);
  await writeJson(outputPaths.networkReportFile, networkReport);
}

function buildBeforeAfterHashes(beforeHashes, afterHashes) {
  return {
    hashes_before: beforeHashes,
    hashes_after: afterHashes,
  };
}

async function calculateProtectedHashes(args) {
  return {
    old_players: await sha256File(args.oldPlayersFile),
    old_snapshot: await sha256File(args.oldSnapshotFile),
    current_ledger: await sha256File(path.resolve("data/clean/points_ledger.csv")),
    staged_ledger: await sha256File(args.ledgerFile),
  };
}

function assertProtectedHashes(beforeHashes, afterHashes) {
  for (const [key, beforeHash] of Object.entries(beforeHashes)) {
    if (afterHashes[key] !== beforeHash) {
      throw new Error(
        `Arquivo protegido alterado indevidamente: ${key}. Antes ${beforeHash}, depois ${afterHashes[key]}.`
      );
    }
  }
}

function isIsoDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function previousIsoDate(value) {
  if (!isIsoDateText(value)) return "";

  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isClosedWeekLedgerRow(row, oldRankingDate, dropCutoff) {
  const startDate = cleanText(row.start_date);

  return (
    cleanText(row.status) === "confirmed_from_week_close" &&
    isIsoDateText(startDate) &&
    isIsoDateText(oldRankingDate) &&
    isIsoDateText(dropCutoff) &&
    startDate >= oldRankingDate &&
    startDate <= dropCutoff
  );
}

export function removeClosedWeekRowsForBaseline(rows, { oldRankingDate, dropCutoff }) {
  return rows.filter(
    (row) => !isClosedWeekLedgerRow(row, oldRankingDate, dropCutoff)
  );
}

export function buildBaselineValidation({
  baselineLedgerRows,
  oldSnapshotRows,
  oldRankingDate,
  dropCutoff,
}) {
  const calculatedRows = calculateLedgerPoints(baselineLedgerRows, {
    policy: BASELINE_POLICY,
    dropCutoff: "",
  });
  const baseline = compareCalculatedAgainstSnapshot(
    calculatedRows,
    oldSnapshotRows,
    {
      baselinePolicy: BASELINE_POLICY,
    }
  );

  if (baseline.valid) {
    return {
      baseline,
      baselinePolicy: BASELINE_POLICY,
      baselineDropCutoff: "",
      reconstructed: false,
      removedRows: 0,
      warnings: [],
    };
  }

  const reconstructedRows = removeClosedWeekRowsForBaseline(baselineLedgerRows, {
    oldRankingDate,
    dropCutoff,
  });
  const removedRows = baselineLedgerRows.length - reconstructedRows.length;
  const baselineDropCutoff = previousIsoDate(oldRankingDate);

  const reconstructedCalculatedRows = calculateLedgerPoints(reconstructedRows, {
    policy: BASELINE_POLICY,
    dropCutoff: baselineDropCutoff,
    applyDropCutoff: true,
  });
  const reconstructedBaseline = compareCalculatedAgainstSnapshot(
    reconstructedCalculatedRows,
    oldSnapshotRows,
    {
      baselinePolicy: BASELINE_POLICY,
    }
  );

  if (reconstructedBaseline.valid) {
    return {
      baseline: reconstructedBaseline,
      baselinePolicy: BASELINE_POLICY,
      baselineDropCutoff,
      reconstructed: true,
      removedRows,
      warnings: [
        `Baseline antigo reconstruido com corte em ${baselineDropCutoff}, vespera do ranking oficial ${oldRankingDate}${
          removedRows > 0
            ? ` e remocao de ${removedRows} linhas confirmed_from_week_close entre ${oldRankingDate} e ${dropCutoff}`
            : ""
        }.`,
      ],
    };
  }

  const cutoffCalculatedRows = calculateLedgerPoints(reconstructedRows, {
    policy: STAGED_POLICY,
    dropCutoff: baselineDropCutoff,
  });
  const cutoffBaseline = compareCalculatedAgainstSnapshot(
    cutoffCalculatedRows,
    oldSnapshotRows,
    {
      baselinePolicy: STAGED_POLICY,
    }
  );

  if (!cutoffBaseline.valid) {
    return {
      baseline,
      baselinePolicy: BASELINE_POLICY,
      baselineDropCutoff: "",
      reconstructed: false,
      removedRows,
      warnings: [],
    };
  }

  return {
    baseline: cutoffBaseline,
    baselinePolicy: STAGED_POLICY,
    baselineDropCutoff,
    reconstructed: true,
    removedRows,
    warnings: [
      `Baseline antigo reconstruido com corte em ${baselineDropCutoff}, vespera do ranking oficial ${oldRankingDate}${
        removedRows > 0
          ? ` e remocao de ${removedRows} linhas confirmed_from_week_close da semana ainda nao oficial`
          : ""
      }.`,
    ],
  };
}

export async function runValidation(args, deps = {}) {
  const errors = [];

  ensureArg(args.ledgerFile, "Informe --ledger-file.", errors);
  ensureArg(args.oldPlayersFile, "Informe --old-players-file.", errors);
  ensureArg(args.oldSnapshotFile, "Informe --old-snapshot-file.", errors);
  ensureArg(args.rankingDate, "Informe --ranking-date.", errors);
  ensureArg(args.dropCutoff, "Informe --drop-cutoff.", errors);
  ensureArg(args.outputDir, "Informe --output-dir.", errors);
  ensureArg(["dry-run", "run"].includes(args.mode), "Use --mode=dry-run ou --mode=run.", errors);
  ensureArg(
    [NETWORK_MODE_DIRECT, NETWORK_MODE_BROWSER, NETWORK_MODE_AUTO].includes(
      args.networkMode
    ),
    "Use --network-mode=direct, --network-mode=browser ou --network-mode=auto.",
    errors
  );
  ensureArg(
    args.baselinePolicy === BASELINE_POLICY,
    `Use --baseline-policy=${BASELINE_POLICY}.`,
    errors
  );

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await ensureInputFiles(args);

  const outputPaths = buildOutputPaths(args.outputDir);
  const logger = deps.logger || createLogger(outputPaths.logFile);
  const attempts = [];
  const networkReport = createDefaultNetworkReport(args.networkMode);
  const startedAt = new Date().toISOString();
  networkReport.started_at = startedAt;

  if (args.mode === "dry-run") {
    console.log("Dry-run validado com sucesso.");
    console.log(`baseline-policy: ${args.baselinePolicy}`);
    console.log(`staged-policy: ${STAGED_POLICY}`);
    console.log("baseline-drop-cutoff: <none>");
    console.log(`staged-drop-cutoff: ${args.dropCutoff}`);
    console.log(`network-mode: ${args.networkMode}`);
    console.log(`ranking-date: ${args.rankingDate}`);
    console.log("endpoints:");
    for (const endpoint of buildDryRunEndpoints()) {
      console.log(endpoint);
    }
    console.log("output-paths:");
    for (const outputPath of Object.values(outputPaths)) {
      console.log(outputPath);
    }
    return {
      dryRun: true,
      outputPaths,
    };
  }

  await fs.mkdir(args.outputDir, { recursive: true });
  const beforeHashes = await calculateProtectedHashes(args);
  const oldPlayersRows = await readCsv(args.oldPlayersFile);
  const oldSnapshotRows = await readCsv(args.oldSnapshotFile);
  const baselineLedgerRows = await readCsv(path.resolve("data/clean/points_ledger.csv"));
  const stagedLedgerRows = await readCsv(args.ledgerFile);
  const ledgerValidation = validateLedgerRows(stagedLedgerRows);

  if (!ledgerValidation.valid) {
    throw new Error(ledgerValidation.errors.join("\n"));
  }

  const oldRankingDate = cleanText(oldSnapshotRows[0]?.ranking_date);
  const baselineResult = buildBaselineValidation({
    baselineLedgerRows,
    oldSnapshotRows,
    oldRankingDate,
    dropCutoff: args.dropCutoff,
  });
  const baseline = baselineResult.baseline;
  const validationWarnings = [...baselineResult.warnings];

  if (baselineResult.reconstructed) {
    await logger.log(validationWarnings[0]);
  }

  let official = null;
  let officialValidation = {
    valid: false,
    errors: [],
    countsByGender: { M: 0, F: 0 },
  };
  let comparison = {
    continuingPlayers: 0,
    exactMatches: [],
    pointDifferences: [],
    newEntrants: [],
    removedRows: [],
    missingLedgerRows: [],
    invalidPlayers: [],
    playersToRefresh: [],
    playersToPreserve: [],
    ledgerValid: ledgerValidation.valid,
    completed: false,
    comparisonRows: [],
  };
  let summary = null;
  let thrownError = null;

  try {
    if (!baseline.valid) {
      throw new Error(
        `Validacao da base antiga falhou: ${baseline.exact}/${baseline.total} reconciliados.`
      );
    }

    networkReport.comparison_started = false;
    official = await collectOfficialRanking(args, outputPaths, {
      ...deps,
      attempts,
      networkReport,
      logger,
    });
    officialValidation = validateOfficialSnapshotRows(
      official.players,
      official.snapshots,
      args.rankingDate
    );

    if (!officialValidation.valid) {
      throw new Error(officialValidation.errors.join("\n"));
    }

    networkReport.comparison_started = true;
    const stagedCalculatedRows = calculateLedgerPoints(stagedLedgerRows, {
      policy: STAGED_POLICY,
      dropCutoff: args.dropCutoff,
    });
    comparison = {
      ...classifyPlayers({
        oldPlayersRows,
        oldSnapshotRows,
        officialSnapshotRows: official.snapshots,
        stagedCalculatedRows,
        stagedLedgerRows,
      }),
      ledgerValid: ledgerValidation.valid,
      completed: true,
    };
    networkReport.comparison_completed = true;

    summary = buildValidationSummary({
      oldRankingDate,
      expectedRankingDate: args.rankingDate,
      receivedRankingDate: official.receivedRankingDate,
      baselinePolicy: baselineResult.baselinePolicy,
      stagedPolicy: STAGED_POLICY,
      baselineDropCutoff: baselineResult.baselineDropCutoff,
      stagedDropCutoff: args.dropCutoff,
      baseline,
      officialCounts: {
        total: official.snapshots.length,
        male: officialValidation.countsByGender.M,
        female: officialValidation.countsByGender.F,
        valid: officialValidation.valid,
      },
      oldTrackedTotal: oldPlayersRows.length,
      comparison,
      warnings: validationWarnings,
      errors: [],
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    await writeComparisonOutputs(outputPaths, {
      baseline,
      official,
      stagedCalculatedRows,
      comparison,
      summary,
    });
  } catch (error) {
    thrownError = error;
    networkReport.failure_reason = error?.message || String(error);

    summary = buildValidationSummary({
      oldRankingDate,
      expectedRankingDate: args.rankingDate,
      receivedRankingDate: official?.receivedRankingDate || "",
      baselinePolicy: baselineResult.baselinePolicy,
      stagedPolicy: STAGED_POLICY,
      baselineDropCutoff: baselineResult.baselineDropCutoff,
      stagedDropCutoff: args.dropCutoff,
      baseline,
      officialCounts: {
        total: official?.snapshots?.length || 0,
        male: officialValidation.countsByGender.M,
        female: officialValidation.countsByGender.F,
        valid: officialValidation.valid,
      },
      oldTrackedTotal: oldPlayersRows.length,
      comparison,
      warnings: validationWarnings,
      errors: [networkReport.failure_reason],
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }

  const afterHashes = await calculateProtectedHashes(args);
  const hashInfo = buildBeforeAfterHashes(beforeHashes, afterHashes);
  Object.assign(summary, hashInfo);

  await writeCsv(
    outputPaths.baselineValidationFile,
    baseline.rows,
    BASELINE_VALIDATION_COLUMNS
  );
  await writeJson(outputPaths.summaryFile, summary);

  networkReport.finished_at = new Date().toISOString();
  networkReport.duration =
    (new Date(networkReport.finished_at).getTime() -
      new Date(networkReport.started_at).getTime()) /
    1000;
  await writeNetworkArtifacts(outputPaths, attempts, networkReport);
  await logger.log(`network_report salvo em ${outputPaths.networkReportFile}`);

  assertProtectedHashes(beforeHashes, afterHashes);

  if (thrownError) {
    throw thrownError;
  }

  console.log("Validacao concluida.");
  console.log(JSON.stringify({ beforeHashes, afterHashes }, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  return {
    outputPaths,
    summary,
    networkReport,
    beforeHashes,
    afterHashes,
  };
}

async function main() {
  const args = parseArgs();
  await runValidation(args);
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
