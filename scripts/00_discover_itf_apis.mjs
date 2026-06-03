import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const OUT_DIR_RAW = path.resolve("data/raw");
const TODAY = new Date().toISOString().slice(0, 10);
const IS_CI = process.env.CI === "true";

await fs.mkdir(OUT_DIR_RAW, { recursive: true });

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

function looksLikeRankingRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;

  const keys = Object.keys(row).map((k) => k.toLowerCase());

  const hasRank =
    keys.includes("rank") ||
    keys.includes("ranking") ||
    keys.includes("rankposition") ||
    keys.includes("position");

  const hasPoints =
    keys.includes("points") ||
    keys.includes("rankingpoints") ||
    keys.includes("totalpoints");

  const hasPlayer =
    keys.includes("playerid") ||
    keys.includes("id") ||
    keys.includes("playername") ||
    keys.includes("fullname") ||
    keys.includes("name") ||
    keys.includes("givenname") ||
    keys.includes("familyname");

  return hasRank && hasPlayer && hasPoints;
}

function extractRankingRows(json) {
  const arrays = findArraysDeep(json);

  const candidateArrays = arrays
    .map((arr) => ({
      arr,
      score: arr.filter(looksLikeRankingRow).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidateArrays.length) return [];

  return candidateArrays[0].arr.filter(looksLikeRankingRow);
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
  });

  const page = await context.newPage();

  const found = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";

      if (!url.includes("itftennis.com")) return;

      if (
        !url.toLowerCase().includes("rank") &&
        !url.toLowerCase().includes("player")
      ) {
        return;
      }

      if (!contentType.toLowerCase().includes("json")) {
        return;
      }

      const json = await response.json();
      const rows = extractRankingRows(json);

      if (rows.length > 0) {
        const item = {
          url,
          rows: rows.length,
          sample: rows[0],
        };

        found.push(item);

        console.log("");
        console.log("======================================");
        console.log("API DE RANKING ENCONTRADA");
        console.log("Linhas:", rows.length);
        console.log("URL:");
        console.log(url);
        console.log("Primeiro item:");
        console.log(JSON.stringify(rows[0], null, 2));
        console.log("======================================");
        console.log("");
      }
    } catch {
      // ignora respostas que não conseguimos ler
    }
  });

  console.log("");
  console.log("Abrindo página da ITF...");
  console.log("");
  console.log("Quando o navegador abrir:");
  console.log("1. Espere a página carregar.");
  console.log("2. Se aparecer ranking masculino, tente trocar para feminino na página.");
  console.log("3. Espere alguns segundos.");
  console.log("4. Volte aqui no terminal e veja se apareceu alguma API.");
  console.log("");
  console.log("O navegador ficará aberto por 90 segundos.");
  console.log("");

  await page.goto(
    "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/",
    {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    }
  );

  await page.waitForTimeout(90000);

  const outputFile = path.join(
    OUT_DIR_RAW,
    `discovered_ranking_apis_${TODAY}.json`
  );

  await fs.writeFile(outputFile, JSON.stringify(found, null, 2), "utf8");

  console.log("");
  console.log("Finalizado.");
  console.log(`APIs encontradas: ${found.length}`);
  console.log(`Arquivo salvo em: ${outputFile}`);
  console.log("");

  await browser.close();
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});
