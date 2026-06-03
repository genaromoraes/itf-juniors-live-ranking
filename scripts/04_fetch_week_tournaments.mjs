import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";

const OUT_DIR_RAW = path.resolve("data/raw");
const OUT_DIR_CLEAN = path.resolve("data/clean");
const IS_CI = process.env.CI === "true";

const TODAY = new Date().toISOString().slice(0, 10);

const CALENDAR_PAGE =
  "https://www.itftennis.com/en/tournament-calendar/world-tennis-tour-juniors-calendar/";

const RAW_OUTPUT_FILE = path.join(
  OUT_DIR_RAW,
  `week_tournaments_${TODAY}.json`
);

const CLEAN_OUTPUT_FILE = path.join(OUT_DIR_CLEAN, "week_tournaments.csv");

const DEBUG_ALL_FILE = path.join(
  OUT_DIR_CLEAN,
  "week_tournaments_debug_all.csv"
);

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function getFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return null;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekWindow() {
  const now = new Date();

  const monday = getMonday(now);
  const sunday = addDays(monday, 6);

  // A semana oficial que queremos considerar.
  const weekStart = toIsoDate(monday);
  const weekEnd = toIsoDate(sunday);

  // Busca com pequena folga para pegar torneios como Roland Garros,
  // que começam no domingo anterior, mas terminam dentro da semana.
  const searchStart = toIsoDate(addDays(monday, -2));
  const searchEnd = weekEnd;

  return {
    week_start: weekStart,
    week_end: weekEnd,
    search_start: searchStart,
    search_end: searchEnd,
  };
}

function parseDateFlexible(value) {
  if (!value) return "";

  const text = String(value).trim();

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function parseDatesRange(value) {
  if (!value) {
    return {
      start_date: "",
      end_date: "",
    };
  }

  const text = String(value).trim();

  // Exemplo: "31 May to 06 Jun 2026"
  const rangeMatch = text.match(
    /(\d{1,2})\s+([A-Za-z]{3,})\s+to\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/
  );

  if (rangeMatch) {
    const [, d1, m1, d2, m2, year] = rangeMatch;

    const start = new Date(`${d1} ${m1} ${year}`);
    const end = new Date(`${d2} ${m2} ${year}`);

    return {
      start_date: Number.isNaN(start.getTime())
        ? ""
        : start.toISOString().slice(0, 10),
      end_date: Number.isNaN(end.getTime())
        ? ""
        : end.toISOString().slice(0, 10),
    };
  }

  const parsed = parseDateFlexible(text);

  return {
    start_date: parsed,
    end_date: "",
  };
}

function extractTournamentRows(json) {
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.Items)) return json.Items;
  return [];
}

