import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

const LIVE_RANKING_FILE = path.resolve(
  "data/clean/live_ranking_with_drops.csv"
);

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");

const OUT_DIR_EXPORTS = path.resolve("data/exports");

const HTML_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "live_ranking.html");
const INDEX_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "index.html");

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_EXPORTS, { recursive: true });
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);

  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  const n = toNumber(value);

  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  const text = cleanText(value);

  if (!text) return "";

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function countryCodeToFlagEmoji(countryCode) {
  const code = cleanText(countryCode).toUpperCase();

  if (!code || code.length !== 3) return "";

  const iso3ToIso2 = {
    ARG: "AR",
    ARM: "AM",
    AUS: "AU",
    AUT: "AT",
    AZE: "AZ",
    BEL: "BE",
    BOL: "BO",
    BRA: "BR",
    BUL: "BG",
    CAN: "CA",
    CHI: "CL",
    CHN: "CN",
    COL: "CO",
    CRO: "HR",
    CYP: "CY",
    CZE: "CZ",
    DEN: "DK",
    ECU: "EC",
    EGY: "EG",
    ESP: "ES",
    EST: "EE",
    FIN: "FI",
    FRA: "FR",
    GBR: "GB",
    GEO: "GE",
    GER: "DE",
    GRE: "GR",
    GUA: "GT",
    HKG: "HK",
    HUN: "HU",
    IND: "IN",
    INA: "ID",
    IRL: "IE",
    ISR: "IL",
    ITA: "IT",
    JPN: "JP",
    KAZ: "KZ",
    KGZ: "KG",
    KOR: "KR",
    LAT: "LV",
    LTU: "LT",
    MEX: "MX",
    NED: "NL",
    NZL: "NZ",
    PER: "PE",
    POL: "PL",
    POR: "PT",
    ROU: "RO",
    RSA: "ZA",
    RUS: "RU",
    SLO: "SI",
    SRB: "RS",
    SRI: "LK",
    SUI: "CH",
    SWE: "SE",
    TPE: "TW",
    TUN: "TN",
    TUR: "TR",
    UKR: "UA",
    URU: "UY",
    USA: "US",
    UZB: "UZ",
  };

  const iso2 = iso3ToIso2[code];

  if (!iso2) return "";

  return iso2
    .toUpperCase()
    .replace(/./g, (char) =>
      String.fromCodePoint(127397 + char.charCodeAt(0))
    );
}

function getGenderLabel(value) {
  const text = cleanText(value).toUpperCase();

  if (text === "M") return "Masculino";
  if (text === "F") return "Feminino";

  return text || "Indefinido";
}

function getBestSingles(row) {
  return [
    row.best_singles_1,
    row.best_singles_2,
    row.best_singles_3,
    row.best_singles_4,
    row.best_singles_5,
    row.best_singles_6,
  ]
    .map(cleanText)
    .filter(Boolean);
}

function getBestDoubles(row) {
  return [
    row.best_doubles_1,
    row.best_doubles_2,
    row.best_doubles_3,
    row.best_doubles_4,
    row.best_doubles_5,
    row.best_doubles_6,
  ]
    .map(cleanText)
    .filter(Boolean);
}

function getPlayingThisWeek(row) {
  const singles = getBestSingles(row).filter((item) => item.includes("LIVE"));
  const doubles = getBestDoubles(row).filter((item) => item.includes("LIVE"));

  const liveItems = [...singles, ...doubles];

  if (!liveItems.length) return "";

  const first = liveItems[0];
  const parts = first.split("|").map((part) => part.trim());

  const tournament = parts[4] || "";
  const round = parts[3] || "";

  const singlesSummary = singles.length
    ? `Simples: ${getLiveRoundLabel(singles[0])}`
    : "";

  const doublesSummary = doubles.length
    ? `Duplas: ${getLiveRoundLabel(doubles[0])}`
    : "";

  return {
    tournament,
    round,
    singlesSummary,
    doublesSummary,
  };
}

function getLiveRoundLabel(resultText) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());

  return parts[3] || "";
}

const ROUND_ORDER = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];

