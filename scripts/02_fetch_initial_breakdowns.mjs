import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const TEST_LIMIT_PER_GENDER = 10;

const PLAYERS_FILE = path.resolve("data/clean/players.csv");
const OUT_DIR_RAW = path.resolve("data/raw/breakdowns");
const OUT_DIR_CLEAN = path.resolve("data/clean");

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
  date.setDate(date.getDate() + 364);

  return date.toISOString().slice(0, 10);
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

function selectTestPlayers(players) {
  const boys = players
    .filter((p) => p.gender === "M")
    .sort((a, b) => Number(a.current_rank) - Number(b.current_rank))
    .slice(0, TEST_LIMIT_PER_GENDER);

  const girls = players
    .filter((p) => p.gender === "F")
    .sort((a, b) => Number(a.current_rank) - Number(b.current_rank))
    .slice(0, TEST_LIMIT_PER_GENDER);

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
        textStart: text.slice(0, 300),
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

function extractSummaryFromRankingPoints(json, player, sourceUrl, rows) {
  const sections = json?.countable || [];

  const singlesSection = sections.find((s) =>
    String(s.title || "").toLowerCase().includes("single")
  );

  const doublesSection = sections.find((s) =>
    String(s.title || "").toLowerCase().includes("double")
  );

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

    rows_found: rows.length,
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
  };
}

async function fetchPlayerBreakdown(page, player) {
  const url = buildRankingPointsUrl(player.player_id, "S");

  console.log("");
  console.log(
    `Buscando breakdown: ${player.current_rank} - ${player.player_name}`
  );
  console.log(url);

  const result = await fetchJsonInsideBrowser(page, url);

  if (!result.ok || !result.json) {
    throw new Error(
      `Falha buscando breakdown de ${player.player_name}. HTTP ${result.status}. ${result.textStart}`
    );
  }

  const rawFile = path.join(
    OUT_DIR_RAW,
    `${player.gender}_${player.current_rank}_${player.player_id}_${TODAY}.json`
  );

  await fs.writeFile(
    rawFile,
    JSON.stringify(
      {
        player,
        source_url: url,
        json: result.json,
      },
      null,
      2
    ),
    "utf8"
  );

  const rows = extractLedgerRowsFromRankingPoints(result.json, player, url);
  const summary = extractSummaryFromRankingPoints(
    result.json,
    player,
    url,
    rows
  );

  console.log(`Linhas encontradas: ${rows.length}`);

  return {
    rows,
    summary,
  };
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

async function main() {
  await ensureDirs();

  const players = await readPlayers();
  const testPlayers = selectTestPlayers(players);

  console.log(`Jogadores carregados: ${players.length}`);
  console.log(`Jogadores de teste: ${testPlayers.length}`);
  console.log(
    `Limite de teste: ${TEST_LIMIT_PER_GENDER} boys + ${TEST_LIMIT_PER_GENDER} girls`
  );

  console.log("");
  console.log("Abrindo navegador para criar sessão com a ITF...");

  const browser = await chromium.launch({
    headless: false,
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

  const ledgerRows = [];
  const summaryRows = [];

  try {
    await page.goto(RANKING_PAGE, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(3000);

    for (const player of testPlayers) {
      try {
        const result = await fetchPlayerBreakdown(page, player);

        ledgerRows.push(...result.rows);
        summaryRows.push(result.summary);

        await page.waitForTimeout(400);
      } catch (err) {
        console.log(`Erro com ${player.player_name}: ${err.message}`);

        summaryRows.push({
          player_id: player.player_id,
          player_name: player.player_name,
          gender: player.gender,
          rank: player.current_rank,
          official_points: player.current_points,
          total_label: "",
          total_value: "",
          singles_countable_total: "",
          singles_non_countable_total: "",
          doubles_countable_total: "",
          doubles_non_countable_total: "",
          rows_found: 0,
          source_url: "",
          collected_at: new Date().toISOString(),
        });
      }
    }

    await writeCsv(path.join(OUT_DIR_CLEAN, "points_ledger_test.csv"), ledgerRows, [
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

    await writeCsv(path.join(OUT_DIR_CLEAN, "breakdown_test_summary.csv"), summaryRows, [
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
      "rows_found",
      "source_url",
      "collected_at",
    ]);

    console.log("");
    console.log("Finalizado.");
    console.log("");
    console.log("Arquivos gerados:");
    console.log("data/clean/points_ledger_test.csv");
    console.log("data/clean/breakdown_test_summary.csv");
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