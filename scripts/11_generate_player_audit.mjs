import fs from "fs/promises";
import path from "path";
import csvUtils from "./lib/csv.js";
import textUtils from "./lib/text.js";

const { readCsv, writeCsv } = csvUtils;
const { cleanText, toNumber, formatNumber, escapeHtml } = textUtils;

const LIVE_RANKING_FILE = path.resolve("data/clean/live_ranking_with_drops.csv");
const WEEK_LIVE_LEDGER_FILE = path.resolve("data/clean/week_live_ledger_rows.csv");
const DROPPED_POINTS_FILE = path.resolve("data/clean/live_dropped_points.csv");
const ACTIVE_LEDGER_FILE = path.resolve("data/clean/live_combined_ledger_with_drops.csv");

const OUT_DIR = path.resolve("data/audit");

const AUDIT_SUMMARY_FILE = path.join(OUT_DIR, "player_audit_summary.csv");
const AUDIT_DETAILS_FILE = path.join(OUT_DIR, "player_audit_details.csv");
const AUDIT_BRAZILIANS_FILE = path.join(OUT_DIR, "player_audit_brazilians.csv");
const AUDIT_HTML_FILE = path.join(OUT_DIR, "player_audit.html");

async function ensureDirs() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

function getPlayerId(row) {
  return cleanText(row.player_id);
}

function groupByPlayer(rows) {
  const map = new Map();

  for (const row of rows) {
    const playerId = getPlayerId(row);

    if (!playerId) continue;

    if (!map.has(playerId)) {
      map.set(playerId, []);
    }

    map.get(playerId).push(row);
  }

  return map;
}

function parseBestResult(resultText) {
  const text = cleanText(resultText);

  if (!text) return null;

  const parts = text.split("|").map((part) => part.trim());

  return {
    points: toNumber(parts[0]),
    source_type: cleanText(parts[1]),
    category: cleanText(parts[2]),
    round: cleanText(parts[3]),
    tournament_name: cleanText(parts[4]),
    start_date: cleanText(parts[5]),
    drop_info: cleanText(parts.slice(6).join(" | ")),
    raw: text,
  };
}

function getBestResultsFromRankingRow(row, eventType) {
  const prefix = eventType === "singles" ? "best_singles" : "best_doubles";

  const results = [];

  for (let i = 1; i <= 6; i++) {
    const parsed = parseBestResult(row[`${prefix}_${i}`]);

    if (!parsed) continue;

    results.push({
      slot: i,
      event_type: eventType,
      ...parsed,
    });
  }

  return results;
}

function getBestResultsSummary(row, eventType) {
  return getBestResultsFromRankingRow(row, eventType)
    .map((item) => {
      const source = item.source_type ? `[${item.source_type}]` : "";
      return `${item.slot}. ${item.points} pts ${source} ${item.category} ${item.round} ${item.tournament_name} ${item.start_date}`;
    })
    .join(" || ");
}

function getLiveRowsForPlayer(playerId, liveRows) {
  return liveRows.filter((row) => getPlayerId(row) === playerId);
}

function getDroppedRowsForPlayer(playerId, droppedRows) {
  return droppedRows.filter((row) => getPlayerId(row) === playerId);
}

function getActiveRowsForPlayer(playerId, activeRows) {
  return activeRows.filter((row) => getPlayerId(row) === playerId);
}

function sumPoints(rows) {
  return rows.reduce((sum, row) => sum + toNumber(row.points), 0);
}

function sumWeightedPoints(rows) {
  return rows.reduce((sum, row) => {
    const points = toNumber(row.points);
    const eventType = cleanText(row.event_type);

    if (eventType === "doubles") {
      return sum + points / 4;
    }

    return sum + points;
  }, 0);
}

