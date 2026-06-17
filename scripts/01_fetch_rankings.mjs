import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";
import { getActiveBaseLimitPerGender } from "./lib/ranking_limits.mjs";

const TOP_LIMIT = getActiveBaseLimitPerGender();
const PAGE_SIZE = 100;
const IS_CI = process.env.CI === "true";

const OUT_DIR_RAW = path.resolve("data/raw");
const OUT_DIR_CLEAN = path.resolve("data/clean");

const TODAY = new Date().toISOString().slice(0, 10);

const RANKING_PAGE =
  "https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/";

const GENDERS = [
  {
    label: "boys",
    gender: "M",
    itfCode: "B",
  },
  {
    label: "girls",
    gender: "F",
    itfCode: "G",
  },
];

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null) return null;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);

  return Number.isFinite(n) ? n : null;
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return null;
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
    keys.includes("familyname") ||
    keys.includes("playergivenname") ||
    keys.includes("playerfamilyname");

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

function normalizeProfileUrl(value) {
  if (!value) return "";

  const raw = String(value);

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function normalizePlayer(row, genderInfo) {
  const playerId = getFirst(row, [
    "playerId",
    "PlayerId",
    "playerID",
    "id",
    "Id",
    "playerCode",
    "PlayerCode",
  ]);

  const firstName = getFirst(row, [
    "firstName",
    "FirstName",
    "givenName",
    "GivenName",
    "playerGivenName",
    "PlayerGivenName",
    "playerFirstName",
    "PlayerFirstName",
  ]);

  const lastName = getFirst(row, [
    "lastName",
    "LastName",
    "familyName",
    "FamilyName",
    "playerFamilyName",
    "PlayerFamilyName",
    "playerLastName",
    "PlayerLastName",
  ]);

  const fullName =
    getFirst(row, [
      "fullName",
      "FullName",
      "playerName",
      "PlayerName",
      "name",
      "Name",
      "displayName",
      "DisplayName",
    ]) || [firstName, lastName].filter(Boolean).join(" ");

  const country = getFirst(row, [
    "nationCode",
    "NationCode",
    "nationality",
    "Nationality",
    "playerNationalityCode",
    "PlayerNationalityCode",
    "countryCode",
    "CountryCode",
    "country",
    "Country",
  ]);

  const countryName = getFirst(row, [
    "playerNationality",
    "PlayerNationality",
    "nationalityName",
    "NationalityName",
    "countryName",
    "CountryName",
  ]);

  const rank = toNumber(
    getFirst(row, [
      "rank",
      "Rank",
      "ranking",
      "Ranking",
      "rankPosition",
      "RankPosition",
      "position",
      "Position",
    ])
  );

  const officialPoints = toNumber(
    getFirst(row, [
      "points",
      "Points",
      "rankingPoints",
      "RankingPoints",
      "totalPoints",
      "TotalPoints",
    ])
  );

  const birthDate = getFirst(row, [
    "birthDate",
    "BirthDate",
    "dateOfBirth",
    "DateOfBirth",
    "dob",
    "DOB",
  ]);

  const birthYearRaw = getFirst(row, [
    "birthYear",
    "BirthYear",
    "yearOfBirth",
    "YearOfBirth",
  ]);

  let birthYear = birthYearRaw ? toNumber(birthYearRaw) : null;

  if (!birthYear && birthDate) {
    const match = String(birthDate).match(/\b(19|20)\d{2}\b/);
    if (match) birthYear = Number(match[0]);
  }

  const profileUrlRaw = getFirst(row, [
    "profileLink",
    "ProfileLink",
    "profileUrl",
    "ProfileUrl",
    "playerUrl",
    "PlayerUrl",
    "url",
    "Url",
    "href",
    "Href",
  ]);

  const profileUrl = normalizeProfileUrl(profileUrlRaw);

  return {
    player_id: cleanText(playerId),
    player_name: cleanText(fullName),
    first_name: cleanText(firstName),
    last_name: cleanText(lastName),
    gender: genderInfo.gender,
    itf_gender_code: genderInfo.itfCode,
    country: cleanText(country),
    country_name: cleanText(countryName),
    birth_date: cleanText(birthDate),
    birth_year: birthYear || "",
    junior_last_year: birthYear ? birthYear + 18 : "",
    active_junior: "",
    profile_url: cleanText(profileUrl),
    current_rank: rank || "",
    current_points: officialPoints || "",
    first_seen_date: TODAY,
    last_seen_date: TODAY,
    raw_json: JSON.stringify(row),
  };
}

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

function buildRankingUrl(genderInfo, take, skip) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    playerTypeCode: genderInfo.itfCode,
    ageCategoryCode: "",
    juniorRankingType: "itf",
    take: String(take),
    skip: String(skip),
    isOrderAscending: "true",
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetPlayerRankings?${params.toString()}`;
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

async function fetchRankingPage(page, genderInfo, take, skip) {
  const url = buildRankingUrl(genderInfo, take, skip);

  const result = await fetchJsonInsideBrowser(page, url);

  if (!result.ok || !result.json) {
    const debugFile = path.join(
      OUT_DIR_RAW,
      `debug_${genderInfo.label}_take_${take}_skip_${skip}_${TODAY}.txt`
    );

    await fs.writeFile(
      debugFile,
      JSON.stringify(
        {
          url,
          status: result.status,
          contentType: result.contentType,
          textStart: result.textStart,
        },
        null,
        2
      ),
      "utf8"
    );

    throw new Error(
      `Falha buscando ${genderInfo.label} take=${take} skip=${skip}. Debug: ${debugFile}`
    );
  }

  const rows = extractRankingRows(result.json);

  return {
    url,
    json: result.json,
    rows,
  };
}

async function fetchRankingForGender(page, genderInfo) {
  console.log("");
  console.log(`Buscando Top ${TOP_LIMIT} ${genderInfo.label}...`);

  const allRows = [];
  const rawPages = [];

  for (let skip = 0; skip < TOP_LIMIT; skip += PAGE_SIZE) {
    const take = Math.min(PAGE_SIZE, TOP_LIMIT - skip);

    console.log(
      `Buscando ${genderInfo.label}: posições ${skip + 1} até ${skip + take}`
    );

    const result = await fetchRankingPage(page, genderInfo, take, skip);

    console.log(`Linhas recebidas: ${result.rows.length}`);

    rawPages.push({
      url: result.url,
      rows_count: result.rows.length,
      json: result.json,
    });

    allRows.push(...result.rows);

    if (result.rows.length === 0) {
      break;
    }

    await page.waitForTimeout(400);
  }

  const rawFile = path.join(
    OUT_DIR_RAW,
    `ranking_${genderInfo.label}_${TODAY}.json`
  );

  await fs.writeFile(
    rawFile,
    JSON.stringify(
      {
        gender: genderInfo,
        pages: rawPages,
      },
      null,
      2
    ),
    "utf8"
  );

  const players = allRows
    .map((row) => normalizePlayer(row, genderInfo))
    .filter((p) => p.player_name || p.player_id)
    .sort((a, b) => {
      const ar = Number(a.current_rank || 999999);
      const br = Number(b.current_rank || 999999);
      return ar - br;
    })
    .slice(0, TOP_LIMIT);

  console.log(`${genderInfo.label}: ${players.length} jogadores extraídos.`);

  return {
    genderInfo,
    sourceUrl: buildRankingUrl(genderInfo, PAGE_SIZE, 0),
    players,
  };
}

function uniquePlayers(players) {
  const map = new Map();

  for (const p of players) {
    const key =
      p.player_id ||
      `${p.gender}|${p.player_name}|${p.country}|${p.birth_year}`;

    if (!map.has(key)) {
      map.set(key, p);
    }
  }

  return [...map.values()];
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

    const allPlayers = [];
    const rankingSnapshots = [];

    for (const genderInfo of GENDERS) {
      const result = await fetchRankingForGender(page, genderInfo);

      allPlayers.push(...result.players);

      for (const p of result.players) {
        rankingSnapshots.push({
          ranking_date: TODAY,
          gender: p.gender,
          rank: p.current_rank,
          player_id: p.player_id,
          player_name: p.player_name,
          country: p.country,
          country_name: p.country_name,
          birth_year: p.birth_year,
          official_points: p.current_points,
          source_url: result.sourceUrl,
          collected_at: new Date().toISOString(),
        });
      }
    }

    const players = uniquePlayers(allPlayers);

    await writeCsv(path.join(OUT_DIR_CLEAN, "players.csv"), players, [
      "player_id",
      "player_name",
      "first_name",
      "last_name",
      "gender",
      "itf_gender_code",
      "country",
      "country_name",
      "birth_date",
      "birth_year",
      "junior_last_year",
      "active_junior",
      "profile_url",
      "current_rank",
      "current_points",
      "first_seen_date",
      "last_seen_date",
      "raw_json",
    ]);

    await writeCsv(
      path.join(OUT_DIR_CLEAN, "rankings_snapshot.csv"),
      rankingSnapshots,
      [
        "ranking_date",
        "gender",
        "rank",
        "player_id",
        "player_name",
        "country",
        "country_name",
        "birth_year",
        "official_points",
        "source_url",
        "collected_at",
      ]
    );

    console.log("");
    console.log("Finalizado com sucesso.");
    console.log("");
    console.log("Arquivos gerados:");
    console.log("data/clean/players.csv");
    console.log("data/clean/rankings_snapshot.csv");
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