const POINTS_BY_CATEGORY = {
  JGS: { R128: 10, R64: 30, R32: 90, R16: 180, QF: 300, SF: 490, F: 700, W: 1000 },
  J500: { R128: 5, R64: 15, R32: 45, R16: 90, QF: 150, SF: 245, F: 350, W: 500 },
  J300: { R128: 3, R64: 9, R32: 27, R16: 54, QF: 90, SF: 147, F: 210, W: 300 },
  J200: { R128: 2, R64: 6, R32: 18, R16: 36, QF: 60, SF: 98, F: 140, W: 200 },
  J100: { R128: 1, R64: 3, R32: 9, R16: 18, QF: 30, SF: 49, F: 70, W: 100 },
  J60: { R128: 0, R64: 2, R32: 5, R16: 11, QF: 18, SF: 29, F: 42, W: 60 },
  J30: { R128: 0, R64: 1, R32: 2, R16: 5, QF: 9, SF: 15, F: 21, W: 30 },
};

function parseLiveResult(resultText) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());
  const pointsText = parts[0] || "";
  const category = parts[2] || "";
  const round = parts[3] || "";

  return {
    points: toNumber(pointsText),
    category,
    round,
  };
}

function getLiveResultsFromBest(bestResults) {
  return bestResults.filter((item) => item.toUpperCase().includes("LIVE"));
}

function getProjectedScenario(bestResults, livePoints, eventType, multiplier) {
  const liveItems = getLiveResultsFromBest(bestResults);
  if (!liveItems.length) return { nextRound: null, title: null };

  const liveResult = parseLiveResult(liveItems[0]);
  const category = liveResult.category || "JGS";
  const categoryPoints = POINTS_BY_CATEGORY[category] || POINTS_BY_CATEGORY.JGS;
  const currentRound = liveResult.round;
  const currentPoints =
    categoryPoints[currentRound] !== undefined
      ? categoryPoints[currentRound]
      : liveResult.points;

  const currentIndex = ROUND_ORDER.indexOf(currentRound);
  const nextRound = currentIndex >= 0 && currentIndex < ROUND_ORDER.length - 1
    ? ROUND_ORDER[currentIndex + 1]
    : null;

  const nextRoundScenario = nextRound
    ? {
        eventType,
        targetRound: nextRound,
        projectedTotal:
          livePoints + (categoryPoints[nextRound] - currentPoints) * multiplier,
      }
    : null;

  const titleScenario = currentRound !== "W"
    ? {
        eventType,
        targetRound: "W",
        projectedTotal:
          livePoints + (categoryPoints.W - currentPoints) * multiplier,
      }
    : null;

  return { nextRound: nextRoundScenario, title: titleScenario };
}

function buildDataForHtml(rows) {
  return rows.map((row) => ({
    live_rank: toNumber(row.live_rank),
    official_rank: toNumber(row.official_rank),
    rank_change_vs_official: toNumber(row.rank_change_vs_official),

    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    gender: cleanText(row.gender),
    gender_label: getGenderLabel(row.gender),

    country: cleanText(row.country),
    country_flag: countryCodeToFlagEmoji(row.country),
    country_name: cleanText(row.country_name),
    birth_year: cleanText(row.birth_year),

    official_points: toNumber(row.official_points_for_comparison),
    live_points: toNumber(row.live_points),
    points_change_vs_official: toNumber(row.points_change_vs_official),

    singles_points: toNumber(row.singles_points),
    doubles_points_raw: toNumber(row.doubles_points_raw),
    doubles_points_weighted: toNumber(row.doubles_points_weighted),

    has_live_result: cleanText(row.has_live_result),
    has_dropped_result: cleanText(row.has_dropped_result),

    live_rows_available: toNumber(row.live_rows_available),
    live_raw_points_available: toNumber(row.live_raw_points_available),
    live_singles_results_counting: toNumber(row.live_singles_results_counting),
    live_doubles_results_counting: toNumber(row.live_doubles_results_counting),

    dropped_rows_count: toNumber(row.dropped_rows_count),
    dropped_singles_raw: toNumber(row.dropped_singles_raw),
    dropped_doubles_raw: toNumber(row.dropped_doubles_raw),
    estimated_weighted_dropped: toNumber(row.estimated_weighted_dropped),

    best_singles: getBestSingles(row),
    best_doubles: getBestDoubles(row),

    playing_this_week: getPlayingThisWeek(row),

    next_round_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const singlesScenario = getProjectedScenario(singles, livePoints, "singles", 1);
      const doublesScenario = getProjectedScenario(doubles, livePoints, "doubles", 0.25);

      return [singlesScenario.nextRound, doublesScenario.nextRound].filter(Boolean);
    })(),

    title_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const singlesScenario = getProjectedScenario(singles, livePoints, "singles", 1);
      const doublesScenario = getProjectedScenario(doubles, livePoints, "doubles", 0.25);

      return [singlesScenario.title, doublesScenario.title].filter(Boolean);
    })(),

    ranking_date: cleanText(row.ranking_date),
    calculated_at: cleanText(row.calculated_at),
  }));
}