function buildSummaryRows(liveRankingRows, liveRows, droppedRows, activeRows) {
  const summaryRows = [];

  for (const row of liveRankingRows) {
    const playerId = getPlayerId(row);

    if (!playerId) continue;

    const playerLiveRows = getLiveRowsForPlayer(playerId, liveRows);
    const playerDroppedRows = getDroppedRowsForPlayer(playerId, droppedRows);
    const playerActiveRows = getActiveRowsForPlayer(playerId, activeRows);

    const liveSinglesRows = playerLiveRows.filter(
      (item) => cleanText(item.event_type) === "singles"
    );

    const liveDoublesRows = playerLiveRows.filter(
      (item) => cleanText(item.event_type) === "doubles"
    );

    const droppedSinglesRows = playerDroppedRows.filter(
      (item) => cleanText(item.event_type) === "singles"
    );

    const droppedDoublesRows = playerDroppedRows.filter(
      (item) => cleanText(item.event_type) === "doubles"
    );

    const bestSingles = getBestResultsSummary(row, "singles");
    const bestDoubles = getBestResultsSummary(row, "doubles");

    const officialPoints = toNumber(row.official_points_for_comparison);
    const livePoints = toNumber(row.live_points);
    const pointsChange = toNumber(row.points_change_vs_official);

    summaryRows.push({
      live_rank: row.live_rank,
      official_rank: row.official_rank,
      rank_change_vs_official: row.rank_change_vs_official,

      player_id: playerId,
      player_name: row.player_name,
      gender: row.gender,
      country: row.country,
      country_name: row.country_name,
      birth_year: row.birth_year,

      official_points: officialPoints,
      live_points: livePoints,
      points_change_vs_official: pointsChange,

      singles_points: row.singles_points,
      doubles_points_raw: row.doubles_points_raw,
      doubles_points_weighted: row.doubles_points_weighted,

      has_live_result: row.has_live_result,
      has_dropped_result: row.has_dropped_result,

      live_rows_available: playerLiveRows.length,
      live_singles_rows_available: liveSinglesRows.length,
      live_doubles_rows_available: liveDoublesRows.length,

      live_raw_points_available: sumPoints(playerLiveRows),
      live_weighted_points_available: Number(sumWeightedPoints(playerLiveRows).toFixed(2)),

      live_singles_results_counting: row.live_singles_results_counting,
      live_doubles_results_counting: row.live_doubles_results_counting,

      dropped_rows_count: playerDroppedRows.length,
      dropped_singles_rows_count: droppedSinglesRows.length,
      dropped_doubles_rows_count: droppedDoublesRows.length,

      dropped_raw_points: sumPoints(playerDroppedRows),
      dropped_weighted_points_estimated: Number(sumWeightedPoints(playerDroppedRows).toFixed(2)),

      active_rows_after_drops: playerActiveRows.length,

      best_singles_summary: bestSingles,
      best_doubles_summary: bestDoubles,

      audit_note:
        "points_change_vs_official é o saldo final após recomposição dos 6 melhores resultados; não precisa bater exatamente com live_weighted_points_available - dropped_weighted_points_estimated.",
    });
  }

  return summaryRows.sort((a, b) => {
    const genderCompare = cleanText(a.gender).localeCompare(cleanText(b.gender));

    if (genderCompare !== 0) return genderCompare;

    return toNumber(a.live_rank) - toNumber(b.live_rank);
  });
}

function buildDetailRows(liveRankingRows, liveRows, droppedRows) {
  const detailRows = [];

  for (const rankingRow of liveRankingRows) {
    const playerId = getPlayerId(rankingRow);

    if (!playerId) continue;

    const baseInfo = {
      player_id: playerId,
      player_name: rankingRow.player_name,
      gender: rankingRow.gender,
      country: rankingRow.country,
      birth_year: rankingRow.birth_year,
      official_rank: rankingRow.official_rank,
      live_rank: rankingRow.live_rank,
      official_points: rankingRow.official_points_for_comparison,
      live_points: rankingRow.live_points,
      points_change_vs_official: rankingRow.points_change_vs_official,
    };

    for (const eventType of ["singles", "doubles"]) {
      const bestResults = getBestResultsFromRankingRow(rankingRow, eventType);

      for (const result of bestResults) {
        detailRows.push({
          ...baseInfo,

          detail_type: "BEST_COUNTING_RESULT",
          event_type: eventType,
          slot: result.slot,

          source_type: result.source_type,
          tournament_name: result.tournament_name,
          category: result.category,
          round: result.round,
          start_date: result.start_date,

          points_raw: result.points,
          points_weighted:
            eventType === "doubles"
              ? Number((result.points / 4).toFixed(2))
              : result.points,

          status: "",
          drop_info: result.drop_info,
          raw: result.raw,
        });
      }
    }

    const playerLiveRows = getLiveRowsForPlayer(playerId, liveRows);

    for (const liveRow of playerLiveRows) {
      const eventType = cleanText(liveRow.event_type);
      const pointsRaw = toNumber(liveRow.points);

      detailRows.push({
        ...baseInfo,

        detail_type: "LIVE_WEEK_RESULT",
        event_type: eventType,
        slot: "",

        source_type: "LIVE",
        tournament_name: liveRow.tournament_name,
        category: liveRow.category,
        round: liveRow.round,
        start_date: liveRow.start_date,

        points_raw: pointsRaw,
        points_weighted:
          eventType === "doubles"
            ? Number((pointsRaw / 4).toFixed(2))
            : pointsRaw,

        status: liveRow.status,
        drop_info: "",
        raw: liveRow.raw_json || "",
      });
    }

    const playerDroppedRows = getDroppedRowsForPlayer(playerId, droppedRows);

    for (const droppedRow of playerDroppedRows) {
      const eventType = cleanText(droppedRow.event_type);
      const pointsRaw = toNumber(droppedRow.points);

      detailRows.push({
        ...baseInfo,

        detail_type: "DROPPED_RESULT",
        event_type: eventType,
        slot: "",

        source_type: "DROPPED",
        tournament_name: droppedRow.tournament_name,
        category: droppedRow.category,
        round: droppedRow.round,
        start_date: droppedRow.start_date,

        points_raw: pointsRaw,
        points_weighted:
          eventType === "doubles"
            ? Number((pointsRaw / 4).toFixed(2))
            : pointsRaw,

        status: droppedRow.status,
        drop_info: `drop_date=${droppedRow.drop_date_calculated}; cutoff=${droppedRow.drop_cutoff_date}; reason=${droppedRow.drop_reason}`,
        raw: droppedRow.raw_json || "",
      });
    }
  }

  return detailRows.sort((a, b) => {
    const rankDiff = toNumber(a.live_rank) - toNumber(b.live_rank);

    if (rankDiff !== 0) return rankDiff;

    const playerCompare = cleanText(a.player_name).localeCompare(cleanText(b.player_name));

    if (playerCompare !== 0) return playerCompare;

    return cleanText(a.detail_type).localeCompare(cleanText(b.detail_type));
  });
}

