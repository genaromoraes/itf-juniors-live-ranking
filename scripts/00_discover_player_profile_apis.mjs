import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const OUT_DIR_RAW = path.resolve("data/raw");
const TODAY = new Date().toISOString().slice(0, 10);
const IS_CI = process.env.CI === "true";

const PLAYER_URL =
  "https://www.itftennis.com/en/players/ksenia-efremova/800591535/fra/jt/s/";

await fs.mkdir(OUT_DIR_RAW, { recursive: true });

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
    const out = {};

    for (const [key, child] of Object.entries(value).slice(0, 30)) {
      out[key] = summarizeJson(child, depth + 1);
    }

    return out;
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

function scoreArrayForBreakdown(arr) {
  if (!Array.isArray(arr)) return 0;

  let score = 0;

  for (const item of arr.slice(0, 10)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const keys = Object.keys(item).map((k) => k.toLowerCase());

    const joined = keys.join(" ");

    if (joined.includes("tournament")) score += 2;
    if (joined.includes("ranking")) score += 2;
    if (joined.includes("point")) score += 2;
    if (joined.includes("single")) score += 1;
    if (joined.includes("double")) score += 1;
    if (joined.includes("grade")) score += 1;
    if (joined.includes("round")) score += 1;
    if (joined.includes("date")) score += 1;
  }

  return score;
}

function findInterestingArrays(json) {
  const arrays = findArraysDeep(json);

  return arrays
    .map((arr) => ({
      length: arr.length,
      score: scoreArrayForBreakdown(arr),
      sample: arr[0] || null,
    }))
    .filter((x) => x.length > 0)
    .sort((a, b) => b.score - a.score || b.length - a.length)
    .slice(0, 10);
}

async function main() {
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

  const captured = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";

      if (!url.includes("itftennis.com")) return;
      if (!contentType.toLowerCase().includes("json")) return;

      const json = await response.json();

      const interestingArrays = findInterestingArrays(json);

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
      console.log("JSON CAPTURADO");
      console.log("URL:");
      console.log(url);
      console.log("Arrays interessantes:");
      console.log(
        interestingArrays.map((x) => ({
          length: x.length,
          score: x.score,
          sampleKeys:
            x.sample && typeof x.sample === "object"
              ? Object.keys(x.sample).slice(0, 20)
              : [],
        }))
      );
      console.log("========================================");
    } catch {
      // ignora
    }
  });

  console.log("");
  console.log("Abrindo perfil do jogador:");
  console.log(PLAYER_URL);
  console.log("");
  console.log("Quando abrir:");
  console.log("1. Espere carregar.");
  console.log("2. Clique nas abas do perfil, se existirem: Rankings, Results, Activity, Overview.");
  console.log("3. Role a página para baixo.");
  console.log("4. Espere terminar.");
  console.log("");
  console.log("O navegador ficará aberto por 90 segundos.");
  console.log("");

  await page.goto(PLAYER_URL, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(90000);

  const outputFile = path.join(
    OUT_DIR_RAW,
    `discovered_player_profile_apis_${TODAY}.json`
  );

  await fs.writeFile(outputFile, JSON.stringify(captured, null, 2), "utf8");

  console.log("");
  console.log("Finalizado.");
  console.log(`Respostas JSON capturadas: ${captured.length}`);
  console.log(`Arquivo salvo em: ${outputFile}`);

  await browser.close();
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});