function normalizeTournament(row, sourceUrl, weekWindow) {
  const tournamentKey = getFirst(row, ["tournamentKey", "TournamentKey"]);

  const tournamentIdRaw = getFirst(row, [
    "tournamentId",
    "TournamentId",
    "id",
    "Id",
    "eventId",
    "EventId",
  ]);

  const tournamentId =
    tournamentIdRaw && String(tournamentIdRaw) !== "0" ? tournamentIdRaw : "";

  const name = getFirst(row, [
    "tournamentName",
    "TournamentName",
    "name",
    "Name",
  ]);

  const promotionalName = getFirst(row, [
    "promotionalName",
    "PromotionalName",
  ]);

  const category = getFirst(row, [
    "category",
    "Category",
    "grade",
    "Grade",
    "tourCode",
    "TourCode",
    "tournamentType",
    "TournamentType",
  ]);

  const hostNationCode = getFirst(row, [
    "hostNationCode",
    "HostNationCode",
    "nationCode",
    "NationCode",
    "countryCode",
    "CountryCode",
  ]);

  const hostNation = getFirst(row, [
    "hostNation",
    "HostNation",
    "nation",
    "Nation",
    "country",
    "Country",
    "countryName",
    "CountryName",
  ]);

  const location = getFirst(row, [
    "location",
    "Location",
    "city",
    "City",
    "venue",
    "Venue",
  ]);

  const venue = getFirst(row, ["venue", "Venue"]);

  const startDateRaw = getFirst(row, [
    "startDate",
    "StartDate",
    "dateFrom",
    "DateFrom",
    "tournamentStartDate",
    "TournamentStartDate",
  ]);

  const endDateRaw = getFirst(row, [
    "endDate",
    "EndDate",
    "dateTo",
    "DateTo",
    "tournamentEndDate",
    "TournamentEndDate",
  ]);

  const datesRaw = getFirst(row, ["dates", "Dates", "date", "Date"]);

  let startDate = parseDateFlexible(startDateRaw);
  let endDate = parseDateFlexible(endDateRaw);

  if ((!startDate || !endDate) && datesRaw) {
    const parsedRange = parseDatesRange(datesRaw);

    if (!startDate) startDate = parsedRange.start_date;
    if (!endDate) endDate = parsedRange.end_date;
  }

  const surface = getFirst(row, [
    "surfaceDesc",
    "SurfaceDesc",
    "surface",
    "Surface",
  ]);

  const surfaceCode = getFirst(row, ["surfaceCode", "SurfaceCode"]);

  const indoorOutdoor = getFirst(row, [
    "indoorOrOutDoor",
    "IndoorOrOutDoor",
  ]);

  const tournamentLink = getFirst(row, [
    "tournamentLink",
    "TournamentLink",
    "link",
    "Link",
    "url",
    "Url",
  ]);

  const liveLink = getFirst(row, ["liveLink", "LiveLink"]);

  return {
    week_start: weekWindow.week_start,
    week_end: weekWindow.week_end,
    search_start: weekWindow.search_start,
    search_end: weekWindow.search_end,

    tournament_id: cleanText(tournamentId),
    tournament_key: cleanText(tournamentKey),
    tournament_name: cleanText(name),
    promotional_name: cleanText(promotionalName),
    category: cleanText(category),

    host_nation: cleanText(hostNation),
    host_nation_code: cleanText(hostNationCode),
    location: cleanText(location),
    venue: cleanText(venue),

    start_date: cleanText(startDate),
    end_date: cleanText(endDate),
    dates_raw: cleanText(datesRaw),

    surface: cleanText(surface),
    surface_code: cleanText(surfaceCode),
    indoor_outdoor: cleanText(indoorOutdoor),

    tournament_link: normalizeUrl(tournamentLink),
    live_link: normalizeUrl(liveLink),

    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
    raw_json: JSON.stringify(row),
  };
}

function isCancelledTournament(tournament) {
  const name = String(tournament.tournament_name || "").toLowerCase();
  const promo = String(tournament.promotional_name || "").toLowerCase();

  return name.includes("cancelled") || promo.includes("cancelled");
}

function tournamentOverlapsOfficialWeek(tournament, weekWindow) {
  const start = tournament.start_date;
  const end = tournament.end_date || tournament.start_date;

  if (!start || !start.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return false;
  }

  const effectiveEnd =
    end && end.match(/^\d{4}-\d{2}-\d{2}$/) ? end : start;

  // Regra correta:
  // o torneio entra se encostar em qualquer dia da semana oficial.
  return effectiveEnd >= weekWindow.week_start && start <= weekWindow.week_end;
}

