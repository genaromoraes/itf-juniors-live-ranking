import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");
const OUT_DIR = path.resolve("data/raw/tournament_api_discovery");
const IS_CI = process.env.CI === "true";

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

function safeJsonParse(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
    headless: IS_CI ? true : false,
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

  const capturedRequests = [];
  const capturedResponses = [];

  page.on("request", async (request) => {
    try {
      const url = request.url();

      if (!url.includes("itftennis.com")) return;
      if (!url.toLowerCase().includes("getdrawsheet")) return;

      const headers = request.headers();
      const postData = request.postData();

      const item = {
        type: "request",
        url,
        method: request.method(),
        headers,
        postData,
        postDataParsed: safeJsonParse(postData),
      };

      capturedRequests.push(item);

      console.log("");
      console.log("========================================");
      console.log("REQUEST GetDrawsheet CAPTURADO");
      console.log("Method:", item.method);
      console.log("URL:", item.url);
      console.log("PostData:");
      console.log(postData);
      console.log("========================================");
    } catch (err) {
      console.log("Erro capturando request:", err.message);
    }
  });

  page.on("response", async (response) => {
    try {
      const url = response.url();

      if (!url.includes("itftennis.com")) return;
      if (!url.toLowerCase().includes("getdrawsheet")) return;

      const contentType = response.headers()["content-type"] || "";
      let json = null;
      let textStart = "";

      try {
        if (contentType.toLowerCase().includes("json")) {
          json = await response.json();
        } else {
          const text = await response.text();
          textStart = text.slice(0, 500);
        }
      } catch {
        textStart = "Não consegui ler o corpo da resposta.";
      }

      const item = {
        type: "response",
        url,
        status: response.status(),
        contentType,
        json,
        textStart,
      };

      capturedResponses.push(item);

      console.log("");
      console.log("========================================");
      console.log("RESPONSE GetDrawsheet CAPTURADO");
      console.log("Status:", item.status);
      console.log("URL:", item.url);
      if (json) {
        console.log("Top-level keys:", Object.keys(json));
        console.log("eventId:", json.eventId);
        console.log("koGroups:", Array.isArray(json.koGroups) ? json.koGroups.length : null);
      } else {
        console.log("Text:", textStart);
      }
      console.log("========================================");
    } catch (err) {
      console.log("Erro capturando response:", err.message);
    }
  });

  console.log("");
  console.log("Abrindo página do torneio...");
  console.log("");
  console.log("Quando abrir:");
  console.log("1. Clique em Draws ou Results.");
  console.log("2. Clique em Boys Singles Main Draw.");
  console.log("3. Depois clique em Girls Singles Main Draw.");
  console.log("4. Se tiver Doubles, clique também.");
  console.log("");
  console.log("O navegador ficará aberto por 120 segundos.");
  console.log("");

  await page.goto(tournamentUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(120000);

  const outputFile = path.join(
    OUT_DIR,
    `${TARGET_TOURNAMENT_KEY}_drawsheet_requests.json`
  );

  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        tournament: target,
        tournament_url: tournamentUrl,
        captured_requests_count: capturedRequests.length,
        captured_responses_count: capturedResponses.length,
        captured_requests: capturedRequests,
        captured_responses: capturedResponses,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log("Finalizado.");
  console.log(`Requests capturados: ${capturedRequests.length}`);
  console.log(`Responses capturadas: ${capturedResponses.length}`);
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
