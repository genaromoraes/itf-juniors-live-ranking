import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { getActiveBaseLimitPerGender } from "./lib/ranking_limits.mjs";

const LIMIT_PER_GENDER = getActiveBaseLimitPerGender();
const IS_CI = process.env.CI === "true";

// Controle de velocidade
const DELAY_BETWEEN_PLAYERS_MS = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15000;
const BLOCK_DELAY_MS = 45000;

const PLAYERS_FILE = path.resolve("data/clean/players.csv");

const OUT_DIR_RAW = path.resolve("data/raw/breakdowns");
const OUT_DIR_CLEAN = path.resolve("data/clean");

const POINTS_LEDGER_FILE = path.join(OUT_DIR_CLEAN, "points_ledger.csv");
const SUMMARY_FILE = path.join(OUT_DIR_CLEAN, "breakdown_summary.csv");
const ERRORS_FILE = path.join(OUT_DIR_CLEAN, "breakdown_errors.csv");

const TODAY = new Date().toISOString().slice(0, 10);

const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : "";
}

function normalizeUrl(value) {
  if (!value) return "";
  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function parseItfDate(value) {
  if (!value) return "";

  const text = String(value).trim();
  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toISOString().slice(0, 10);
}

function calculateDropDate(startDateRaw) {
  const normalized = parseItfDate(startDateRaw);

  if (!normalized || !normalized.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return "";
  }

  const date = new Date(`${normalized}T00:00:00Z`);

  // Domingo pertence à semana oficial iniciada na segunda seguinte.
  if (date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  date.setDate(date.getDate() + 364);

  return date.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCsvIfExists(filePath) {
  try {
    const csv = await fs.readFile(filePath, "utf8");

    return parse(csv, {
      columns: true,
      skip_empty_lines: true,
    });
  } catch {
    return [];
  }
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

async function readPlayers() {
  const csv = await fs.readFile(PLAYERS_FILE, "utf8");

  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });

  return records.map((p) => ({
    ...p,
    profile_url: normalizeUrl(p.profile_url),
  }));
}

function selectPlayers(players) {
  const boys = players
    .filter((p) => p.gender === "M")
    .sort((a, b) => Number(a.current_rank) - Number(b.current_rank))
    .slice(0, LIMIT_PER_GENDER);

  const girls = players
    .filter((p) => p.gender === "F")
    .sort((a, b) => Number(a.current_rank) - Number(b.current_rank))
    .slice(0, LIMIT_PER_GENDER);

  return [...boys, ...girls];
}

function buildRankingPointsUrl(playerId, matchTypeCode = "S") {
  const params = new URLSearchParams({
    circuitCode: "JT",
    matchTypeCode,
    playerId: String(playerId),
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetRankingPoints?${params.toString()}`;
}

function looksBlockedOrHtml(result) {
  const contentType = String(result?.contentType || "").toLowerCase();
  const textStart = String(result?.textStart || "").toLowerCase();

  if (contentType.includes("text/html")) return true;
  if (textStart.includes("_incapsula_resource")) return true;
  if (textStart.includes("incapsula")) return true;
  if (textStart.includes("imperva")) return true;
  if (textStart.includes("<html")) return true;

  return false;
}

async function fetchJsonInsideBrowser(page, url) {
  return await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: response.ok,
        status: response.status,
        contentType,
        textStart: text.slice(0, 500),
        json: null,
      };
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      textStart: "",
      json,
    };
  }, url);
}

function normalizeBreakdownRow({
  player,
  sectionTitle,
  countableStatus,
  item,
  sourceUrl,
}) {
  const eventType =
    sectionTitle && sectionTitle.toLowerCase().includes("double")
      ? "doubles"
      : "singles";

  const startDate = parseItfDate(item.startDate);
  const dropDate = calculateDropDate(item.startDate);

  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    country: player.country,
    country_name: player.country_name,
    birth_year: player.birth_year,

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
    drop_date_calculated: dropDate,

    round: cleanText(item.round),
    points: toNumber(item.points),

    tournament_link: normalizeUrl(item.tournamentLink),

    is_countable_at_collection:
      countableStatus === "countable" ? "true" : "false",

    is_live: "false",
    status: "confirmed_from_initial_breakdown",

    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
    raw_json: JSON.stringify(item),
  };
}

function extractLedgerRowsFromRankingPoints(json, player, sourceUrl) {
  const rows = [];

  const sections = json?.countable || [];

  for (const section of sections) {
    const sectionTitle = section.title || "";

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
        })
      );
    }
  }

  return rows;
}

function getSection(json, name) {
  const sections = json?.countable || [];

  return sections.find((s) =>
    String(s.title || "").toLowerCase().includes(name)
  );
}

function extractSummaryFromRankingPoints(json, player, sourceUrl, rows) {
  const singlesSection = getSection(json, "single");
  const doublesSection = getSection(json, "double");

  const singlesCountable =
    Number(singlesSection?.countablePoints?.totalPoints || 0);

  const doublesCountable =
    Number(doublesSection?.countablePoints?.totalPoints || 0);

  const calculatedTotal = singlesCountable + doublesCountable / 4;

  const officialPoints = Number(player.current_points || 0);

  return {
    player_id: player.player_id,
    player_name: player.player_name,
    gender: player.gender,
    rank: player.current_rank,
    official_points: player.current_points,

    total_label: json?.Value?.label || "",
    total_value: json?.Value?.Value || "",

    singles_countable_total:
      singlesSection?.countablePoints?.totalPoints ?? "",
    singles_non_countable_total:
      singlesSection?.nonCountablePoints?.totalPoints ?? "",

    doubles_countable_total:
      doublesSection?.countablePoints?.totalPoints ?? "",
    doubles_non_countable_total:
      doublesSection?.nonCountablePoints?.totalPoints ?? "",

    calculated_total: calculatedTotal,
    difference_vs_official: officialPoints
      ? Number((calculatedTotal - officialPoints).toFixed(2))
      : "",

    rows_found: rows.length,
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
  };
}

function getRawFilePath(player) {
  return path.join(
    OUT_DIR_RAW,
    `${player.gender}_${player.current_rank}_${player.player_id}_${TODAY}.json`
  );
}

async function readCachedBreakdown(player) {
  const rawFile = getRawFilePath(player);

  try {
    const text = await fs.readFile(rawFile, "utf8");
    const parsed = JSON.parse(text);

    if (parsed?.json) {
      return {
        rawFile,
        sourceUrl: parsed.source_url,
        json: parsed.json,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function saveRawBreakdown(player, sourceUrl, json) {
  const rawFile = getRawFilePath(player);

  await fs.writeFile(
    rawFile,
    JSON.stringify(
      {
        player,
        source_url: sourceUrl,
        json,
      },
      null,
      2
    ),
    "utf8"
  );

  return rawFile;
}

async function fetchPlayerBreakdownOnce(page, player) {
  const url = buildRankingPointsUrl(player.player_id, "S");

  const result = await fetchJsonInsideBrowser(page, url);

  if (!result.ok || !result.json) {
    const isBlocked = looksBlockedOrHtml(result);

    const error = new Error(
      `HTTP ${result.status}. Content-Type: ${result.contentType}. Text: ${result.textStart}`
    );

    error.isBlocked = isBlocked;
    throw error;
  }

  await saveRawBreakdown(player, url, result.json);

  const rows = extractLedgerRowsFromRankingPoints(result.json, player, url);

  const summary = extractSummaryFromRankingPoints(
    result.json,
    player,
    url,
    rows
  );

  return {
    fromCache: false,
    rows,
    summary,
  };
}

async function fetchPlayerBreakdown(page, player) {
  const cached = await readCachedBreakdown(player);

  if (cached) {
    const rows = extractLedgerRowsFromRankingPoints(
      cached.json,
      player,
      cached.sourceUrl
    );

    const summary = extractSummaryFromRankingPoints(
      cached.json,
      player,
      cached.sourceUrl,
      rows
    );

    return {
      fromCache: true,
      rows,
      summary,
    };
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${MAX_RETRIES}`);

      return await fetchPlayerBreakdownOnce(page, player);
    } catch (err) {
      lastError = err;

      if (err.isBlocked) {
        console.log(
          `Possível bloqueio/HTML detectado. Esperando ${BLOCK_DELAY_MS / 1000}s antes de tentar de novo...`
        );
        await sleep(BLOCK_DELAY_MS);
      } else if (attempt < MAX_RETRIES) {
        console.log(
          `Erro temporário. Esperando ${RETRY_DELAY_MS / 1000}s antes de tentar de novo...`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function buildExistingDoneSet(summaryRows) {
  const done = new Set();

  for (const row of summaryRows) {
    if (row.player_id) {
      done.add(String(row.player_id));
    }
  }

  return done;
}

function removeRowsForPlayers(rows, playerIds) {
  const ids = new Set(playerIds.map(String));

  return rows.filter((row) => !ids.has(String(row.player_id)));
}

async function main() {
  await ensureDirs();

  const players = await readPlayers();
  const selectedPlayers = selectPlayers(players);

  let ledgerRows = await readCsvIfExists(POINTS_LEDGER_FILE);
  let summaryRows = await readCsvIfExists(SUMMARY_FILE);
  let errorRows = await readCsvIfExists(ERRORS_FILE);

  const doneSet = buildExistingDoneSet(summaryRows);

  console.log("");
  console.log(`Jogadores carregados: ${players.length}`);
  console.log(`Jogadores selecionados: ${selectedPlayers.length}`);
  console.log(`Limite atual: ${LIMIT_PER_GENDER} boys + ${LIMIT_PER_GENDER} girls`);
  console.log(`Já processados no resumo: ${doneSet.size}`);
  console.log("");
  console.log(`Pausa entre jogadores: ${DELAY_BETWEEN_PLAYERS_MS / 1000}s`);
  console.log(`Tentativas por jogador: ${MAX_RETRIES}`);
  console.log("");

  console.log("Abrindo navegador para criar sessão com a ITF...");

  const browser = await chromium.launch({
    headless: IS_CI ? true : false,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 900,
    },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    await page.goto(RANKING_PAGE, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(3000);

    for (let i = 0; i < selectedPlayers.length; i++) {
      const player = selectedPlayers[i];

      if (doneSet.has(String(player.player_id))) {
        console.log(
          `[${i + 1}/${selectedPlayers.length}] Pulando já processado: ${player.current_rank} - ${player.player_name}`
        );
        continue;
      }

      console.log("");
      console.log(
        `[${i + 1}/${selectedPlayers.length}] Buscando breakdown: ${player.current_rank} - ${player.player_name}`
      );

      try {
        const result = await fetchPlayerBreakdown(page, player);

        ledgerRows = removeRowsForPlayers(ledgerRows, [player.player_id]);
        ledgerRows.push(...result.rows);

        summaryRows = summaryRows.filter(
          (row) => String(row.player_id) !== String(player.player_id)
        );
        summaryRows.push(result.summary);

        errorRows = errorRows.filter(
          (row) => String(row.player_id) !== String(player.player_id)
        );

        doneSet.add(String(player.player_id));

        console.log(
          `OK: ${result.rows.length} linhas ${result.fromCache ? "(cache)" : ""}`
        );
      } catch (err) {
        console.log(`ERRO: ${err.message}`);

        errorRows = errorRows.filter(
          (row) => String(row.player_id) !== String(player.player_id)
        );

        errorRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: player.current_rank,
          error_message: err.message,
          collected_at: new Date().toISOString(),
        });
      }

      await writeCsv(POINTS_LEDGER_FILE, ledgerRows, [
        "player_id",
        "player_name",
        "gender",
        "country",
        "country_name",
        "birth_year",
        "event_type",
        "countable_status",
        "tournament_name",
        "category",
        "draw_type",
        "host_nation",
        "host_nation_code",
        "surface",
        "surface_code",
        "start_date",
        "drop_date_calculated",
        "round",
        "points",
        "tournament_link",
        "is_countable_at_collection",
        "is_live",
        "status",
        "source_url",
        "collected_at",
        "raw_json",
      ]);

      await writeCsv(SUMMARY_FILE, summaryRows, [
        "player_id",
        "player_name",
        "gender",
        "rank",
        "official_points",
        "total_label",
        "total_value",
        "singles_countable_total",
        "singles_non_countable_total",
        "doubles_countable_total",
        "doubles_non_countable_total",
        "calculated_total",
        "difference_vs_official",
        "rows_found",
        "source_url",
        "collected_at",
      ]);

      await writeCsv(ERRORS_FILE, errorRows, [
        "player_id",
        "player_name",
        "gender",
        "rank",
        "error_message",
        "collected_at",
      ]);

      console.log(`Aguardando ${DELAY_BETWEEN_PLAYERS_MS / 1000}s...`);
      await page.waitForTimeout(DELAY_BETWEEN_PLAYERS_MS);
    }

    console.log("");
    console.log("Finalizado.");
    console.log("");
    console.log("Arquivos gerados/atualizados:");
    console.log("data/clean/points_ledger.csv");
    console.log("data/clean/breakdown_summary.csv");
    console.log("data/clean/breakdown_errors.csv");
    console.log("data/raw/breakdowns/");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});
