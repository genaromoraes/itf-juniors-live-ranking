import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const OUT_FILE = path.resolve("data/raw/calendar_debug_fields.json");
const IS_CI = process.env.CI === "true";

const CALENDAR_PAGE =
  "https://www.itftennis.com/en/tournament-calendar/world-tennis-tour-juniors-calendar/";

const URL =
  "https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?circuitCode=JT&searchString=&skip=0&take=100&nationCodes=&zoneCodes=&dateFrom=2026-05-30&dateTo=2026-06-09&indoorOutdoor=&categories=&isOrderAscending=true&orderField=startDate&surfaceCodes=&singlesDrawFormat=";

function findArraysDeep(value, arrays = []) {
  if (!value) return arrays;

  if (Array.isArray(value)) {
    arrays.push(value);
    for (const item of value) findArraysDeep(item, arrays);
    return arrays;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value)) findArraysDeep(child, arrays);
  }

  return arrays;
}

async function main() {
  await fs.mkdir("data/raw", { recursive: true });

  const browser = await chromium.launch({ headless: IS_CI ? true : false });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });

  const page = await context.newPage();

  await page.goto(CALENDAR_PAGE, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(3000);

  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });

    const text = await response.text();

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      json: JSON.parse(text),
    };
  }, URL);

  const arrays = findArraysDeep(result.json)
    .map((arr, index) => ({
      index,
      length: arr.length,
      firstItem:
        arr.length && typeof arr[0] === "object"
          ? arr[0]
          : arr.slice(0, 5),
      firstItemKeys:
        arr.length && typeof arr[0] === "object" ? Object.keys(arr[0]) : [],
    }))
    .sort((a, b) => b.length - a.length);

  await fs.writeFile(
    OUT_FILE,
    JSON.stringify(
      {
        url: URL,
        status: result.status,
        contentType: result.contentType,
        topLevelKeys: Object.keys(result.json || {}),
        arrays,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log("Status:", result.status);
  console.log("Content-Type:", result.contentType);
  console.log("Top-level keys:", Object.keys(result.json || {}));
  console.log("");
  console.log("Arrays encontradas:");
  for (const arr of arrays.slice(0, 10)) {
    console.log("");
    console.log(`Array #${arr.index}`);
    console.log(`Length: ${arr.length}`);
    console.log("Keys:", arr.firstItemKeys);
    console.log("Primeiro item:");
    console.log(JSON.stringify(arr.firstItem, null, 2).slice(0, 2000));
  }

  console.log("");
  console.log("Arquivo salvo em:");
  console.log("data/raw/calendar_debug_fields.json");

  await browser.close();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
