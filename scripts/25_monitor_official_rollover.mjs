import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import {
  PAGE_SIZE,
  buildRankingUrl,
  cleanText,
  normalizeRankingDate,
} from "./lib/official_ledger_validation.mjs";

const NETWORK_MODE_AUTO = "auto";
const NETWORK_MODE_DIRECT = "direct";
const NETWORK_MODE_BROWSER = "browser";
const RANKING_PAGE_URL = "https://www.itftennis.com/en/rankings/juniors/";
const SNAPSHOT_FILE = path.resolve("data/clean/rankings_snapshot.csv");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

async function readCurrentRankingDate(snapshotFile = SNAPSHOT_FILE) {
  const rows = await readCsv(snapshotFile);
  const dates = [...new Set(rows.map((row) => cleanText(row.ranking_date)).filter(Boolean))];

  if (dates.length !== 1 || !isIsoDate(dates[0])) {
    throw new Error(
      `Nao foi possivel identificar uma unica ranking_date em ${snapshotFile}.`
    );
  }

  return dates[0];
}

function buildMonitorUrl() {
  return buildRankingUrl(
    { label: "boys", gender: "M", itfCode: "B" },
    0,
    PAGE_SIZE
  );
}

function parseRankDateFromResponse({ status, contentType, text, url }) {
  const lowerContentType = cleanText(contentType).toLowerCase();
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} ao consultar ${url}.`);
  }
  if (lowerContentType.includes("text/html")) {
    throw new Error(`Resposta HTML ao consultar ${url}.`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`JSON invalido ao consultar ${url}.`);
  }

  const rankDate = normalizeRankingDate(json?.rankDate);
  if (!isIsoDate(rankDate)) {
    throw new Error(`rankDate invalido ou ausente ao consultar ${url}.`);
  }

  return {
    rankDate,
    itemsFound: Array.isArray(json?.items) ? json.items.length : 0,
  };
}

async function fetchDirect(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    text: await response.text(),
    url,
  };
}

async function fetchBrowser(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    });
    await page.goto(RANKING_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    return await page.evaluate(async (targetUrl) => {
      const response = await fetch(targetUrl, {
        headers: { accept: "application/json, text/plain, */*" },
      });
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        text: await response.text(),
        url: targetUrl,
      };
    }, url);
  } finally {
    await browser.close();
  }
}

async function detectOfficialRankDate({ networkMode }) {
  const url = buildMonitorUrl();
  const attempts = [];

  if (networkMode === NETWORK_MODE_DIRECT || networkMode === NETWORK_MODE_AUTO) {
    try {
      const response = await fetchDirect(url);
      const parsed = parseRankDateFromResponse(response);
      attempts.push({
        mode: NETWORK_MODE_DIRECT,
        status: response.status,
        content_type: response.contentType,
        rank_date: parsed.rankDate,
        items_found: parsed.itemsFound,
        error: "",
      });
      return { ...parsed, url, attempts };
    } catch (error) {
      attempts.push({
        mode: NETWORK_MODE_DIRECT,
        status: "",
        content_type: "",
        rank_date: "",
        items_found: 0,
        error: error?.message || String(error),
      });
      if (networkMode === NETWORK_MODE_DIRECT) {
        throw Object.assign(error, { attempts });
      }
    }
  }

  if (networkMode === NETWORK_MODE_BROWSER || networkMode === NETWORK_MODE_AUTO) {
    try {
      const response = await fetchBrowser(url);
      const parsed = parseRankDateFromResponse(response);
      attempts.push({
        mode: NETWORK_MODE_BROWSER,
        status: response.status,
        content_type: response.contentType,
        rank_date: parsed.rankDate,
        items_found: parsed.itemsFound,
        error: "",
      });
      return { ...parsed, url, attempts };
    } catch (error) {
      attempts.push({
        mode: NETWORK_MODE_BROWSER,
        status: "",
        content_type: "",
        rank_date: "",
        items_found: 0,
        error: error?.message || String(error),
      });
      throw Object.assign(error, { attempts });
    }
  }

  throw new Error(`network-mode invalido: ${networkMode}`);
}

function classifyStatus({ oldRankingDate, expectedRankingDate, detectedRankingDate }) {
  if (oldRankingDate === expectedRankingDate) return "already_current";
  if (detectedRankingDate === expectedRankingDate) return "updated";
  if (detectedRankingDate < expectedRankingDate) return "waiting";
  return "unexpected_rank_date";
}

async function appendGithubOutput(values) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await fs.appendFile(outputFile, `${lines.join("\n")}\n`, "utf8");
}

async function writeJson(filePath, value) {
  if (!filePath) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runMonitor(rawArgs = {}) {
  const snapshotFile = rawArgs.snapshotFile || SNAPSHOT_FILE;
  const oldRankingDate =
    cleanText(rawArgs.oldRankingDate) || (await readCurrentRankingDate(snapshotFile));
  const expectedRankingDate =
    cleanText(rawArgs.expectedRankingDate) || addDays(oldRankingDate, 7);
  const weekStart = cleanText(rawArgs.weekStart) || oldRankingDate;
  const weekEnd = cleanText(rawArgs.weekEnd) || addDays(expectedRankingDate, -1);
  const dropCutoff = cleanText(rawArgs.dropCutoff) || weekEnd;
  const newWeekEnd = addDays(expectedRankingDate, 6);
  const networkMode = cleanText(rawArgs.networkMode || NETWORK_MODE_AUTO).toLowerCase();

  if (![NETWORK_MODE_AUTO, NETWORK_MODE_DIRECT, NETWORK_MODE_BROWSER].includes(networkMode)) {
    throw new Error("Use --network-mode=auto, direct ou browser.");
  }
  for (const [label, value] of Object.entries({
    oldRankingDate,
    expectedRankingDate,
    weekStart,
    weekEnd,
    dropCutoff,
    newWeekEnd,
  })) {
    if (!isIsoDate(value)) throw new Error(`${label} invalido: ${value}`);
  }

  let detection = null;
  let status = "network_error";
  let error = "";

  try {
    detection = await detectOfficialRankDate({ networkMode });
    status = classifyStatus({
      oldRankingDate,
      expectedRankingDate,
      detectedRankingDate: detection.rankDate,
    });
  } catch (caught) {
    error = caught?.message || String(caught);
    detection = {
      rankDate: "",
      itemsFound: 0,
      url: buildMonitorUrl(),
      attempts: caught?.attempts || [],
    };
  }

  const shouldRunRollover = status === "updated";
  const result = {
    status,
    should_run_rollover: shouldRunRollover,
    old_ranking_date: oldRankingDate,
    expected_ranking_date: expectedRankingDate,
    detected_ranking_date: detection.rankDate,
    week_start: weekStart,
    week_end: weekEnd,
    drop_cutoff: dropCutoff,
    new_week_start: expectedRankingDate,
    new_week_end: newWeekEnd,
    network_mode: networkMode,
    url: detection.url,
    items_found: detection.itemsFound,
    attempts: detection.attempts,
    error,
    checked_at: new Date().toISOString(),
  };

  await writeJson(rawArgs.outputFile, result);
  await appendGithubOutput({
    status,
    should_run_rollover: shouldRunRollover ? "true" : "false",
    old_ranking_date: oldRankingDate,
    expected_ranking_date: expectedRankingDate,
    detected_ranking_date: detection.rankDate,
    week_start: weekStart,
    week_end: weekEnd,
    drop_cutoff: dropCutoff,
    new_week_start: expectedRankingDate,
    new_week_end: newWeekEnd,
  });

  if (status === "unexpected_rank_date") {
    throw new Error(
      `rankDate inesperado: esperado ${expectedRankingDate}, recebido ${detection.rankDate}.`
    );
  }

  return result;
}

function parseArgs() {
  return {
    snapshotFile: path.resolve(readArg("snapshot-file", SNAPSHOT_FILE)),
    oldRankingDate: cleanText(readArg("old-ranking-date")),
    expectedRankingDate: cleanText(readArg("expected-ranking-date")),
    weekStart: cleanText(readArg("week-start")),
    weekEnd: cleanText(readArg("week-end")),
    dropCutoff: cleanText(readArg("drop-cutoff")),
    networkMode: cleanText(readArg("network-mode", NETWORK_MODE_AUTO)),
    outputFile: cleanText(readArg("output-file")),
  };
}

async function main() {
  const result = await runMonitor(parseArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
