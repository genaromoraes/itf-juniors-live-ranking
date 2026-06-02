import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");
const OUT_DIR = path.resolve("data/raw/tournament_api_discovery");

const TARGET_TOURNAMENT_KEY = "J-JGS-FRA-2026-001";

async function ensureDirs() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

function normalizeUrl(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function summarizeJson(value, depth = 0) {
  if (depth > 3) return "...";

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      firstItem: value.length ? summarizeJson(value[0], depth + 1) : null,
    };
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const [key, child] of Object.entries(value).slice(0, 40)) {
      output[key] = summarizeJson(child, depth + 1);
    }

    return output;
  }

  return value;
}

function findArraysDeep(value, arrays = []) {
  if (!value) return arrays;

  if (Array.isArray(value)) {
    arrays.push(value);

    for (const item of value) {
      findArraysDeep(item, arrays);
    }

    return arrays;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      findArraysDeep(child, arrays);
    }
  }

  return arrays;
}

function scoreArray(arr) {
  if (!Array.isArray(arr)) return 0;

  let score = 0;

  for (const item of arr.slice(0, 10)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const keys = Object.keys(item).map((k) => k.toLowerCase());
    const joined = keys.join(" ");

    if (joined.includes("match")) score += 3;
    if (joined.includes("draw")) score += 3;
    if (joined.includes("round")) score += 2;
    if (joined.includes("score")) score += 2;
    if (joined.includes("winner")) score += 2;
    if (joined.includes("player")) score += 2;
    if (joined.includes("side")) score += 1;
    if (joined.includes("event")) score += 1;
    if (joined.includes("singles")) score += 1;
    if (joined.includes("doubles")) score += 1;
  }

  return score;
}

function getInterestingArrays(json) {
  const arrays = findArraysDeep(json);

  return arrays
    .map((arr) => ({
      length: arr.length,
      score: scoreArray(arr),
      sample:
        arr.length && typeof arr[0] === "object"
          ? arr[0]
          : arr.slice(0, 5),
      sampleKeys:
        arr.length && typeof arr[0] === "object" ? Object.keys(arr[0]) : [],
    }))
    .filter((x) => x.length > 0)
    .sort((a, b) => b.score - a.score || b.length - a.length)
    .slice(0, 15);
}

function isRelevantTournamentApi(url) {
  const lower = url.toLowerCase();

  if (!url.includes("itftennis.com")) return false;

  return (
    lower.includes("tournament") ||
    lower.includes("draw") ||
    lower.includes("match") ||
    lower.includes("result") ||
    lower.includes("event") ||
    lower.includes("score")
  );
}

async function main() {
  await ensureDirs();

  const tournaments = await readCsv(WEEK_TOURNAMENTS_FILE);

  const target = tournaments.find(
    (t) => t.tournament_key === TARGET_TOURNAMENT_KEY
  );

  if (!target) {
    throw new Error(
      `Não encontrei o torneio ${TARGET_TOURNAMENT_KEY} em week_tournaments.csv`
    );
  }

  const tournamentUrl = normalizeUrl(target.tournament_link);

  console.log("");
  console.log("Torneio alvo:");
  console.log(`${target.tournament_name} | ${target.tournament_key}`);
  console.log(tournamentUrl);

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1500,
      height: 950,
    },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });

  const page = await context.newPage();

  const captured = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";

      if (!isRelevantTournamentApi(url)) return;
      if (!contentType.toLowerCase().includes("json")) return;

      const json = await response.json();
      const interestingArrays = getInterestingArrays(json);

      const item = {
        url,
        status: response.status(),
        contentType,
        summary: summarizeJson(json),
        interestingArrays,
      };

      captured.push(item);

      console.log("");
      console.log("========================================");
      console.log("JSON relevante capturado");
      console.log("URL:");
      console.log(url);
      console.log("Arrays interessantes:");
      console.log(
        interestingArrays.map((x) => ({
          length: x.length,
          score: x.score,
          sampleKeys: x.sampleKeys,
        }))
      );
      console.log("========================================");
    } catch {
      // ignora respostas que não conseguimos ler
    }
  });

  console.log("");
  console.log("Abrindo página do torneio...");
  console.log("");
  console.log("Quando o navegador abrir:");
  console.log("1. Espere carregar.");
  console.log("2. Procure por abas como Draws, Results, Matches ou Order of Play.");
  console.log("3. Clique nas opções de Boys/Girls, Singles/Doubles se aparecerem.");
  console.log("4. Role a página um pouco.");
  console.log("");
  console.log("O navegador ficará aberto por 120 segundos.");
  console.log("");

  await page.goto(tournamentUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(120000);

  const safeName = target.tournament_key.replace(/[^a-zA-Z0-9_-]/g, "_");

  const outputFile = path.join(
    OUT_DIR,
    `${safeName}_apis.json`
  );

  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        tournament: target,
        tournament_url: tournamentUrl,
        captured_count: captured.length,
        captured,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log("Finalizado.");
  console.log(`APIs capturadas: ${captured.length}`);
  console.log("Arquivo salvo em:");
  console.log(outputFile);

  await browser.close();
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});