function buildCalendarUrl({ skip, take, dateFrom, dateTo }) {
  const params = new URLSearchParams({
    circuitCode: "JT",
    searchString: "",
    skip: String(skip),
    take: String(take),
    nationCodes: "",
    zoneCodes: "",
    dateFrom,
    dateTo,
    indoorOutdoor: "",
    categories: "",
    isOrderAscending: "true",
    orderField: "startDate",
    surfaceCodes: "",
    singlesDrawFormat: "",
  });

  return `https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?${params.toString()}`;
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

async function fetchCalendarAllPages(page, weekWindow) {
  const take = 100;
  let skip = 0;
  const all = [];

  while (true) {
    const url = buildCalendarUrl({
      skip,
      take,
      dateFrom: weekWindow.search_start,
      dateTo: weekWindow.search_end,
    });

    console.log("");
    console.log(`Buscando calendário skip=${skip}, take=${take}`);
    console.log(url);

    const result = await fetchJsonInsideBrowser(page, url);

    if (!result.ok || !result.json) {
      throw new Error(
        `Falha no calendário. HTTP ${result.status}. ${result.contentType}. ${result.textStart}`
      );
    }

    const rows = extractTournamentRows(result.json);

    console.log(`Linhas recebidas: ${rows.length}`);

    all.push({
      url,
      rows_count: rows.length,
      total_items: result.json?.totalItems ?? "",
      json: result.json,
      rows,
    });

    if (rows.length < take) break;

    skip += take;

    if (skip > 1000) {
      console.log("Parando por segurança em skip > 1000.");
      break;
    }

    await page.waitForTimeout(500);
  }

  return all;
}

function dedupeTournaments(rows) {
  const map = new Map();

  for (const row of rows) {
    const key =
      row.tournament_key ||
      row.tournament_link ||
      `${row.tournament_name}|${row.host_nation_code}|${row.start_date}`;

    if (!map.has(key)) {
      map.set(key, row);
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

  const weekWindow = getWeekWindow();

  console.log("");
  console.log("Semana oficial:");
  console.log({
    week_start: weekWindow.week_start,
    week_end: weekWindow.week_end,
  });

  console.log("");
  console.log("Janela de busca na API:");
  console.log({
    search_start: weekWindow.search_start,
    search_end: weekWindow.search_end,
  });

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
    console.log("");
    console.log("Criando sessão com a ITF...");

    await page.goto(CALENDAR_PAGE, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(3000);

    const results = await fetchCalendarAllPages(page, weekWindow);

    const allTournaments = [];

    for (const result of results) {
      for (const row of result.rows) {
        allTournaments.push(normalizeTournament(row, result.url, weekWindow));
      }
    }

    const debugAll = dedupeTournaments(allTournaments).sort((a, b) => {
      const dateCompare = String(a.start_date).localeCompare(
        String(b.start_date)
      );
      if (dateCompare !== 0) return dateCompare;

      return String(a.tournament_name).localeCompare(
        String(b.tournament_name)
      );
    });

    const tournaments = debugAll
      .filter((tournament) => !isCancelledTournament(tournament))
      .filter((tournament) =>
        tournamentOverlapsOfficialWeek(tournament, weekWindow)
      )
      .sort((a, b) => {
        const dateCompare = String(a.start_date).localeCompare(
          String(b.start_date)
        );
        if (dateCompare !== 0) return dateCompare;

        return String(a.tournament_name).localeCompare(
          String(b.tournament_name)
        );
      });

    await fs.writeFile(
      RAW_OUTPUT_FILE,
      JSON.stringify(
        {
          week_window: weekWindow,
          sources: results.map((r) => ({
            url: r.url,
            rows_count: r.rows_count,
            total_items: r.total_items,
          })),
          all_tournaments_count: debugAll.length,
          week_tournaments_count: tournaments.length,
          tournaments,
          all_tournaments: debugAll,
        },
        null,
        2
      ),
      "utf8"
    );

    const columns = [
      "week_start",
      "week_end",
      "search_start",
      "search_end",

      "tournament_id",
      "tournament_key",
      "tournament_name",
      "promotional_name",
      "category",

      "host_nation",
      "host_nation_code",
      "location",
      "venue",

      "start_date",
      "end_date",
      "dates_raw",

      "surface",
      "surface_code",
      "indoor_outdoor",

      "tournament_link",
      "live_link",

      "source_url",
      "collected_at",
      "raw_json",
    ];

    await writeCsv(CLEAN_OUTPUT_FILE, tournaments, columns);
    await writeCsv(DEBUG_ALL_FILE, debugAll, columns);

    console.log("");
    console.log("Finalizado.");
    console.log(`Torneios retornados pela API: ${debugAll.length}`);
    console.log(`Torneios da semana oficial: ${tournaments.length}`);
    console.log("");
    console.log("Arquivos gerados:");
    console.log("data/clean/week_tournaments.csv");
    console.log("data/clean/week_tournaments_debug_all.csv");
    console.log(`data/raw/week_tournaments_${TODAY}.json`);

    if (tournaments.length > 0) {
      console.log("");
      console.log("Torneios da semana oficial:");
      for (const t of tournaments) {
        console.log(
          `${t.start_date} até ${t.end_date} | ${t.category} | ${t.tournament_name} | ${t.host_nation_code} | ${t.tournament_key}`
        );
      }
    }
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