function groupWeekTournaments(tournaments) {
  const map = new Map();

  for (const row of tournaments) {
    const category = cleanText(row.category || row.tournament_category || "OUTROS");
    const name = cleanText(row.tournament_name);
    const country = cleanText(row.host_nation_code || row.country || row.hostNationCode);

    if (!name) continue;

    if (!map.has(category)) {
      map.set(category, []);
    }

    map.get(category).push({
      name,
      country,
    });
  }

  return [...map.entries()]
    .sort((a, b) => {
      const order = {
        JGS: 1,
        J500: 2,
        J300: 3,
        J200: 4,
        J100: 5,
        J60: 6,
        J30: 7,
      };

      return (order[a[0]] || 99) - (order[b[0]] || 99);
    })
    .map(([category, items]) => ({
      category,
      items,
    }));
}

function getStats(rows) {
  const boys = rows.filter((row) => cleanText(row.gender) === "M");
  const girls = rows.filter((row) => cleanText(row.gender) === "F");

  const withLive = rows.filter(
    (row) => cleanText(row.has_live_result) === "true"
  );

  const withDrops = rows.filter(
    (row) => cleanText(row.has_dropped_result) === "true"
  );

  const biggestRise = [...rows]
    .filter((row) => toNumber(row.rank_change_vs_official) > 0)
    .sort(
      (a, b) =>
        toNumber(b.rank_change_vs_official) -
        toNumber(a.rank_change_vs_official)
    )[0];

  const biggestFall = [...rows]
    .filter((row) => toNumber(row.rank_change_vs_official) < 0)
    .sort(
      (a, b) =>
        toNumber(a.rank_change_vs_official) -
        toNumber(b.rank_change_vs_official)
    )[0];

  return {
    total: rows.length,
    boys: boys.length,
    girls: girls.length,
    withLive: withLive.length,
    withDrops: withDrops.length,
    biggestRise,
    biggestFall,
  };
}

