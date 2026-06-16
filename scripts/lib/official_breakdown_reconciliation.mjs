import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { chromium } from "playwright";
import {
  LEDGER_COLUMNS,
  buildResultKey,
  calculateDropDate,
  cleanText,
  isIsoDate,
  toNumber,
} from "./weekly_ledger.mjs";
import {
  OFFICIAL_PLAYER_COLUMNS,
  OFFICIAL_SNAPSHOT_COLUMNS,
  STAGED_POLICY,
  calculateLedgerPoints,
  compareCalculatedAgainstSnapshot,
  detectBlockedHtml,
  sleep,
} from "./official_ledger_validation.mjs";

export const REQUEST_TIMEOUT_MS = 90000;
export const MAX_RETRIES = 3;
export const NETWORK_MODE_DIRECT = "direct";
export const NETWORK_MODE_BROWSER = "browser";
export const NETWORK_MODE_AUTO = "auto";
export const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";
export const FINAL_VALIDATION_POLICY = STAGED_POLICY;

export const FETCH_ATTEMPT_COLUMNS = [
  "timestamp",
  "network_mode",
  "player_id",
  "attempt",
  "url",
  "http_status",
  "content_type",
  "elapsed_ms",
  "response_bytes",
  "json_valid",
  "rows_found",
  "blocked_html",
  "incapsula_detected",
  "imperva_detected",
  "captcha_detected",
  "timeout",
  "error_message",
  "raw_response_file",
];

export const FETCH_SUMMARY_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "classification",
  "from_cache",
  "rows_found",
  "status",
  "error_message",
  "raw_file",
];

export const PLAYER_AUDIT_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_rank",
  "official_points",
  "classification",
  "refresh_required",
  "refresh_reason",
];

export const FINAL_VALIDATION_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "official_points",
  "calculated_points",
  "point_difference",
  "baseline_policy",
  "active_rows",
  "singles_total",
  "doubles_raw_total",
  "doubles_weighted_total",
  "exact_match",
];

export const PLAYER_FETCH_ERROR_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "classification",
  "error_message",
];

export function normalizeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;
  return raw;
}

