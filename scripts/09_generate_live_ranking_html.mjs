import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

const LIVE_RANKING_FILE = path.resolve(
  "data/clean/live_ranking_with_drops.csv"
);

const OUT_DIR_EXPORTS = path.resolve("data/exports");

const HTML_OUTPUT_FILE = path.join(
  OUT_DIR_EXPORTS,
  "live_ranking.html"
);

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

function countryCodeToFlagEmoji(countryCode) {
  const code = cleanText(countryCode).toUpperCase();

  if (!code || code.length !== 3) return "";

  const iso3ToIso2 = {
    AFG: "AF",
    ALB: "AL",
    ALG: "DZ",
    AND: "AD",
    ANG: "AO",
    ARG: "AR",
    ARM: "AM",
    AUS: "AU",
    AUT: "AT",
    AZE: "AZ",
    BAH: "BS",
    BRN: "BH",
    BAN: "BD",
    BAR: "BB",
    BLR: "BY",
    BEL: "BE",
    BIZ: "BZ",
    BEN: "BJ",
    BER: "BM",
    BHU: "BT",
    BOL: "BO",
    BIH: "BA",
    BOT: "BW",
    BRA: "BR",
    BRU: "BN",
    BUL: "BG",
    BUR: "BF",
    BDI: "BI",
    CAM: "KH",
    CMR: "CM",
    CAN: "CA",
    CPV: "CV",
    CAF: "CF",
    CHA: "TD",
    CHI: "CL",
    CHN: "CN",
    TPE: "TW",
    COL: "CO",
    COM: "KM",
    CGO: "CG",
    COD: "CD",
    COK: "CK",
    CRC: "CR",
    CRO: "HR",
    CUB: "CU",
    CYP: "CY",
    CZE: "CZ",
    DEN: "DK",
    DJI: "DJ",
    DMA: "DM",
    DOM: "DO",
    ECU: "EC",
    EGY: "EG",
    ESA: "SV",
    GEQ: "GQ",
    ERI: "ER",
    EST: "EE",
    SWZ: "SZ",
    ETH: "ET",
    FIJ: "FJ",
    FIN: "FI",
    FRA: "FR",
    GAB: "GA",
    GAM: "GM",
    GEO: "GE",
    GER: "DE",
    GHA: "GH",
    GBR: "GB",
    GRE: "GR",
    GRN: "GD",
    GUA: "GT",
    GUI: "GN",
    GBS: "GW",
    GUY: "GY",
    HAI: "HT",
    HON: "HN",
    HKG: "HK",
    HUN: "HU",
    ISL: "IS",
    IND: "IN",
    INA: "ID",
    IRI: "IR",
    IRQ: "IQ",
    IRL: "IE",
    ISR: "IL",
    ITA: "IT",
    CIV: "CI",
    JAM: "JM",
    JPN: "JP",
    JOR: "JO",
    KAZ: "KZ",
    KEN: "KE",
    KIR: "KI",
    KOR: "KR",
    KOS: "XK",
    KUW: "KW",
    KGZ: "KG",
    LAO: "LA",
    LAT: "LV",
    LIB: "LB",
    LES: "LS",
    LBR: "LR",
    LBA: "LY",
    LIE: "LI",
    LTU: "LT",
    LUX: "LU",
    MAD: "MG",
    MAW: "MW",
    MAS: "MY",
    MDV: "MV",
    MLI: "ML",
    MLT: "MT",
    MRI: "MU",
    MEX: "MX",
    MDA: "MD",
    MON: "MC",
    MGL: "MN",
    MNE: "ME",
    MAR: "MA",
    MOZ: "MZ",
    MYA: "MM",
    NAM: "NA",
    NEP: "NP",
    NED: "NL",
    NZL: "NZ",
    NCA: "NI",
    NIG: "NE",
    NGR: "NG",
    MKD: "MK",
    NOR: "NO",
    OMA: "OM",
    PAK: "PK",
    PLE: "PS",
    PAN: "PA",
    PAR: "PY",
    PER: "PE",
    PHI: "PH",
    POL: "PL",
    POR: "PT",
    PUR: "PR",
    QAT: "QA",
    ROU: "RO",
    RUS: "RU",
    RWA: "RW",
    SKN: "KN",
    LCA: "LC",
    VIN: "VC",
    SAM: "WS",
    SMR: "SM",
    KSA: "SA",
    SEN: "SN",
    SRB: "RS",
    SEY: "SC",
    SLE: "SL",
    SIN: "SG",
    SVK: "SK",
    SLO: "SI",
    SOL: "SB",
    SOM: "SO",
    RSA: "ZA",
    ESP: "ES",
    SRI: "LK",
    SUD: "SD",
    SUR: "SR",
    SWE: "SE",
    SUI: "CH",
    SYR: "SY",
    TJK: "TJ",
    TAN: "TZ",
    THA: "TH",
    TOG: "TG",
    TGA: "TO",
    TRI: "TT",
    TUN: "TN",
    TUR: "TR",
    TKM: "TM",
    UGA: "UG",
    UKR: "UA",
    UAE: "AE",
    USA: "US",
    URU: "UY",
    UZB: "UZ",
    VAN: "VU",
    VEN: "VE",
    VIE: "VN",
    YEM: "YE",
    ZAM: "ZM",
    ZIM: "ZW",
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

function getStats(rows) {
  const boys = rows.filter((row) => cleanText(row.gender) === "M");
  const girls = rows.filter((row) => cleanText(row.gender) === "F");

  const withLive = rows.filter((row) => cleanText(row.has_live_result) === "true");
  const withDrops = rows.filter((row) => cleanText(row.has_dropped_result) === "true");

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

    ranking_date: cleanText(row.ranking_date),
    calculated_at: cleanText(row.calculated_at),
  }));
}