function buildHtml(rows, weekTournaments) {
  const data = buildDataForHtml(rows);
  const stats = getStats(rows);
  const tournamentGroups = groupWeekTournaments(weekTournaments);

  const calculatedAt = rows[0]?.calculated_at || new Date().toISOString();
  const rankingDate = rows[0]?.ranking_date || "";

  const biggestRise = stats.biggestRise;
  const biggestFall = stats.biggestFall;

  const dataJson = JSON.stringify(data);
  const tournamentGroupsJson = JSON.stringify(tournamentGroups);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ITF Juniors Live Ranking</title>
  <style>
    :root {
      --bg: #eaf4f1;
      --panel: #ffffff;
      --panel-soft: #f7fbfa;
      --text: #0f172a;
      --muted: #52677a;
      --border: #d6e4e1;
      --green-dark: #0f766e;
      --green: #047857;
      --green-soft: #d1fae5;
      --red: #dc2626;
      --red-soft: #fee2e2;
      --yellow: #b45309;
      --yellow-soft: #fef3c7;
      --blue: #0369a1;
      --blue-soft: #e0f2fe;
      --shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
  margin: 0;
  font-family: "Inter", "Segoe UI", Arial, Helvetica, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

    .page {
      width: min(1660px, calc(100% - 70px));
      margin: 0 auto;
      padding: 36px 0 54px;
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 30px;
      align-items: start;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }

    h1 {
  margin: 0;
  font-size: 56px;
  line-height: 0.98;
  letter-spacing: -0.06em;
  color: var(--green-dark);
  font-weight: 900;
}

    .creator {
  margin-top: 10px;
  color: var(--muted);
  font-weight: 700;
  font-size: 15px;
  line-height: 1.35;
}

    .creator a {
      color: var(--blue);
      text-decoration: none;
    }

    .beta {
  display: inline-flex;
  margin-left: 8px;
  background: #cceee5;
  color: var(--green-dark);
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

    .top-controls {
      display: flex;
      gap: 14px;
    }

    .mini-control {
      display: grid;
      gap: 7px;
    }

    .mini-control label,
    .filter label {
      font-size: 12px;
      font-weight: 850;
      color: var(--muted);
    }

    select,
    input {
      border: 1px solid #cbd5e1;
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
      font-weight: 800;
      color: var(--text);
      outline: none;
    }

    input {
      width: 100%;
    }

    .filters {
      display: grid;
      grid-template-columns: 1fr 170px 170px 200px;
      gap: 18px;
      align-items: end;
      margin-bottom: 20px;
    }

    .filter {
      display: grid;
      gap: 8px;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 20px;
      align-items: start;
    }

    .ranking-card,
    .side-card {
      background: rgba(255, 255, 255, 0.88);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .ranking-card-header {
      padding: 22px 24px 16px;
      border-bottom: 1px solid var(--border);
    }

    .ranking-card-header h2 {
      margin: 0;
      font-size: 19px;
      letter-spacing: -0.02em;
    }

    .formula {
      margin-top: 10px;
      color: #334155;
      font-size: 15px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead {
      background: var(--panel-soft);
    }

    th {
  text-align: left;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.25;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 12px 10px;
  border-bottom: 1px solid var(--border);
  font-weight: 800;
  white-space: nowrap;
}

    td {
  padding: 10px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  line-height: 1.3;
}

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover {
      background: #f4faf8;
    }

    tbody tr.selected {
      background: #e9f6f2;
    }

    .rank {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

    .rank-change {
  display: inline-flex;
  min-width: 26px;
  justify-content: center;
  align-items: center;
  border-radius: 999px;
  padding: 3px 7px;
  font-size: 12px;
  font-weight: 800;
  margin-left: 8px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

    .up {
      background: var(--green-soft);
      color: var(--green);
    }

    .down {
      background: var(--red-soft);
      color: var(--red);
    }

    .same {
      background: #e2e8f0;
      color: var(--muted);
    }

    .player {
  min-width: 260px;
  }

    .player-name {
  font-weight: 800;
  line-height: 1.2;
  font-size: 14px;
  word-break: normal;
  overflow-wrap: anywhere;
}

    .player-meta {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
}

    .points {
  font-weight: 800;
  color: var(--green-dark);
  font-size: 15px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

    .small {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
}

    .week-cell {
  min-width: 240px;
  font-weight: 700;
  line-height: 1.2;
  word-break: normal;
  overflow-wrap: anywhere;
}

    .week-sub {
  margin-top: 5px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
}

    .dash {
      color: var(--muted);
    }

    .status-pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 950;
      margin-right: 4px;
      white-space: nowrap;
    }

    .live {
      background: var(--green-soft);
      color: var(--green);
    }

    .drop {
      background: var(--yellow-soft);
      color: var(--yellow);
    }

    .new {
      background: var(--blue-soft);
      color: var(--blue);
    }

    .side {
      display: grid;
      gap: 18px;
    }

    .side-card h3 {
  margin: 0 0 12px;
  font-size: 18px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-weight: 800;
}

    .side-card h3 {
      margin: 0 0 12px;
      font-size: 17px;
      letter-spacing: -0.02em;
    }

    .tournament-group {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 12px;
      margin: 10px 0;
    }

    .category-label {
      font-weight: 950;
      color: #991b1b;
      font-size: 12px;
    }

    .tournament-list {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  font-weight: 600;
}

    .profile-empty {
      color: var(--muted);
      line-height: 1.4;
      font-size: 14px;
      padding: 8px 0;
    }

    .profile-head {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .profile-flag {
      font-size: 20px;
    }

    .profile-name {
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}

    .profile-meta {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.3;
}

    .profile-line {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  margin-bottom: 14px;
}

    .profile-line strong {
      color: var(--text);
    }

    .profile-section {
      margin-top: 16px;
    }

    .profile-section-title {
      font-size: 13px;
      font-weight: 950;
      margin-bottom: 8px;
    }

    .result-card {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  background: #fbfdfc;
  font-size: 12px;
  line-height: 1.35;
}

    .result-points {
  font-weight: 800;
  color: var(--green-dark);
  font-variant-numeric: tabular-nums;
}

    .result-status {
      float: right;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 950;
    }

    .summary-row {
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
      display: flex;
      justify-content: space-between;
    }

    .summary-row strong {
      color: var(--text);
    }
input,
select,
button {
  font-family: "Inter", "Segoe UI", Arial, Helvetica, sans-serif;
}

table,
th,
td,
.points,
.rank,
.rank-change,
.result-points {
  font-variant-numeric: tabular-nums;
}

.player-name,
.week-cell,
.tournament-list,
.profile-name,
.result-card {
  hyphens: auto;
}

td:nth-child(6),
td:nth-child(7) {
  white-space: nowrap;
  min-width: 110px;
}
    @media (max-width: 1200px) {
      .page {
        width: min(100% - 24px, 100%);
      }

      h1 {
        font-size: 42px;
      }

      .header {
        grid-template-columns: 1fr;
      }

      .filters {
        grid-template-columns: 1fr;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .ranking-card {
        overflow-x: auto;
      }

      table {
        min-width: 1100px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <div>
        <h1>ITF Juniors Live Ranking</h1>
        <div class="creator">
          Criado por Info Tênis Brasil
          <a href="https://x.com/InfoTenisBrasil" target="_blank">X @InfoTenisBrasil</a>
          <span class="beta">BETA TEST</span>
        </div>
      </div>

      <div class="top-controls">
        <div class="mini-control">
          <label>Tema</label>
          <select id="themeSelect">
            <option>Claro</option>
          </select>
        </div>

        <div class="mini-control">
          <label>Idioma</label>
          <select id="languageSelect">
            <option>Português</option>
          </select>
        </div>
      </div>
    </header>

    <section class="filters">
      <div class="filter">
        <label>Buscar atleta</label>
        <input id="searchInput" type="text" placeholder="Nome, país ou torneio" />
      </div>

      <div class="filter">
        <label>Última atualização</label>
        <input value="${escapeHtml(formatDateTime(calculatedAt))}" disabled />
      </div>

      <div class="filter">
        <label>Categoria</label>
       <select id="genderFilter">
  <option value="M" selected>Masculino</option>
  <option value="F">Feminino</option>
  <option value="ALL">Todos</option>
  <option value="BRA">🇧🇷 Brasileiros</option>
</select>
      </div>

      <div class="filter">
        <label>Ordenar por</label>
        <select id="sortFilter">
          <option value="RANK" selected>Ranking ao vivo</option>
          <option value="RISE">Maiores subidas</option>
          <option value="FALL">Maiores quedas</option>
          <option value="POINTS_GAIN">Maior ganho de pontos</option>
          <option value="POINTS_LOSS">Maior perda de pontos</option>
        </select>
      </div>
    </section>

    <main class="layout">
      <section class="ranking-card">
        <div class="ranking-card-header">
          <h2>Live ranking</h2>
          <div class="formula">
            Pontos = ∑ 6 melhores resultados de simples + ∑ 25% dos 6 melhores resultados de duplas
          </div>
        </div>

        <div class="summary-row" style="padding: 12px 14px 0;">
          <span id="visibleSummary">Carregando...</span>
          <span>Base oficial: ${escapeHtml(rankingDate || "não informado")}</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Ranking<br />ao vivo</th>
              <th>Atleta</th>
              <th>Ano</th>
              <th>Pontos ao vivo</th>
              <th>Jogando esta<br />semana</th>
              <th>Próx. rodada</th>
              <th>Título</th>
            </tr>
          </thead>
          <tbody id="rankingBody"></tbody>
        </table>
      </section>

      <aside class="side">
        <section class="side-card">
          <h3>Torneios da semana</h3>
          <div id="weekTournaments"></div>
        </section>

        <section class="side-card" id="profileCard">
          <h3>Pontuações do atleta</h3>
          <div class="profile-empty">
            Clique em um atleta da tabela para ver o resumo de pontuação.
          </div>
        </section>
      </aside>
    </main>
  </div>

  <script>
    const rankingData = ${dataJson};
    const tournamentGroups = ${tournamentGroupsJson};

    const searchInput = document.getElementById("searchInput");
    const genderFilter = document.getElementById("genderFilter");
    const sortFilter = document.getElementById("sortFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");
    const weekTournaments = document.getElementById("weekTournaments");
    const profileCard = document.getElementById("profileCard");

    let selectedPlayerId = "";

    function escapeHtmlClient(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function formatNumberClient(value) {
      const n = Number(value || 0);

      return n.toLocaleString("pt-BR", {
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      });
    }

    function formatRankClient(value) {
      const n = Number(value || 0);
      return n ? "#" + n : "NR";
    }

    function formatChange(value) {
      const n = Number(value || 0);

      if (!n) return "0";
      if (n > 0) return "+" + n;
      return String(n);
    }

    function movementClass(value) {
      const n = Number(value || 0);

      if (n > 0) return "up";
      if (n < 0) return "down";
      return "same";
    }

    function statusTags(row) {
      const tags = [];

      if (!row.official_rank) {
        tags.push('<span class="status-pill new">NEW</span>');
      }

      if (row.has_live_result === "true") {
        tags.push('<span class="status-pill live">LIVE</span>');
      }

      if (row.has_dropped_result === "true") {
        tags.push('<span class="status-pill drop">DROP</span>');
      }

      return tags.join("");
    }

    function getBalanceClass(value) {
      const n = Number(value || 0);
      if (n > 0) return "green";
      if (n < 0) return "red";
      return "gray";
    }

    function getBalanceSign(value) {
      const n = Number(value || 0);
      if (n > 0) return "+";
      return "";
    }

    function getPointsOriginText(row) {
      const hasLive = row.has_live_result === "true";
      const hasDrop = row.has_dropped_result === "true";
      const singlesCount = Number(row.live_singles_results_counting || 0);
      const doublesCount = Number(row.live_doubles_results_counting || 0);
      const dropCount = Number(row.dropped_rows_count || 0);

      if (hasLive && hasDrop) {
        return "LIVE " + singlesCount + "S/" + doublesCount + "D · DROP " + dropCount;
      } else if (hasLive) {
        return "LIVE " + singlesCount + "S/" + doublesCount + "D";
      } else if (hasDrop) {
        return "DROP " + dropCount;
      }
      return "BASE";
    }

    function getPointsHtml(row) {
      const balance = Number(row.points_change_vs_official || 0);
      const balanceClass = getBalanceClass(balance);
      const balanceSign = getBalanceSign(balance);
      const originText = getPointsOriginText(row);

      const colorVar = balanceClass === 'green' ? 'green' : balanceClass === 'red' ? 'red' : 'muted';
      return '<div class="points">' + formatNumberClient(row.live_points) + '</div>' +
             '<div class="small" style="color: var(--' + colorVar + '); font-weight: 700;">' + balanceSign + formatNumberClient(balance) + ' na semana</div>' +
             '<div class="small">' + escapeHtmlClient(originText) + '</div>';
    }

    function getWeeklyBalanceHtml(row) {
      const balance = Number(row.points_change_vs_official || 0);
      const liveRaw = Number(row.live_raw_points_available || 0);
      const estimatedDropped = Number(row.estimated_weighted_dropped || 0);
      const singlesCount = Number(row.live_singles_results_counting || 0);
      const doublesCount = Number(row.live_doubles_results_counting || 0);
      const dropCount = Number(row.dropped_rows_count || 0);
      const balanceClass = getBalanceClass(balance);
      const balanceSign = getBalanceSign(balance);
      const colorVar = balanceClass === 'green' ? 'green' : balanceClass === 'red' ? 'red' : 'muted';

      return '<div class="profile-section">' +
             '<div class="profile-section-title">Saldo da semana</div>' +
             '<div class="profile-line">' +
             '<strong style="color: var(--' + colorVar + ');">Saldo: ' + balanceSign + formatNumberClient(balance) + '</strong>' +
             '</div>' +
             '<div class="profile-line">' +
             'Entrando live: ' + formatNumberClient(liveRaw) + ' bruto' +
             '</div>' +
             '<div class="profile-line">' +
             'Drops estimados: ' + formatNumberClient(estimatedDropped) +
             '</div>' +
             '<div class="profile-line">' +
             'Live no ranking: ' + singlesCount + 'S / ' + doublesCount + 'D' +
             '</div>' +
             '<div class="profile-line">' +
             'Resultados dropados: ' + dropCount +
             '</div>' +
             '<div class="small" style="color: var(--muted); margin-top: 8px; font-style: italic;">' +
             'Nota: O saldo final considera a recomposição dos 6 melhores resultados, portanto pode diferir do bruto menos drops.' +
             '</div>' +
             '</div>';
    }

    function getPlayingHtml(row) {
      if (!row.playing_this_week) {
        return '<span class="dash">-</span>';
      }

      const p = row.playing_this_week;

      return \`
        <div><strong>\${escapeHtmlClient(p.tournament || "Torneio da semana")}</strong></div>
        <div class="week-sub">
          \${p.singlesSummary ? "🎾 " + escapeHtmlClient(p.singlesSummary) : ""}
          \${p.singlesSummary && p.doublesSummary ? "<br />" : ""}
          \${p.doublesSummary ? "👥 " + escapeHtmlClient(p.doublesSummary) : ""}
        </div>
      \`;
    }

        function getNextRoundHtml(row) {
      if (!row.next_round_scenarios || !row.next_round_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return row.next_round_scenarios
        .map((scenario) => \`
          <div class="small">
            (\${scenario.eventType === "singles" ? "S" : "D"}) \${escapeHtmlClient(scenario.targetRound)} \${formatNumberClient(scenario.projectedTotal)}
          </div>
        \`)
        .join("");
    }

    function getTitleHtml(row) {
      if (!row.title_scenarios || !row.title_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return row.title_scenarios
        .map((scenario) => \`
          <div class="small">
            (\${scenario.eventType === "singles" ? "S" : "D"}) \${escapeHtmlClient(scenario.targetRound)} \${formatNumberClient(scenario.projectedTotal)}
          </div>
        \`)
        .join("");
    }

    function passesFilters(row) {
      const gender = genderFilter.value;
      const search = searchInput.value.trim().toLowerCase();

    if (gender === "BRA" && row.country !== "BRA") {
  return false;
}

if (gender !== "ALL" && gender !== "BRA" && row.gender !== gender) {
  return false;
}

      if (Number(row.live_rank || 0) > 500) {
        return false;
      }

      if (search) {
        const liveTournament = row.playing_this_week?.tournament || "";

        const blob = [
          row.player_name,
          row.country,
          row.country_name,
          row.birth_year,
          row.player_id,
          liveTournament,
        ]
          .join(" ")
          .toLowerCase();

        if (!blob.includes(search)) {
          return false;
        }
      }

      return true;
    }

    function sortRows(rows) {
      const sort = sortFilter.value;

      return [...rows].sort((a, b) => {
        if (sort === "RISE") {
          const diff = Number(b.rank_change_vs_official || 0) - Number(a.rank_change_vs_official || 0);
          if (diff !== 0) return diff;
        }

        if (sort === "FALL") {
          const diff = Number(a.rank_change_vs_official || 0) - Number(b.rank_change_vs_official || 0);
          if (diff !== 0) return diff;
        }

        if (sort === "POINTS_GAIN") {
          const diff = Number(b.points_change_vs_official || 0) - Number(a.points_change_vs_official || 0);
          if (diff !== 0) return diff;
        }

        if (sort === "POINTS_LOSS") {
          const diff = Number(a.points_change_vs_official || 0) - Number(b.points_change_vs_official || 0);
          if (diff !== 0) return diff;
        }

        return Number(a.live_rank || 0) - Number(b.live_rank || 0);
      });
    }

    function renderTournaments() {
      weekTournaments.innerHTML = tournamentGroups.map((group) => {
        return \`
          <div class="tournament-group">
            <div class="category-label">\${escapeHtmlClient(group.category)}</div>
            <div class="tournament-list">
              \${group.items.map((item) => escapeHtmlClient(item.name)).join(", ")}
            </div>
          </div>
        \`;
      }).join("");
    }

    function renderResultCards(results) {
      if (!results.length) {
        return '<div class="profile-empty">Sem resultado registrado.</div>';
      }

      return results.map((item) => {
        const parts = item.split("|").map((part) => part.trim());

        const points = parts[0] || "";
        const source = parts[1] || "";
        const category = parts[2] || "";
        const round = parts[3] || "";
        const tournament = parts[4] || "";
        const date = parts[5] || "";

        return \`
          <div class="result-card">
            <span class="result-status">\${escapeHtmlClient(source)}</span>
            <div><strong>\${escapeHtmlClient(tournament || "Torneio")}</strong></div>
            <div class="small">\${escapeHtmlClient(category)} · \${escapeHtmlClient(date)} · \${escapeHtmlClient(round)}</div>
            <div class="result-points">\${escapeHtmlClient(points)}</div>
          </div>
        \`;
      }).join("");
    }

    function renderProfile(row) {
      if (!row) {
        profileCard.innerHTML = \`
          <h3>Pontuações do atleta</h3>
          <div class="profile-empty">
            Clique em um atleta da tabela para ver o resumo de pontuação.
          </div>
        \`;
        return;
      }

      const flag = row.country_flag ? row.country_flag + " " : "";

      profileCard.innerHTML = \`
        <h3>Pontuações do atleta</h3>

        <div class="profile-head">
          <div class="profile-flag">\${flag}</div>
          <div>
            <div class="profile-name">\${escapeHtmlClient(row.player_name)}</div>
            <div class="profile-meta">
              oficial \${formatRankClient(row.official_rank)} · live \${formatRankClient(row.live_rank)} · \${formatChange(row.rank_change_vs_official)}
            </div>
          </div>
        </div>

        <div class="profile-line">
          <strong>\${formatNumberClient(row.live_points)}</strong> pontos ao vivo ·
          oficial: \${formatNumberClient(row.official_points)} ·
          máximo atual: \${formatNumberClient(row.live_points)}
          <br />
          \${statusTags(row)}
        </div>

        \${getWeeklyBalanceHtml(row)}

        <div class="profile-section">
          <div class="profile-section-title">Simples</div>
          \${renderResultCards(row.best_singles)}
        </div>

        <div class="profile-section">
          <div class="profile-section-title">Duplas</div>
          \${renderResultCards(row.best_doubles)}
        </div>
      \`;
    }

    function renderTable() {
      const rows = sortRows(rankingData.filter(passesFilters));

      visibleSummary.innerHTML = '<strong>' + rows.length.toLocaleString("pt-BR") + '</strong> jogadores exibidos';

      if (selectedPlayerId && !rows.some((row) => row.player_id === selectedPlayerId)) {
        selectedPlayerId = "";
        renderProfile(null);
      }

      rankingBody.innerHTML = rows.map((row) => {
        const selected = selectedPlayerId === row.player_id ? "selected" : "";
        const moveClass = movementClass(row.rank_change_vs_official);
        const flag = row.country_flag ? row.country_flag + " " : "";

        return \`
          <tr class="\${selected}" onclick="selectPlayer('\${escapeHtmlClient(row.player_id)}')">
            <td>
              <span class="rank">\${row.live_rank}</span>
              <span class="rank-change \${moveClass}">\${formatChange(row.rank_change_vs_official)}</span>
            </td>

            <td class="player">
              <div class="player-name">\${flag}\${escapeHtmlClient(row.player_name)}</div>
              <div class="player-meta">\${escapeHtmlClient(row.country)} · oficial \${formatRankClient(row.official_rank)}</div>
            </td>

            <td>\${escapeHtmlClient(row.birth_year || "-")}</td>

            <td>
              \${getPointsHtml(row)}
              <div class="small">\${statusTags(row)}</div>
            </td>

            <td class="week-cell">
              \${getPlayingHtml(row)}
            </td>

            <td>
              \${getNextRoundHtml(row)}
            </td>

            <td>
              \${getTitleHtml(row)}
            </td>
          </tr>
        \`;
      }).join("");
    }

    function selectPlayer(playerId) {
      selectedPlayerId = playerId;
      const row = rankingData.find((item) => item.player_id === playerId);
      renderProfile(row);
      renderTable();
    }

    window.selectPlayer = selectPlayer;

    searchInput.addEventListener("input", renderTable);
    genderFilter.addEventListener("change", () => {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    });
    sortFilter.addEventListener("change", renderTable);

    renderTournaments();
    renderTable();
  </script>
</body>
</html>`;
}

async function main() {
  await ensureDirs();

  console.log("");
  console.log("Lendo live_ranking_with_drops.csv...");
  const rows = await readCsv(LIVE_RANKING_FILE);

  console.log("Lendo week_tournaments.csv...");
  const weekTournaments = await readCsv(WEEK_TOURNAMENTS_FILE);

  const html = buildHtml(rows, weekTournaments);

  await fs.writeFile(HTML_OUTPUT_FILE, html, "utf8");
  await fs.writeFile(INDEX_OUTPUT_FILE, html, "utf8");

  console.log("");
  console.log("HTML gerado:");
  console.log("data/exports/live_ranking.html");
  console.log("data/exports/index.html");
  console.log("");
  console.log("Para abrir no navegador:");
  console.log(`file:///${HTML_OUTPUT_FILE.replaceAll("\\\\", "/")}`);
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});