export function parseItfDate(value) {
  const text = cleanText(value);
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

export async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

export async function writeCsv(filePath, rows, columns) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    stringify(rows, { header: true, columns }),
    "utf8"
  );
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function buildRankingPointsUrl(playerId) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    matchTypeCode: "S",
    playerId: String(playerId),
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetRankingPoints?${params.toString()}`;
}

export function normalizeBreakdownRow({
  player,
  sectionTitle,
  countableStatus,
  item,
  sourceUrl,
  collectedAt,
}) {
  const eventType =
    cleanText(sectionTitle).toLowerCase().includes("double")
      ? "doubles"
      : "singles";
  const startDate = parseItfDate(item.startDate);

  return {
    player_id: cleanText(player.player_id),
    player_name: cleanText(player.player_name),
    gender: cleanText(player.gender),
    country: cleanText(player.country),
    country_name: cleanText(player.country_name),
    birth_year: cleanText(player.birth_year),
    event_type: eventType,
    countable_status: countableStatus,
    tournament_name: cleanText(item.tournamentName),
    category: cleanText(item.category),
    draw_type: cleanText(item.drawType),
    host_nation: cleanText(item.hostNation),
    host_nation_code: cleanText(item.hostNationCode),
    surface: cleanText(item.surfaceDesc),
    surface_code: cleanText(item.surfaceCode),
    start_date: startDate,
    drop_date_calculated: calculateDropDate(startDate),
    round: cleanText(item.round),
    points: toNumber(item.points) ?? "",
    tournament_link: normalizeUrl(item.tournamentLink),
    is_countable_at_collection:
      countableStatus === "countable" ? "true" : "false",
    is_live: "false",
    status: "confirmed_official_reconciliation",
    source_url: sourceUrl,
    collected_at: collectedAt,
    raw_json: JSON.stringify(item),
  };
}

export function extractLedgerRowsFromRankingPoints({
  json,
  player,
  sourceUrl,
  collectedAt = new Date().toISOString(),
}) {
  const rows = [];
  const sections = Array.isArray(json?.countable) ? json.countable : [];

  for (const section of sections) {
    const sectionTitle = section?.title || "";
    const countableBreakdown =
      section?.countablePoints?.pointsBreakdown || [];
    const nonCountableBreakdown =
      section?.nonCountablePoints?.pointsBreakdown || [];

    for (const item of countableBreakdown) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "countable",
          item,
          sourceUrl,
          collectedAt,
        })
      );
    }

    for (const item of nonCountableBreakdown) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "non_countable",
          item,
          sourceUrl,
          collectedAt,
        })
      );
    }
  }

  return rows;
}

export function validateBreakdownJson(json, player, sourceUrl) {
  const rows = extractLedgerRowsFromRankingPoints({
    json,
    player,
    sourceUrl,
    collectedAt: "2000-01-01T00:00:00.000Z",
  });
  const errors = [];

  if (!Array.isArray(json?.countable)) {
    errors.push("JSON sem array countable.");
  }
  if (rows.length === 0) {
    errors.push("Breakdown sem linhas de pontos reconhecidas.");
  }
  for (const row of rows) {
    if (row.player_id !== cleanText(player.player_id)) {
      errors.push("player_id incompativel.");
    }
    if (!cleanText(row.tournament_name) || !cleanText(row.event_type)) {
      errors.push("Linha de breakdown com campos obrigatorios ausentes.");
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    rowsFound: rows.length,
  };
}

export function inspectNetworkText(contentType, text) {
  const lower = cleanText(text).toLowerCase();
  return {
    blockedHtml: detectBlockedHtml(contentType, text),
    incapsulaDetected:
      lower.includes("incapsula") || lower.includes("_incapsula_resource"),
    impervaDetected: lower.includes("imperva"),
    captchaDetected:
      lower.includes("captcha") ||
      lower.includes("recaptcha") ||
      lower.includes("hcaptcha"),
  };
}

export function buildDefaultNetworkReport() {
  return {
    get_rankings_calls: 0,
    get_ranking_points_calls: 0,
    cached_breakdowns: 0,
    network_breakdowns: 0,
    breakdown_cache_dir: "",
    direct_attempts: 0,
    browser_attempts: 0,
    html_responses: 0,
    incapsula_responses: 0,
    imperva_responses: 0,
    http_403: 0,
    timeouts: 0,
  };
}

function applyAttemptToReport(report, attempt) {
  if (attempt.network_mode === NETWORK_MODE_DIRECT) report.direct_attempts += 1;
  if (attempt.network_mode === NETWORK_MODE_BROWSER) report.browser_attempts += 1;
  report.get_ranking_points_calls += 1;
  if (String(attempt.http_status) === "403") report.http_403 += 1;
  if (attempt.blocked_html === "true") report.html_responses += 1;
  if (attempt.incapsula_detected === "true") report.incapsula_responses += 1;
  if (attempt.imperva_detected === "true") report.imperva_responses += 1;
  if (attempt.timeout === "true") report.timeouts += 1;
}

function countBytes(text) {
  return Buffer.byteLength(text || "", "utf8");
}

export async function defaultDirectRequest({ url, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        referer: RANKING_PAGE,
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

export async function defaultBrowserRequest({ url, timeoutMs }, browserState) {
  if (!browserState.browser) {
    browserState.browser = await chromium.launch({ headless: true });
    browserState.context = await browserState.browser.newContext();
    browserState.page = await browserState.context.newPage();
    await browserState.page.goto(RANKING_PAGE, { waitUntil: "domcontentloaded" });
    await browserState.page.waitForTimeout(5000);
    const pageHtml = await browserState.page.content();
    if (inspectNetworkText("text/html", pageHtml).blockedHtml) {
      throw new Error("Browser page carregou challenge ou bloqueio HTML antes da coleta.");
    }
  }

  return browserState.page.evaluate(
    async ({ requestUrl, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetch(requestUrl, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
          headers: {
            accept: "application/json, text/plain, */*",
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
    { requestUrl: url, requestTimeoutMs: timeoutMs }
  );
}

async function closeBrowserState(browserState) {
  if (browserState.page) await browserState.page.close().catch(() => {});
  if (browserState.context) await browserState.context.close().catch(() => {});
  if (browserState.browser) await browserState.browser.close().catch(() => {});
}

function buildOutputBreakdownFile(outputDir, playerId) {
  return path.join(outputDir, "raw", "breakdowns", `${playerId}.json`);
}

function displayPath(filePath, outputDir) {
  const relative = path.relative(outputDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, "/")
    : filePath;
}

async function tryReadBreakdownFile({ rawFile, player, sourceUrl }) {
  if (!(await fileExists(rawFile))) return null;

  try {
    const wrapper = JSON.parse(await fs.readFile(rawFile, "utf8"));
    const json = wrapper?.json || wrapper;
    const validation = validateBreakdownJson(json, player, wrapper.source_url || sourceUrl);
    if (!validation.valid) return null;

    return {
      rawFile,
      sourceUrl: wrapper.source_url || sourceUrl,
      json,
      rowsFound: validation.rowsFound,
    };
  } catch {
    return null;
  }
}

export async function readCachedBreakdown({
  outputDir,
  player,
  sourceUrl,
  breakdownCacheDir = "",
}) {
  const externalFile = breakdownCacheDir
    ? path.join(breakdownCacheDir, `${player.player_id}.json`)
    : "";
  const outputFile = buildOutputBreakdownFile(outputDir, player.player_id);
  const candidates = [externalFile, outputFile].filter(Boolean);

  for (const rawFile of candidates) {
    const cached = await tryReadBreakdownFile({ rawFile, player, sourceUrl });
    if (cached) {
      return {
        ...cached,
        external: rawFile === externalFile,
      };
    }
  }

  return null;
}

async function saveBreakdown({ outputDir, player, sourceUrl, json }) {
  const rawFile = buildOutputBreakdownFile(outputDir, player.player_id);
  await fs.mkdir(path.dirname(rawFile), { recursive: true });
  await fs.writeFile(
    rawFile,
    `${JSON.stringify({ player_id: player.player_id, source_url: sourceUrl, json }, null, 2)}\n`,
    "utf8"
  );
  return rawFile;
}

async function saveFailureBody({ outputDir, player, mode, attempt, text }) {
  const filePath = path.join(
    outputDir,
    "raw",
    "network_failures",
    `${player.player_id}_${mode}_attempt_${attempt}.html`
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text.slice(0, 20000), "utf8");
  return path.relative(outputDir, filePath).replace(/\\/g, "/");
}

async function runNetworkAttempt({
  requestFn,
  outputDir,
  player,
  url,
  mode,
  attempt,
  attempts,
  report,
  browserState,
  deps,
}) {
  const started = Date.now();

  try {
    const response = await requestFn({ url, timeoutMs: REQUEST_TIMEOUT_MS }, browserState, deps);
    const inspection = inspectNetworkText(response.contentType, response.text);
    let json = null;
    let jsonValid = false;
    let rowsFound = 0;
    let errorMessage = "";
    let rawResponseFile = "";

    if (!inspection.blockedHtml) {
      try {
        json = JSON.parse(response.text);
        const validation = validateBreakdownJson(json, player, url);
        jsonValid = validation.valid;
        rowsFound = validation.rowsFound;
        errorMessage = validation.valid ? "" : validation.errors.join("; ");
      } catch {
        errorMessage = "JSON invalido.";
      }
    } else {
      rawResponseFile = await saveFailureBody({
        outputDir,
        player,
        mode,
        attempt,
        text: response.text,
      });
      errorMessage = "HTML/bloqueio detectado.";
    }

    const attemptRow = {
      timestamp: new Date().toISOString(),
      network_mode: mode,
      player_id: player.player_id,
      attempt: String(attempt),
      url,
      http_status: response.status ?? "",
      content_type: response.contentType || "",
      elapsed_ms: String(Date.now() - started),
      response_bytes: String(countBytes(response.text)),
      json_valid: jsonValid ? "true" : "false",
      rows_found: String(rowsFound),
      blocked_html: inspection.blockedHtml ? "true" : "false",
      incapsula_detected: inspection.incapsulaDetected ? "true" : "false",
      imperva_detected: inspection.impervaDetected ? "true" : "false",
      captcha_detected: inspection.captchaDetected ? "true" : "false",
      timeout: "false",
      error_message: errorMessage,
      raw_response_file: rawResponseFile,
    };
    attempts.push(attemptRow);
    applyAttemptToReport(report, attemptRow);

    return jsonValid
      ? { ok: true, json, rowsFound }
      : { ok: false, errorMessage, blockedHtml: inspection.blockedHtml };
  } catch (err) {
    const timeout =
      err?.name === "AbortError" || cleanText(err?.message).toLowerCase().includes("timeout");
    const attemptRow = {
      timestamp: new Date().toISOString(),
      network_mode: mode,
      player_id: player.player_id,
      attempt: String(attempt),
      url,
      http_status: "",
      content_type: "",
      elapsed_ms: String(Date.now() - started),
      response_bytes: "0",
      json_valid: "false",
      rows_found: "0",
      blocked_html: "false",
      incapsula_detected: "false",
      imperva_detected: "false",
      captcha_detected: "false",
      timeout: timeout ? "true" : "false",
      error_message: err?.message || String(err),
      raw_response_file: "",
    };
    attempts.push(attemptRow);
    applyAttemptToReport(report, attemptRow);
    return { ok: false, errorMessage: attemptRow.error_message, timeout };
  }
}

async function fetchWithMode(context, mode) {
  const requestFn =
    mode === NETWORK_MODE_BROWSER
      ? context.deps.browserRequest || defaultBrowserRequest
      : context.deps.directRequest || defaultDirectRequest;
  let last = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await runNetworkAttempt({
      ...context,
      requestFn,
      mode,
      attempt,
    });
    if (result.ok) return result;
    last = result;
    if (attempt < MAX_RETRIES) {
      await (context.deps.sleep || sleep)(attempt * 15000);
    }
  }

  return last || { ok: false, errorMessage: `Falha no modo ${mode}.` };
}

export async function fetchSelectedBreakdowns({
  players,
  outputDir,
  networkMode = NETWORK_MODE_AUTO,
  breakdownCacheDir = "",
  deps = {},
}) {
  const attempts = [];
  const report = buildDefaultNetworkReport();
  const summaries = [];
  const errors = [];
  const byPlayerId = new Map();
  const browserState = {};
  report.breakdown_cache_dir = breakdownCacheDir;

  try {
    for (const player of players) {
      const sourceUrl = buildRankingPointsUrl(player.player_id);
      const cached = await readCachedBreakdown({
        outputDir,
        player,
        sourceUrl,
        breakdownCacheDir,
      });

      if (cached) {
        report.cached_breakdowns += 1;
        let rawFile = cached.rawFile;
        if (cached.external) {
          rawFile = await saveBreakdown({
            outputDir,
            player,
            sourceUrl: cached.sourceUrl,
            json: cached.json,
          });
        }
        const rows = extractLedgerRowsFromRankingPoints({
          json: cached.json,
          player,
          sourceUrl: cached.sourceUrl,
        });
        byPlayerId.set(player.player_id, rows);
        summaries.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          classification: player.classification || "",
          from_cache: "true",
          rows_found: rows.length,
          status: "ok",
          error_message: "",
          raw_file: displayPath(rawFile, outputDir),
        });
        continue;
      }

      report.network_breakdowns += 1;
      const context = {
        outputDir,
        player,
        url: sourceUrl,
        attempts,
        report,
        browserState,
        deps,
      };
      let result = null;

      if (networkMode === NETWORK_MODE_DIRECT) {
        result = await fetchWithMode(context, NETWORK_MODE_DIRECT);
      } else if (networkMode === NETWORK_MODE_BROWSER) {
        result = await fetchWithMode(context, NETWORK_MODE_BROWSER);
      } else {
        result = await fetchWithMode(context, NETWORK_MODE_DIRECT);
        if (!result.ok) {
          result = await fetchWithMode(context, NETWORK_MODE_BROWSER);
        }
      }

      if (!result.ok) {
        const errorMessage = result.errorMessage || "Falha ao buscar breakdown.";
        errors.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          classification: player.classification || "",
          error_message: errorMessage,
        });
        summaries.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          classification: player.classification || "",
          from_cache: "false",
          rows_found: 0,
          status: "error",
          error_message: errorMessage,
          raw_file: "",
        });
        continue;
      }

      const rawFile = await saveBreakdown({
        outputDir,
        player,
        sourceUrl,
        json: result.json,
      });
      const rows = extractLedgerRowsFromRankingPoints({
        json: result.json,
        player,
        sourceUrl,
      });
      byPlayerId.set(player.player_id, rows);
      summaries.push({
        player_id: player.player_id,
        player_name: player.player_name,
        gender: player.gender,
        classification: player.classification || "",
        from_cache: "false",
        rows_found: rows.length,
        status: "ok",
        error_message: "",
        raw_file: displayPath(rawFile, outputDir),
      });
    }
  } finally {
    await closeBrowserState(browserState);
  }

  return {
    byPlayerId,
    summaries,
    errors,
    attempts,
    networkReport: report,
  };
}

function assertNoDuplicateIds(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    const id = cleanText(row.player_id);
    if (!id) throw new Error(`${label}: linha sem player_id.`);
    if (seen.has(id)) throw new Error(`${label}: player_id duplicado ${id}.`);
    seen.add(id);
  }
}

export function validateInputs({
  validationSummary,
  officialPlayers,
  officialSnapshot,
  playersToRefresh,
  playersToPreserve,
  newEntrants,
  removedPlayers,
  rankingDate,
}) {
  const errors = [];

  if (validationSummary.comparison_completed !== true) {
    errors.push("validation_summary.comparison_completed precisa ser true.");
  }
  if (validationSummary.baseline_valid !== true) {
    errors.push("validation_summary.baseline_valid precisa ser true.");
  }
  if (validationSummary.official_snapshot_valid !== true) {
    errors.push("validation_summary.official_snapshot_valid precisa ser true.");
  }
  if (validationSummary.new_ranking_date_received !== rankingDate) {
    errors.push(`new_ranking_date_received precisa ser ${rankingDate}.`);
  }
  if (Number(validationSummary.official_total) !== 1000) {
    errors.push("official_total precisa ser 1000.");
  }
  if (Number(validationSummary.official_male) !== 500) {
    errors.push("official_male precisa ser 500.");
  }
  if (Number(validationSummary.official_female) !== 500) {
    errors.push("official_female precisa ser 500.");
  }
  if (officialPlayers.length !== 1000) {
    errors.push(`official_players.csv precisa ter 1000 linhas, recebeu ${officialPlayers.length}.`);
  }
  if (officialSnapshot.length !== 1000) {
    errors.push(`official_rankings_snapshot.csv precisa ter 1000 linhas, recebeu ${officialSnapshot.length}.`);
  }
  if (playersToRefresh.length !== Number(validationSummary.players_to_refresh)) {
    errors.push("players_to_refresh.csv diverge do summary.");
  }
  if (playersToRefresh.length !== Number(validationSummary.point_differences) + Number(validationSummary.new_top500_entrants)) {
    errors.push("players_to_refresh precisa ser point_difference + new_top500_entrant.");
  }
  if (Number(validationSummary.missing_ledger) !== 0) {
    errors.push("missing_ledger precisa ser zero.");
  }
  if (newEntrants.length !== Number(validationSummary.new_top500_entrants)) {
    errors.push("new_top500_entrants.csv diverge do summary.");
  }
  if (removedPlayers.length !== Number(validationSummary.removed_from_top500)) {
    errors.push("removed_from_top500.csv diverge do summary.");
  }

  try {
    assertNoDuplicateIds(playersToRefresh, "players_to_refresh.csv");
    assertNoDuplicateIds(officialPlayers, "official_players.csv");
    assertNoDuplicateIds(officialSnapshot, "official_rankings_snapshot.csv");
  } catch (err) {
    errors.push(err.message);
  }

  const refreshClasses = playersToRefresh.reduce((counts, row) => {
    counts[row.classification] = (counts[row.classification] || 0) + 1;
    return counts;
  }, {});

  if ((refreshClasses.point_difference || 0) !== Number(validationSummary.point_differences)) {
    errors.push("Quantidade de point_difference em players_to_refresh diverge do summary.");
  }
  if ((refreshClasses.new_top500_entrant || 0) !== Number(validationSummary.new_top500_entrants)) {
    errors.push("Quantidade de new_top500_entrant em players_to_refresh diverge do summary.");
  }

  return {
    valid: errors.length === 0,
    errors,
    playersToRefresh: playersToRefresh.length,
    playersToPreserve: playersToPreserve.length,
    pointDifferencePlayers: Number(validationSummary.point_differences) || 0,
    newPlayers: Number(validationSummary.new_top500_entrants) || 0,
    removedPlayers: Number(validationSummary.removed_from_top500) || 0,
  };
}

export function buildPlayersNext({ officialPlayers, oldPlayers }) {
  const oldById = new Map(oldPlayers.map((row) => [cleanText(row.player_id), row]));
  return officialPlayers.map((official) => {
    const old = oldById.get(cleanText(official.player_id)) || {};
    const merged = { ...old, ...official };
    for (const [key, value] of Object.entries(old)) {
      if (cleanText(merged[key]) === "" && cleanText(value) !== "") {
        merged[key] = value;
      }
    }
    merged.first_seen_date = cleanText(old.first_seen_date || official.first_seen_date);
    return merged;
  });
}

export function sortLedgerRows(rows) {
  return [...rows].sort((a, b) => {
    const keyDiff = buildResultKey(a).localeCompare(buildResultKey(b));
    if (keyDiff !== 0) return keyDiff;
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
}

export function buildReconciledLedger({
  weekCloseLedgerRows,
  playersNextRows,
  playersToRefresh,
  removedPlayers,
  breakdownRowsByPlayer,
}) {
  const officialIds = new Set(playersNextRows.map((row) => cleanText(row.player_id)));
  const refreshIds = new Set(playersToRefresh.map((row) => cleanText(row.player_id)));
  const removedIds = new Set(removedPlayers.map((row) => cleanText(row.player_id)));
  const preservedRows = [];
  const removedArchiveRows = [];
  const refreshedOldRows = [];

  for (const row of weekCloseLedgerRows) {
    const playerId = cleanText(row.player_id);
    if (removedIds.has(playerId)) {
      removedArchiveRows.push(row);
      continue;
    }
    if (!officialIds.has(playerId)) {
      continue;
    }
    if (refreshIds.has(playerId)) {
      refreshedOldRows.push(row);
      continue;
    }
    preservedRows.push(row);
  }

  const addedRows = [];
  for (const playerId of refreshIds) {
    const rows = breakdownRowsByPlayer.get(playerId) || [];
    addedRows.push(...rows.filter((row) => officialIds.has(cleanText(row.player_id))));
  }

  return {
    nextRows: sortLedgerRows([...preservedRows, ...addedRows]),
    preservedRows,
    refreshedOldRows,
    addedRows,
    removedArchiveRows,
  };
}

export function validateLedgerForOfficialPlayers({ ledgerRows, playersNextRows }) {
  const officialIds = new Set(playersNextRows.map((row) => cleanText(row.player_id)));
  const seen = new Set();
  const errors = [];

  for (const row of ledgerRows) {
    const playerId = cleanText(row.player_id);
    const key = buildResultKey(row);
    if (!officialIds.has(playerId)) {
      errors.push(`Jogador fora do Top 1000 oficial no ledger: ${playerId}`);
    }
    if (cleanText(row.is_live).toLowerCase() === "true") {
      errors.push(`Linha is_live=true: ${key}`);
    }
    if (seen.has(key)) {
      errors.push(`Duplicata pela identidade do ledger: ${key}`);
    }
    seen.add(key);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function countExpiredRowsIgnored(ledgerRows, dropCutoff) {
  return ledgerRows.filter((row) => {
    const dropDate = cleanText(row.drop_date_calculated);
    return isIsoDate(dropDate) && dropDate <= dropCutoff;
  }).length;
}

export function runFinalValidation({
  ledgerRows,
  snapshotRows,
  dropCutoff,
  policy = FINAL_VALIDATION_POLICY,
}) {
  const calculatedRows = calculateLedgerPoints(ledgerRows, {
    policy,
    dropCutoff,
  });
  const comparison = compareCalculatedAgainstSnapshot(calculatedRows, snapshotRows, {
    baselinePolicy: policy,
  });
  const ledgerPlayers = new Set(ledgerRows.map((row) => cleanText(row.player_id)).filter(Boolean));
  const officialIds = new Set(snapshotRows.map((row) => cleanText(row.player_id)).filter(Boolean));
  const outside = [...ledgerPlayers].filter((id) => !officialIds.has(id));
  const missing = [...officialIds].filter((id) => !ledgerPlayers.has(id));

  return {
    comparison,
    finalTotal: comparison.total,
    finalExact: comparison.exact,
    finalPercentage:
      comparison.total > 0
        ? Number(((comparison.exact / comparison.total) * 100).toFixed(2))
        : 0,
    finalDivergent: comparison.rows.filter((row) => row.exact_match !== "true").length,
    finalMissingLedger: missing.length,
    uniqueLedgerPlayers: ledgerPlayers.size,
    ledgerPlayersOutsideOfficial: outside.length,
    finalValidationPolicy: policy,
    finalDropCutoff: dropCutoff,
    finalExpiredRowsIgnored:
      policy === STAGED_POLICY ? countExpiredRowsIgnored(ledgerRows, dropCutoff) : 0,
    outside,
    missing,
  };
}

export function buildUnresolvedRows(finalValidation) {
  const unresolved = finalValidation.comparison.rows.filter(
    (row) => row.exact_match !== "true"
  );
  const missing = new Set(finalValidation.missing);
  for (const row of finalValidation.comparison.rows) {
    if (missing.has(cleanText(row.player_id)) && !unresolved.includes(row)) {
      unresolved.push(row);
    }
  }
  return unresolved;
}

export function isSafeForPromotion({
  inputValidation,
  fetchResult,
  ledgerValidation,
  finalValidation,
  expectedOfficialTotal = 1000,
}) {
  return (
    inputValidation.valid &&
    fetchResult.errors.length === 0 &&
    ledgerValidation.valid &&
    finalValidation.finalTotal === expectedOfficialTotal &&
    finalValidation.finalExact === expectedOfficialTotal &&
    finalValidation.finalDivergent === 0 &&
    finalValidation.finalMissingLedger === 0 &&
    finalValidation.uniqueLedgerPlayers === expectedOfficialTotal &&
    finalValidation.ledgerPlayersOutsideOfficial === 0 &&
    fetchResult.errors.length === 0 &&
    fetchResult.networkReport.get_rankings_calls === 0
  );
}

export async function loadReconciliationInputs({
  validationDir,
  weekCloseDir,
  oldPlayersFile,
}) {
  const requiredValidationFiles = [
    "official_players.csv",
    "official_rankings_snapshot.csv",
    "players_to_refresh.csv",
    "players_to_preserve.csv",
    "new_top500_entrants.csv",
    "removed_from_top500.csv",
    "validation_summary.json",
  ];
  for (const file of requiredValidationFiles) {
    const fullPath = path.join(validationDir, file);
    if (!(await fileExists(fullPath))) {
      throw new Error(`Arquivo obrigatorio ausente: ${fullPath}`);
    }
  }
  const weekCloseLedgerFile = path.join(weekCloseDir, "points_ledger.next.csv");
  if (!(await fileExists(weekCloseLedgerFile))) {
    throw new Error(`Arquivo obrigatorio ausente: ${weekCloseLedgerFile}`);
  }

  return {
    officialPlayers: await readCsv(path.join(validationDir, "official_players.csv")),
    officialSnapshot: await readCsv(path.join(validationDir, "official_rankings_snapshot.csv")),
    playersToRefresh: await readCsv(path.join(validationDir, "players_to_refresh.csv")),
    playersToPreserve: await readCsv(path.join(validationDir, "players_to_preserve.csv")),
    newEntrants: await readCsv(path.join(validationDir, "new_top500_entrants.csv")),
    removedPlayers: await readCsv(path.join(validationDir, "removed_from_top500.csv")),
    validationSummary: JSON.parse(await fs.readFile(path.join(validationDir, "validation_summary.json"), "utf8")),
    weekCloseLedgerRows: await readCsv(weekCloseLedgerFile),
    oldPlayers: await readCsv(oldPlayersFile),
  };
}

export function mapRefreshPlayers(playersToRefresh, officialPlayers) {
  const officialById = new Map(officialPlayers.map((row) => [cleanText(row.player_id), row]));
  return playersToRefresh.map((row) => ({
    ...(officialById.get(cleanText(row.player_id)) || {}),
    ...row,
    player_id: cleanText(row.player_id),
    player_name:
      cleanText(row.player_name) ||
      cleanText(officialById.get(cleanText(row.player_id))?.player_name),
    gender:
      cleanText(row.gender) ||
      cleanText(officialById.get(cleanText(row.player_id))?.gender),
    country: cleanText(officialById.get(cleanText(row.player_id))?.country),
    country_name: cleanText(officialById.get(cleanText(row.player_id))?.country_name),
    birth_year: cleanText(officialById.get(cleanText(row.player_id))?.birth_year),
  }));
}

export async function writeReconciliationArtifacts({
  outputDir,
  playersNext,
  snapshotNext,
  ledgerNext,
  fetchResult,
  playersToRefresh,
  playersToPreserve,
  newEntrants,
  removedPlayers,
  removedArchiveRows,
  finalValidation,
  summary,
}) {
  await writeCsv(path.join(outputDir, "players.next.csv"), playersNext, OFFICIAL_PLAYER_COLUMNS);
  await writeCsv(path.join(outputDir, "rankings_snapshot.next.csv"), snapshotNext, OFFICIAL_SNAPSHOT_COLUMNS);
  await writeCsv(path.join(outputDir, "points_ledger.next_official.csv"), ledgerNext, LEDGER_COLUMNS);
  await writeCsv(path.join(outputDir, "breakdown_fetch_summary.csv"), fetchResult.summaries, FETCH_SUMMARY_COLUMNS);
  await writeCsv(
    path.join(outputDir, "breakdown_fetch_errors.csv"),
    fetchResult.errors,
    PLAYER_FETCH_ERROR_COLUMNS
  );
  await writeCsv(path.join(outputDir, "breakdown_network_attempts.csv"), fetchResult.attempts, FETCH_ATTEMPT_COLUMNS);
  await writeCsv(path.join(outputDir, "players_refreshed.csv"), playersToRefresh, PLAYER_AUDIT_COLUMNS);
  await writeCsv(path.join(outputDir, "players_preserved.csv"), playersToPreserve, PLAYER_AUDIT_COLUMNS);
  await writeCsv(path.join(outputDir, "players_added.csv"), newEntrants, PLAYER_AUDIT_COLUMNS);
  await writeCsv(path.join(outputDir, "players_removed.csv"), removedPlayers, PLAYER_AUDIT_COLUMNS);
  await writeCsv(path.join(outputDir, "removed_players_ledger_archive.csv"), removedArchiveRows, LEDGER_COLUMNS);
  await writeCsv(path.join(outputDir, "final_validation.csv"), finalValidation.comparison.rows, FINAL_VALIDATION_COLUMNS);
  await writeCsv(path.join(outputDir, "unresolved_players.csv"), buildUnresolvedRows(finalValidation), FINAL_VALIDATION_COLUMNS);
  await writeJson(path.join(outputDir, "official_reconciliation_summary.json"), summary);
  await writeJson(path.join(outputDir, "network_report.json"), fetchResult.networkReport);
}