function getInterestingPlayers(summaryRows) {
  const brazilians = summaryRows.filter((row) => cleanText(row.country) === "BRA");

  const topMovers = [...summaryRows]
    .filter((row) => Math.abs(toNumber(row.rank_change_vs_official)) >= 10)
    .sort(
      (a, b) =>
        Math.abs(toNumber(b.rank_change_vs_official)) -
        Math.abs(toNumber(a.rank_change_vs_official))
    )
    .slice(0, 100);

  const topLive = [...summaryRows]
    .filter((row) => cleanText(row.has_live_result) === "true")
    .sort((a, b) => toNumber(a.live_rank) - toNumber(b.live_rank))
    .slice(0, 100);

  const map = new Map();

  for (const row of [...brazilians, ...topMovers, ...topLive]) {
    map.set(row.player_id, row);
  }

  return [...map.values()].sort((a, b) => {
    const countryA = cleanText(a.country) === "BRA" ? 0 : 1;
    const countryB = cleanText(b.country) === "BRA" ? 0 : 1;

    if (countryA !== countryB) return countryA - countryB;

    return toNumber(a.live_rank) - toNumber(b.live_rank);
  });
}

function buildHtml(summaryRows, detailRows) {
  const interesting = getInterestingPlayers(summaryRows);

  const rowsHtml = interesting
    .map((row) => {
      const change = toNumber(row.points_change_vs_official);
      const changeClass = change > 0 ? "up" : change < 0 ? "down" : "same";

      return `
        <tr>
          <td>#${escapeHtml(row.live_rank)}</td>
          <td>#${escapeHtml(row.official_rank || "NR")}</td>
          <td>${escapeHtml(row.player_name)}<br><span>${escapeHtml(row.country)} · ${escapeHtml(row.birth_year)}</span></td>
          <td>${escapeHtml(formatNumber(row.live_points))}</td>
          <td class="${changeClass}">${change > 0 ? "+" : ""}${escapeHtml(formatNumber(change))}</td>
          <td>${escapeHtml(row.live_rows_available)}</td>
          <td>${escapeHtml(row.dropped_rows_count)}</td>
        </tr>
      `;
    })
    .join("");

  const generatedAt = new Date().toLocaleString("pt-BR");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Auditoria - ITF Juniors Live Ranking</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: #f4f7fb;
      color: #0f172a;
    }

    .page {
      width: min(1400px, calc(100% - 40px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    h1 {
      margin: 0;
      font-size: 32px;
      letter-spacing: -0.04em;
    }

    .subtitle {
      margin-top: 8px;
      color: #64748b;
      font-size: 14px;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 22px 0;
    }

    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 16px;
    }

    .label {
      color: #64748b;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 0.06em;
    }

    .value {
      margin-top: 8px;
      font-size: 26px;
      font-weight: 900;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
    }

    th {
      background: #f8fafc;
      color: #64748b;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
    }

    td {
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
      font-weight: 700;
    }

    td span {
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
    }

    .up {
      color: #16a34a;
    }

    .down {
      color: #dc2626;
    }

    .same {
      color: #64748b;
    }

    .note {
      margin-top: 18px;
      color: #64748b;
      line-height: 1.5;
      font-size: 13px;
    }

    code {
      background: #e2e8f0;
      padding: 2px 5px;
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <div class="page">
    <h1>Auditoria do Live Ranking</h1>
    <div class="subtitle">
      Gerado em ${escapeHtml(generatedAt)}. Esta tela destaca brasileiros, maiores mudanças e jogadores ativos na semana.
    </div>

    <div class="cards">
      <div class="card">
        <div class="label">Jogadores auditados</div>
        <div class="value">${summaryRows.length}</div>
      </div>

      <div class="card">
        <div class="label">Brasileiros</div>
        <div class="value">${summaryRows.filter((row) => cleanText(row.country) === "BRA").length}</div>
      </div>

      <div class="card">
        <div class="label">Com live</div>
        <div class="value">${summaryRows.filter((row) => cleanText(row.has_live_result) === "true").length}</div>
      </div>

      <div class="card">
        <div class="label">Com drops</div>
        <div class="value">${summaryRows.filter((row) => cleanText(row.has_dropped_result) === "true").length}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Live</th>
          <th>Oficial</th>
          <th>Jogador</th>
          <th>Pontos live</th>
          <th>Saldo</th>
          <th>Live rows</th>
          <th>Drops</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="note">
      Arquivos CSV detalhados gerados em <code>data/audit/player_audit_summary.csv</code>,
      <code>data/audit/player_audit_details.csv</code> e <code>data/audit/player_audit_brazilians.csv</code>.
      Use o <code>player_audit_details.csv</code> para conferir resultado por resultado.
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  await ensureDirs();

  console.log("");
  console.log("Lendo arquivos de ranking e auditoria...");

  const liveRankingRows = await readCsv(LIVE_RANKING_FILE);
  const liveRows = await readCsv(WEEK_LIVE_LEDGER_FILE);
  const droppedRows = await readCsv(DROPPED_POINTS_FILE);
  const activeRows = await readCsv(ACTIVE_LEDGER_FILE);

  const summaryRows = buildSummaryRows(
    liveRankingRows,
    liveRows,
    droppedRows,
    activeRows
  );

  const detailRows = buildDetailRows(liveRankingRows, liveRows, droppedRows);
  const brazilianRows = summaryRows.filter((row) => cleanText(row.country) === "BRA");

  await writeCsv(AUDIT_SUMMARY_FILE, summaryRows, [
    "live_rank",
    "official_rank",
    "rank_change_vs_official",

    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",

    "official_points",
    "live_points",
    "points_change_vs_official",

    "singles_points",
    "doubles_points_raw",
    "doubles_points_weighted",

    "has_live_result",
    "has_dropped_result",

    "live_rows_available",
    "live_singles_rows_available",
    "live_doubles_rows_available",

    "live_raw_points_available",
    "live_weighted_points_available",

    "live_singles_results_counting",
    "live_doubles_results_counting",

    "dropped_rows_count",
    "dropped_singles_rows_count",
    "dropped_doubles_rows_count",

    "dropped_raw_points",
    "dropped_weighted_points_estimated",

    "active_rows_after_drops",

    "best_singles_summary",
    "best_doubles_summary",

    "audit_note",
  ]);

  await writeCsv(AUDIT_DETAILS_FILE, detailRows, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "birth_year",
    "official_rank",
    "live_rank",
    "official_points",
    "live_points",
    "points_change_vs_official",

    "detail_type",
    "event_type",
    "slot",

    "source_type",
    "tournament_name",
    "category",
    "round",
    "start_date",

    "points_raw",
    "points_weighted",

    "status",
    "drop_info",
    "raw",
  ]);

  await writeCsv(AUDIT_BRAZILIANS_FILE, brazilianRows, [
    "live_rank",
    "official_rank",
    "rank_change_vs_official",

    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",

    "official_points",
    "live_points",
    "points_change_vs_official",

    "singles_points",
    "doubles_points_raw",
    "doubles_points_weighted",

    "has_live_result",
    "has_dropped_result",

    "live_rows_available",
    "live_singles_rows_available",
    "live_doubles_rows_available",

    "live_raw_points_available",
    "live_weighted_points_available",

    "live_singles_results_counting",
    "live_doubles_results_counting",

    "dropped_rows_count",
    "dropped_singles_rows_count",
    "dropped_doubles_rows_count",

    "dropped_raw_points",
    "dropped_weighted_points_estimated",

    "active_rows_after_drops",

    "best_singles_summary",
    "best_doubles_summary",

    "audit_note",
  ]);

  const html = buildHtml(summaryRows, detailRows);
  await fs.writeFile(AUDIT_HTML_FILE, html, "utf8");

  console.log("");
  console.log("Auditoria gerada com sucesso:");
  console.log("data/audit/player_audit_summary.csv");
  console.log("data/audit/player_audit_details.csv");
  console.log("data/audit/player_audit_brazilians.csv");
  console.log("data/audit/player_audit.html");
  console.log("");
  console.log("Abra no navegador:");
  console.log(`file:///${AUDIT_HTML_FILE.replaceAll("\\", "/")}`);
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});