function buildHtml(rows) {
  const data = buildDataForHtml(rows);
  const stats = getStats(rows);

  const calculatedAt = rows[0]?.calculated_at || new Date().toISOString();
  const rankingDate = rows[0]?.ranking_date || "";

  const biggestRise = stats.biggestRise;
  const biggestFall = stats.biggestFall;

  const dataJson = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ITF Juniors Live Ranking</title>
  <style>
    :root {
      --bg: #080c18;
      --bg-soft: #0e1628;
      --panel: #111827;
      --panel-2: #172033;
      --panel-3: #0f172a;
      --text: #f8fafc;
      --muted: #94a3b8;
      --muted-2: #64748b;
      --border: #263449;
      --green: #22c55e;
      --green-soft: rgba(34, 197, 94, 0.13);
      --red: #ef4444;
      --red-soft: rgba(239, 68, 68, 0.13);
      --yellow: #f59e0b;
      --yellow-soft: rgba(245, 158, 11, 0.13);
      --blue: #38bdf8;
      --blue-soft: rgba(56, 189, 248, 0.13);
      --purple: #a78bfa;
      --purple-soft: rgba(167, 139, 250, 0.13);
      --white: #ffffff;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, Arial, Helvetica, sans-serif;
      background: radial-gradient(circle at top left, #1d2b4b 0, #0b1020 38%, #070b16 100%);
      color: var(--text);
    }

    .page {
      width: min(1520px, calc(100% - 32px));
      margin: 0 auto;
      padding: 26px 0 48px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 20px;
    }

    .title-block h1 {
      margin: 0;
      font-size: 33px;
      letter-spacing: -0.05em;
      line-height: 1.1;
    }

    .title-block p {
      margin: 8px 0 0;
      color: #b6c3d8;
      font-size: 13px;
      line-height: 1.45;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 11px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #bae6fd;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .card {
      background: rgba(17, 24, 39, 0.78);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    }

    .card-label {
      color: #9fb2cc;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }

    .card-value {
      font-size: 27px;
      font-weight: 900;
      letter-spacing: -0.05em;
    }

    .card-sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .controls {
      position: sticky;
      top: 0;
      z-index: 40;
      display: grid;
      grid-template-columns: 1fr 140px 170px 150px 160px;
      gap: 9px;
      align-items: center;
      background: rgba(11, 16, 32, 0.88);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 11px;
      margin: 16px 0;
    }

    input,
    select,
    button {
      border: 1px solid var(--border);
      background: #0f172a;
      color: var(--text);
      border-radius: 12px;
      padding: 10px 11px;
      font-size: 13px;
      outline: none;
    }

    input {
      width: 100%;
    }

    .summary-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .summary-line strong {
      color: var(--text);
    }

    .table-wrap {
      background: rgba(17, 24, 39, 0.88);
      border: 1px solid var(--border);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 12px 35px rgba(0,0,0,0.35);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead {
      background: #0f172a;
      position: sticky;
      top: 72px;
      z-index: 30;
    }

    th {
      text-align: left;
      color: #cbd5e1;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 11px 10px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    td {
      padding: 9px 10px;
      border-bottom: 1px solid rgba(38, 52, 73, 0.68);
      vertical-align: middle;
    }

    tbody tr.main-row:hover {
      background: rgba(56, 189, 248, 0.055);
    }

    tbody tr.details-row {
      background: rgba(15, 23, 42, 0.82);
    }

    tbody tr.details-row td {
      padding: 0;
    }

    .rank {
      font-weight: 900;
      font-size: 16px;
      letter-spacing: -0.03em;
      white-space: nowrap;
    }

    .official-rank {
      color: #cbd5e1;
      font-weight: 700;
      white-space: nowrap;
    }

    .player-cell {
      min-width: 260px;
    }

    .player {
      font-weight: 900;
      font-size: 14px;
      margin-bottom: 3px;
      letter-spacing: -0.01em;
    }

    .meta {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .points {
      font-weight: 900;
      white-space: nowrap;
    }

    .small {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
    }

    .change-pill {
      min-width: 42px;
    }

    .change-up {
      background: var(--green-soft);
      color: #86efac;
    }

    .change-down {
      background: var(--red-soft);
      color: #fca5a5;
    }

    .change-same {
      background: rgba(148, 163, 184, 0.13);
      color: #cbd5e1;
    }

    .tag-live {
      background: var(--green-soft);
      color: #86efac;
      border: 1px solid rgba(34, 197, 94, 0.22);
    }

    .tag-drop {
      background: var(--yellow-soft);
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.22);
    }

    .tag-base {
      background: rgba(148, 163, 184, 0.10);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }

    .tag-new {
      background: var(--purple-soft);
      color: #ddd6fe;
      border: 1px solid rgba(167, 139, 250, 0.22);
    }

    .status-tags {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .details-btn {
      border: 1px solid rgba(56, 189, 248, 0.28);
      color: #bae6fd;
      background: rgba(56, 189, 248, 0.10);
      padding: 7px 9px;
      font-size: 12px;
      cursor: pointer;
      border-radius: 10px;
      font-weight: 800;
    }

    .details-btn:hover {
      background: rgba(56, 189, 248, 0.18);
    }

    .details-box {
      padding: 14px 18px 16px 168px;
      border-bottom: 1px solid rgba(38, 52, 73, 0.68);
    }

    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .details-panel {
      background: rgba(2, 6, 23, 0.35);
      border: 1px solid rgba(38, 52, 73, 0.75);
      border-radius: 14px;
      padding: 12px;
    }

    .details-title {
      font-size: 12px;
      color: #cbd5e1;
      text-transform: uppercase;
      font-weight: 900;
      letter-spacing: 0.08em;
      margin-bottom: 9px;
    }

    .result-list {
      display: grid;
      gap: 7px;
    }

    .result-item {
      color: #dbe7fb;
      font-size: 12px;
      line-height: 1.38;
      padding-bottom: 7px;
      border-bottom: 1px solid rgba(38, 52, 73, 0.55);
    }

    .result-item:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .empty-results {
      color: var(--muted);
      font-size: 12px;
    }

    .hidden {
      display: none;
    }

    .footer-note {
      color: var(--muted);
      margin-top: 14px;
      font-size: 12px;
      line-height: 1.5;
    }

    .movement-cell {
      white-space: nowrap;
    }

    .points-diff-up {
      color: #86efac;
    }

    .points-diff-down {
      color: #fca5a5;
    }

    .points-diff-same {
      color: #cbd5e1;
    }

    @media (max-width: 1200px) {
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .controls {
        grid-template-columns: 1fr;
        position: static;
      }

      table {
        min-width: 1150px;
      }

      .table-wrap {
        overflow-x: auto;
      }

      thead {
        position: static;
      }

      .details-box {
        padding: 14px;
      }

      .details-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="title-block">
        <h1>ITF Juniors Live Ranking</h1>
        <p>
          Ranking provisório calculado com base no ledger inicial, resultados ao vivo da semana e remoção dos pontos que caem.
          Ranking oficial base: ${escapeHtml(rankingDate || "não informado")}. Atualizado em: ${escapeHtml(calculatedAt)}.
        </p>
      </div>
      <div class="badge">LIVE RANKING PROVISÓRIO</div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Jogadores</div>
        <div class="card-value">${formatNumber(stats.total)}</div>
        <div class="card-sub">${formatNumber(stats.boys)} masc. / ${formatNumber(stats.girls)} fem.</div>
      </div>

      <div class="card">
        <div class="card-label">Com resultado live</div>
        <div class="card-value">${formatNumber(stats.withLive)}</div>
        <div class="card-sub">Jogadores presentes nos torneios da semana.</div>
      </div>

      <div class="card">
        <div class="card-label">Com pontos caindo</div>
        <div class="card-value">${formatNumber(stats.withDrops)}</div>
        <div class="card-sub">Jogadores com algum resultado expirado.</div>
      </div>

      <div class="card">
        <div class="card-label">Maior subida</div>
        <div class="card-value">${biggestRise ? `+${formatNumber(biggestRise.rank_change_vs_official)}` : "-"}</div>
        <div class="card-sub">${biggestRise ? `${escapeHtml(biggestRise.player_name)} (${escapeHtml(biggestRise.country)})` : ""}</div>
      </div>

      <div class="card">
        <div class="card-label">Maior queda</div>
        <div class="card-value">${biggestFall ? formatNumber(biggestFall.rank_change_vs_official) : "-"}</div>
        <div class="card-sub">${biggestFall ? `${escapeHtml(biggestFall.player_name)} (${escapeHtml(biggestFall.country)})` : ""}</div>
      </div>
    </div>

    <div class="controls">
      <input id="searchInput" type="text" placeholder="Buscar jogador, país ou ano de nascimento..." />

      <select id="genderFilter">
        <option value="M" selected>Masculino</option>
        <option value="F">Feminino</option>
        <option value="ALL">Todos</option>
      </select>

      <select id="movementFilter">
        <option value="ALL">Todos movimentos</option>
        <option value="CHANGED">Somente mudanças</option>
        <option value="UP">Subiu</option>
        <option value="DOWN">Caiu</option>
        <option value="LIVE">Com live</option>
        <option value="DROP">Com drop</option>
        <option value="NEW">Sem ranking oficial</option>
      </select>

      <select id="limitFilter">
        <option value="50">Top 50</option>
        <option value="100">Top 100</option>
        <option value="250">Top 250</option>
        <option value="500" selected>Top 500</option>
        <option value="1000">Top 1000</option>
        <option value="999999">Todos</option>
      </select>

      <select id="sortFilter">
        <option value="RANK" selected>Ordenar por ranking</option>
        <option value="RISE">Maiores subidas</option>
        <option value="FALL">Maiores quedas</option>
        <option value="POINTS_GAIN">Maior ganho de pontos</option>
        <option value="POINTS_LOSS">Maior perda de pontos</option>
      </select>
    </div>

    <div class="summary-line">
      <div id="visibleSummary">Carregando...</div>
      <div>Use “Detalhes” para ver os 6 melhores resultados de simples e duplas.</div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Live</th>
            <th>Oficial</th>
            <th>Mov.</th>
            <th>Jogador</th>
            <th>Pontos</th>
            <th>Dif. pts</th>
            <th>Simples</th>
            <th>Duplas</th>
            <th>Status</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody id="rankingBody"></tbody>
      </table>
    </div>

    <div class="footer-note">
      Observação: este é um ranking provisório. A qualidade final depende da validação da tabela de pontos ITF Junior, dos pontos de qualifying e da consistência dos dados de torneios coletados durante a semana.
    </div>
  </div>

  <script>
    const rankingData = ${dataJson};

    const searchInput = document.getElementById("searchInput");
    const genderFilter = document.getElementById("genderFilter");
    const movementFilter = document.getElementById("movementFilter");
    const limitFilter = document.getElementById("limitFilter");
    const sortFilter = document.getElementById("sortFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");

    let openDetails = new Set();

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

    function formatChangeClient(value) {
      const n = Number(value || 0);

      if (!n) return "0";
      if (n > 0) return "+" + n;
      return String(n);
    }

    function getChangeClassClient(value) {
      const n = Number(value || 0);

      if (n > 0) return "change-up";
      if (n < 0) return "change-down";
      return "change-same";
    }

    function getPointsDiffClass(value) {
      const n = Number(value || 0);

      if (n > 0) return "points-diff-up";
      if (n < 0) return "points-diff-down";
      return "points-diff-same";
    }

    function getStatusTags(row) {
      const tags = [];

      if (!row.official_rank) {
        tags.push('<span class="pill tag-new">NEW</span>');
      }

      if (row.has_live_result === "true") {
        tags.push('<span class="pill tag-live">LIVE</span>');
      }

      if (row.has_dropped_result === "true") {
        tags.push('<span class="pill tag-drop">DROP</span>');
      }

      if (!tags.length) {
        tags.push('<span class="pill tag-base">BASE</span>');
      }

      return tags.join(" ");
    }

    function passesFilters(row) {
      const search = searchInput.value.trim().toLowerCase();
      const gender = genderFilter.value;
      const movement = movementFilter.value;
      const limit = Number(limitFilter.value);

      if (gender !== "ALL" && row.gender !== gender) {
        return false;
      }

      if (Number(row.live_rank || 0) > limit) {
        return false;
      }

      if (movement === "CHANGED" && Number(row.rank_change_vs_official || 0) === 0) {
        return false;
      }

      if (movement === "UP" && Number(row.rank_change_vs_official || 0) <= 0) {
        return false;
      }

      if (movement === "DOWN" && Number(row.rank_change_vs_official || 0) >= 0) {
        return false;
      }

      if (movement === "LIVE" && row.has_live_result !== "true") {
        return false;
      }

      if (movement === "DROP" && row.has_dropped_result !== "true") {
        return false;
      }

      if (movement === "NEW" && Number(row.official_rank || 0) > 0) {
        return false;
      }

      if (search) {
        const blob = [
          row.player_name,
          row.country,
          row.country_name,
          row.birth_year,
          row.player_id,
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

        if (a.gender !== b.gender) {
          return String(a.gender).localeCompare(String(b.gender));
        }

        return Number(a.live_rank || 0) - Number(b.live_rank || 0);
      });
    }

    function renderResultList(results) {
      if (!results || !results.length) {
        return '<div class="empty-results">Sem resultado registrado.</div>';
      }

      return '<div class="result-list">' + results.map((item) => {
        return '<div class="result-item">' + escapeHtmlClient(item) + '</div>';
      }).join("") + '</div>';
    }

    function toggleDetails(playerId) {
      if (openDetails.has(playerId)) {
        openDetails.delete(playerId);
      } else {
        openDetails.add(playerId);
      }

      renderTable();
    }

    window.toggleDetails = toggleDetails;

    function renderTable() {
      const rows = sortRows(rankingData.filter(passesFilters));

      visibleSummary.innerHTML = '<strong>' + rows.length.toLocaleString("pt-BR") + '</strong> jogadores exibidos';

      rankingBody.innerHTML = rows
        .map((row) => {
          const changeClass = getChangeClassClient(row.rank_change_vs_official);
          const pointsDiffClass = getPointsDiffClass(row.points_change_vs_official);
          const detailsOpen = openDetails.has(row.player_id);

          const flag = row.country_flag ? row.country_flag + " " : "";

          const mainRow = \`
            <tr class="main-row">
              <td class="rank">\${formatRankClient(row.live_rank)}</td>
              <td class="official-rank">\${formatRankClient(row.official_rank)}</td>
              <td class="movement-cell">
                <span class="pill change-pill \${changeClass}">
                  \${formatChangeClient(row.rank_change_vs_official)}
                </span>
              </td>
              <td class="player-cell">
                <div class="player">\${escapeHtmlClient(row.player_name)}</div>
                <div class="meta">
                  \${escapeHtmlClient(row.gender_label)} • \${flag}\${escapeHtmlClient(row.country || "-")}
                  \${row.birth_year ? " • " + escapeHtmlClient(row.birth_year) : ""}
                </div>
              </td>
              <td>
                <div class="points">\${formatNumberClient(row.live_points)}</div>
                <div class="small">oficial: \${formatNumberClient(row.official_points)}</div>
              </td>
              <td>
                <div class="points \${pointsDiffClass}">
                  \${Number(row.points_change_vs_official || 0) > 0 ? "+" : ""}\${formatNumberClient(row.points_change_vs_official)}
                </div>
              </td>
              <td>
                <div class="points">\${formatNumberClient(row.singles_points)}</div>
              </td>
              <td>
                <div class="points">\${formatNumberClient(row.doubles_points_weighted)}</div>
                <div class="small">bruto: \${formatNumberClient(row.doubles_points_raw)}</div>
              </td>
              <td>
                <div class="status-tags">\${getStatusTags(row)}</div>
                <div class="small" style="margin-top: 6px;">
                  live: \${row.live_singles_results_counting}S / \${row.live_doubles_results_counting}D
                  · drops: \${row.dropped_rows_count}
                </div>
              </td>
              <td>
                <button class="details-btn" onclick="toggleDetails('\${escapeHtmlClient(row.player_id)}')">
                  \${detailsOpen ? "Fechar" : "Detalhes"}
                </button>
              </td>
            </tr>
          \`;

          const detailsRow = detailsOpen ? \`
            <tr class="details-row">
              <td colspan="10">
                <div class="details-box">
                  <div class="details-grid">
                    <div class="details-panel">
                      <div class="details-title">Melhores simples</div>
                      \${renderResultList(row.best_singles)}
                    </div>
                    <div class="details-panel">
                      <div class="details-title">Melhores duplas</div>
                      \${renderResultList(row.best_doubles)}
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          \` : "";

          return mainRow + detailsRow;
        })
        .join("");
    }

    searchInput.addEventListener("input", renderTable);
    genderFilter.addEventListener("change", renderTable);
    movementFilter.addEventListener("change", renderTable);
    limitFilter.addEventListener("change", renderTable);
    sortFilter.addEventListener("change", renderTable);

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

  const html = buildHtml(rows);

  await fs.writeFile(HTML_OUTPUT_FILE, html, "utf8");

  console.log("");
  console.log("HTML gerado:");
  console.log("data/exports/live_ranking.html");
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