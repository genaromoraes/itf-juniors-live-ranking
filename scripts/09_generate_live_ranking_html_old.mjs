import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

const LIVE_RANKING_FILE = path.resolve(
  "data/clean/live_ranking_with_drops.csv"
);

const OUT_DIR_EXPORTS = path.resolve("data/exports");

const HTML_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "live_ranking.html");

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
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --text: #0f172a;
      --muted: #64748b;
      --muted-2: #94a3b8;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      --green: #16a34a;
      --green-soft: #dcfce7;
      --red: #dc2626;
      --red-soft: #fee2e2;
      --yellow: #b45309;
      --yellow-soft: #fef3c7;
      --blue: #0284c7;
      --blue-soft: #e0f2fe;
      --purple: #7c3aed;
      --purple-soft: #ede9fe;
      --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    .page {
      width: min(1760px, calc(100% - 40px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 32px;
      line-height: 1.1;
      letter-spacing: -0.05em;
      color: #0f172a;
    }

    .subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--blue-soft);
      color: var(--blue);
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
      border: 1px solid #bae6fd;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 13px 14px;
      box-shadow: var(--shadow);
    }

    .card-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 900;
      margin-bottom: 8px;
    }

    .card-value {
      font-size: 24px;
      font-weight: 950;
      letter-spacing: -0.05em;
    }

    .card-sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(244, 247, 251, 0.88);
      backdrop-filter: blur(14px);
      padding: 10px 0;
      margin-bottom: 6px;
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }

    .tab-btn {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--muted);
      border-radius: 999px;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 900;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
    }

    .tab-btn.active {
      background: #0f172a;
      color: #fff;
      border-color: #0f172a;
    }

    .filters {
      display: grid;
      grid-template-columns: 1fr 170px 150px 170px;
      gap: 10px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 10px;
      box-shadow: var(--shadow);
    }

    input,
    select {
      border: 1px solid var(--border);
      background: var(--panel-soft);
      color: var(--text);
      border-radius: 12px;
      padding: 11px 12px;
      font-size: 13px;
      outline: none;
      width: 100%;
    }

    input:focus,
    select:focus {
      border-color: #7dd3fc;
      box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
    }

    .summary-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--muted);
      font-size: 13px;
      margin: 10px 2px 10px;
    }

    .summary-line strong {
      color: var(--text);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 430px;
      gap: 14px;
      align-items: start;
    }

    .table-wrap {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead {
      background: #f8fafc;

    }

    th {
      text-align: left;
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 11px 10px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
      font-weight: 950;
    }

    td {
      padding: 10px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }

    td:nth-child(4),
    th:nth-child(4) {
      min-width: 300px;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover {
      background: #f8fafc;
    }

    tbody tr.selected {
      background: #eff6ff;
    }

    .rank {
      font-weight: 950;
      font-size: 16px;
      letter-spacing: -0.03em;
      white-space: nowrap;
    }

    .official {
      color: var(--muted);
      font-weight: 850;
    }

    .player-name {
      font-weight: 950;
      font-size: 14px;
      letter-spacing: -0.01em;
      margin-bottom: 3px;
    }

    .player-meta {
      color: var(--muted);
      font-size: 12px;
    }

    .points {
      font-weight: 950;
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
      font-weight: 950;
      white-space: nowrap;
    }

    .change-pill {
      min-width: 42px;
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
      background: #f1f5f9;
      color: var(--muted);
    }

    .tag-live {
      background: var(--green-soft);
      color: var(--green);
    }

    .tag-drop {
      background: var(--yellow-soft);
      color: var(--yellow);
    }

    .tag-base {
      background: #f1f5f9;
      color: var(--muted);
    }

    .tag-new {
      background: var(--purple-soft);
      color: var(--purple);
    }

    .status-tags {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .points-up {
      color: var(--green);
    }

    .points-down {
      color: var(--red);
    }

    .side-panel {
      position: sticky;
      top: 126px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .side-empty {
      padding: 24px;
      color: var(--muted);
      line-height: 1.45;
      min-height: 220px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .side-empty strong {
      color: var(--text);
      font-size: 18px;
    }

    .profile-header {
      padding: 18px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(135deg, #ffffff 0%, #eff6ff 100%);
    }

    .profile-ranks {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }

    .rank-box {
      flex: 1;
      background: rgba(255,255,255,0.78);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
    }

    .rank-box-label {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 950;
      margin-bottom: 4px;
    }

    .rank-box-value {
      font-weight: 950;
      font-size: 24px;
      letter-spacing: -0.04em;
    }

    .profile-name {
      font-size: 22px;
      font-weight: 950;
      letter-spacing: -0.04em;
      margin-bottom: 4px;
    }

    .profile-meta {
      color: var(--muted);
      font-size: 13px;
    }

    .profile-body {
      padding: 16px 18px 18px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }

    .metric {
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 950;
      margin-bottom: 5px;
    }

    .metric-value {
      font-size: 18px;
      font-weight: 950;
    }

    .section {
      margin-top: 14px;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 950;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .result-list {
      display: grid;
      gap: 7px;
    }

    .result-item {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 9px;
      font-size: 12px;
      line-height: 1.35;
      color: #334155;
    }

    .empty-results {
      font-size: 12px;
      color: var(--muted);
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
    }

    .footer-note {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    @media (max-width: 1300px) {
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .filters {
        grid-template-columns: 1fr;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .side-panel {
        position: static;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        min-width: 1050px;
      }

      thead {
        position: static;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <div>
        <h1>ITF Juniors Live Ranking</h1>
        <div class="subtitle">
          Ranking provisÃ³rio com base no ranking oficial, resultados ao vivo da semana e pontos que caem.
          Base oficial: ${escapeHtml(rankingDate || "nÃ£o informado")}. Atualizado em: ${escapeHtml(calculatedAt)}.
        </div>
      </div>
      <div class="badge">Live ranking provisÃ³rio</div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Jogadores</div>
        <div class="card-value">${formatNumber(stats.total)}</div>
        <div class="card-sub">${formatNumber(stats.boys)} masc. / ${formatNumber(stats.girls)} fem.</div>
      </div>

      <div class="card">
        <div class="card-label">Resultado live</div>
        <div class="card-value">${formatNumber(stats.withLive)}</div>
        <div class="card-sub">Jogadores em torneios da semana.</div>
      </div>

      <div class="card">
        <div class="card-label">Com pontos caindo</div>
        <div class="card-value">${formatNumber(stats.withDrops)}</div>
        <div class="card-sub">Jogadores com resultados expirados.</div>
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

    <div class="toolbar">
      <div class="tabs">
        <button class="tab-btn active" data-gender="M">Masculino</button>
        <button class="tab-btn" data-gender="F">Feminino</button>
        <button class="tab-btn" data-gender="ALL">Todos</button>
      </div>

      <div class="filters">
        <input id="searchInput" type="text" placeholder="Buscar jogador, paÃ­s ou ano de nascimento..." />

        <select id="movementFilter">
          <option value="ALL">Todos movimentos</option>
          <option value="CHANGED">Somente mudanÃ§as</option>
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
          <option value="RANK" selected>Ranking</option>
          <option value="RISE">Maiores subidas</option>
          <option value="FALL">Maiores quedas</option>
          <option value="POINTS_GAIN">Maior ganho pts</option>
          <option value="POINTS_LOSS">Maior perda pts</option>
        </select>
      </div>
    </div>

    <div class="summary-line">
      <div id="visibleSummary">Carregando...</div>
      <div>Clique em um jogador para abrir o perfil.</div>
    </div>

    <div class="layout">
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
            </tr>
          </thead>
          <tbody id="rankingBody"></tbody>
        </table>
      </div>

      <aside class="side-panel" id="sidePanel">
        <div class="side-empty">
          <div style="font-size: 34px; margin-bottom: 10px;">👤</div>
          <strong>Selecione um jogador</strong>
          <span style="display: block; margin-top: 8px;">
            Clique em qualquer linha da tabela para ver o perfil completo:
            ranking oficial, live ranking, pontos entrando, pontos caindo e melhores resultados.
          </span>
        </div>
      </aside>
    </div>

    <div class="footer-note">
      Ranking provisÃ³rio. Antes de usar como referÃªncia pÃºblica, valide a tabela de pontos ITF Junior e os pontos de qualifying.
    </div>
  </div>

  <script>
    const rankingData = ${dataJson};

    const searchInput = document.getElementById("searchInput");
    const movementFilter = document.getElementById("movementFilter");
    const limitFilter = document.getElementById("limitFilter");
    const sortFilter = document.getElementById("sortFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");
    const sidePanel = document.getElementById("sidePanel");

    let activeGender = "M";
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

    function formatChangeClient(value) {
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

    function pointsClass(value) {
      const n = Number(value || 0);

      if (n > 0) return "points-up";
      if (n < 0) return "points-down";
      return "";
    }

    function statusTags(row) {
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
      const movement = movementFilter.value;
      const limit = Number(limitFilter.value);

      if (activeGender !== "ALL" && row.gender !== activeGender) {
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

    function renderProfile(row) {
      if (!row) {
        sidePanel.innerHTML = \`
          <div class="side-empty">
          <div style="font-size: 34px; margin-bottom: 10px;">👤</div>
          <strong>Selecione um jogador</strong>
          <span style="display: block; margin-top: 8px;">
            Clique em qualquer linha da tabela para ver o perfil completo:
            ranking oficial, live ranking, pontos entrando, pontos caindo e melhores resultados.
          </span>
        </div>
        \`;
        return;
      }

      const flag = row.country_flag ? row.country_flag + " " : "";
      const moveClass = movementClass(row.rank_change_vs_official);
      const ptsClass = pointsClass(row.points_change_vs_official);

      sidePanel.innerHTML = \`
        <div class="profile-header">
          <div class="profile-ranks">
            <div class="rank-box">
              <div class="rank-box-label">Live</div>
              <div class="rank-box-value">\${formatRankClient(row.live_rank)}</div>
            </div>
            <div class="rank-box">
              <div class="rank-box-label">Oficial</div>
              <div class="rank-box-value">\${formatRankClient(row.official_rank)}</div>
            </div>
            <div class="rank-box">
              <div class="rank-box-label">Mov.</div>
              <div class="rank-box-value \${moveClass === "up" ? "points-up" : moveClass === "down" ? "points-down" : ""}">
                \${formatChangeClient(row.rank_change_vs_official)}
              </div>
            </div>
          </div>

          <div class="profile-name">\${escapeHtmlClient(row.player_name)}</div>
          <div class="profile-meta">
            \${escapeHtmlClient(row.gender_label)} â€¢ \${flag}\${escapeHtmlClient(row.country || "-")}
            \${row.birth_year ? " â€¢ " + escapeHtmlClient(row.birth_year) : ""}
          </div>
        </div>

        <div class="profile-body">
          <div class="metric-grid">
            <div class="metric">
              <div class="metric-label">Pontos live</div>
              <div class="metric-value">\${formatNumberClient(row.live_points)}</div>
            </div>

            <div class="metric">
              <div class="metric-label">DiferenÃ§a</div>
              <div class="metric-value \${ptsClass}">
                \${Number(row.points_change_vs_official || 0) > 0 ? "+" : ""}\${formatNumberClient(row.points_change_vs_official)}
              </div>
            </div>

            <div class="metric">
              <div class="metric-label">Simples</div>
              <div class="metric-value">\${formatNumberClient(row.singles_points)}</div>
            </div>

            <div class="metric">
              <div class="metric-label">Duplas</div>
              <div class="metric-value">\${formatNumberClient(row.doubles_points_weighted)}</div>
            </div>

            <div class="metric">
              <div class="metric-label">Live usados</div>
              <div class="metric-value">\${row.live_singles_results_counting}S / \${row.live_doubles_results_counting}D</div>
            </div>

            <div class="metric">
              <div class="metric-label">Drops</div>
              <div class="metric-value">\${row.dropped_rows_count}</div>
            </div>
          </div>

          <div class="status-tags">
            \${statusTags(row)}
          </div>

          <div class="section">
            <div class="section-title">Melhores simples</div>
            \${renderResultList(row.best_singles)}
          </div>

          <div class="section">
            <div class="section-title">Melhores duplas</div>
            \${renderResultList(row.best_doubles)}
          </div>
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

      rankingBody.innerHTML = rows
        .map((row) => {
          const flag = row.country_flag ? row.country_flag + " " : "";
          const selected = row.player_id === selectedPlayerId ? "selected" : "";
          const moveClass = movementClass(row.rank_change_vs_official);
          const ptsClass = pointsClass(row.points_change_vs_official);

          return \`
            <tr class="\${selected}" onclick="selectPlayer('\${escapeHtmlClient(row.player_id)}')">
              <td class="rank">\${formatRankClient(row.live_rank)}</td>
              <td class="official">\${formatRankClient(row.official_rank)}</td>
              <td>
                <span class="pill change-pill \${moveClass}">
                  \${formatChangeClient(row.rank_change_vs_official)}
                </span>
              </td>
              <td>
                <div class="player-name">\${escapeHtmlClient(row.player_name)}</div>
                <div class="player-meta">
                  \${flag}\${escapeHtmlClient(row.country || "-")}
                  \${row.birth_year ? " â€¢ " + escapeHtmlClient(row.birth_year) : ""}
                </div>
              </td>
              <td>
                <div class="points">\${formatNumberClient(row.live_points)}</div>
                <div class="small">oficial: \${formatNumberClient(row.official_points)}</div>
              </td>
              <td>
                <div class="points \${ptsClass}">
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
                <div class="status-tags">\${statusTags(row)}</div>
              </td>
            </tr>
          \`;
        })
        .join("");
    }

    function selectPlayer(playerId) {
      selectedPlayerId = playerId;
      const row = rankingData.find((item) => item.player_id === playerId);
      renderProfile(row);
      renderTable();
    }

    window.selectPlayer = selectPlayer;

    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        activeGender = button.dataset.gender;
        selectedPlayerId = "";
        renderProfile(null);
        renderTable();
      });
    });

    searchInput.addEventListener("input", renderTable);
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
