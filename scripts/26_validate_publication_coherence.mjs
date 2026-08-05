import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import {
  TRACKED_BASE_LIMIT_PER_GENDER,
  TRACKED_BASE_TOTAL,
} from "./lib/ranking_limits.mjs";

function cleanText(value) {
  return String(value ?? "").trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
}

function uniqueValues(rows, field) {
  return [...new Set(rows.map((row) => cleanText(row[field])).filter(Boolean))];
}

function countByGender(rows, gender) {
  return rows.filter((row) => cleanText(row.gender).toUpperCase() === gender).length;
}

function requireSingleDate(rows, field, label, errors) {
  const values = uniqueValues(rows, field);
  if (values.length !== 1 || !isIsoDate(values[0])) {
    errors.push(`${label} precisa ter uma unica data ISO valida; recebeu ${values.join(", ") || "nenhuma"}.`);
    return "";
  }
  return values[0];
}

export async function validatePublication({
  cwd = process.cwd(),
  allowPartialCollection = /^(1|true|yes)$/i.test(
    String(process.env.ITF_ALLOW_PARTIAL_COLLECTION || "")
  ),
} = {}) {
  const cleanDir = path.join(cwd, "data", "clean");
  const exportsDir = path.join(cwd, "data", "exports");
  const files = {
    snapshot: path.join(cleanDir, "rankings_snapshot.csv"),
    tournaments: path.join(cleanDir, "week_tournaments.csv"),
    matches: path.join(cleanDir, "week_matches.csv"),
    playerResults: path.join(cleanDir, "week_player_results.csv"),
    resultSummary: path.join(cleanDir, "week_results_summary.csv"),
    liveRanking: path.join(cleanDir, "live_ranking_with_drops.csv"),
    resultErrors: path.join(cleanDir, "week_results_errors.csv"),
    html: path.join(exportsDir, "index.html"),
  };

  const [
    snapshotRows,
    tournamentRows,
    matchRows,
    playerResultRows,
    resultSummaryRows,
    liveRows,
    resultErrorRows,
    html,
  ] =
    await Promise.all([
      readCsv(files.snapshot),
      readCsv(files.tournaments),
      readCsv(files.matches),
      readCsv(files.playerResults),
      readCsv(files.resultSummary),
      readCsv(files.liveRanking),
      readCsv(files.resultErrors),
      fs.readFile(files.html, "utf8"),
    ]);

  const errors = [];
  const warnings = [];
  const rankingDate = requireSingleDate(
    snapshotRows,
    "ranking_date",
    "rankings_snapshot.csv",
    errors
  );
  const liveRankingDate = requireSingleDate(
    liveRows,
    "ranking_date",
    "live_ranking_with_drops.csv",
    errors
  );
  const weekStart = requireSingleDate(
    tournamentRows,
    "week_start",
    "week_tournaments.csv (week_start)",
    errors
  );
  const weekEnd = requireSingleDate(
    tournamentRows,
    "week_end",
    "week_tournaments.csv (week_end)",
    errors
  );

  if (snapshotRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`Snapshot oficial precisa ter ${TRACKED_BASE_TOTAL} jogadores; recebeu ${snapshotRows.length}.`);
  }
  if (liveRows.length !== TRACKED_BASE_TOTAL) {
    errors.push(`Ranking live precisa ter ${TRACKED_BASE_TOTAL} jogadores; recebeu ${liveRows.length}.`);
  }

  for (const [label, rows] of [
    ["Snapshot oficial", snapshotRows],
    ["Ranking live", liveRows],
  ]) {
    for (const gender of ["M", "F"]) {
      const count = countByGender(rows, gender);
      if (count !== TRACKED_BASE_LIMIT_PER_GENDER) {
        errors.push(`${label} precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} jogadores ${gender}; recebeu ${count}.`);
      }
    }
    const uniquePlayers = new Set(rows.map((row) => cleanText(row.player_id)).filter(Boolean));
    if (uniquePlayers.size !== TRACKED_BASE_TOTAL) {
      errors.push(`${label} precisa ter ${TRACKED_BASE_TOTAL} player_id unicos; recebeu ${uniquePlayers.size}.`);
    }
  }

  if (rankingDate && liveRankingDate && rankingDate !== liveRankingDate) {
    errors.push(`Ranking live esta em ${liveRankingDate}, mas a base oficial esta em ${rankingDate}.`);
  }
  if (rankingDate && weekStart && rankingDate !== weekStart) {
    errors.push(`A semana publicada comeca em ${weekStart}, mas a base oficial esta em ${rankingDate}.`);
  }
  if (weekStart && weekEnd && addDays(weekStart, 6) !== weekEnd) {
    errors.push(`A semana ${weekStart} a ${weekEnd} nao termina seis dias depois do inicio.`);
  }

  const realTournaments = tournamentRows.filter(
    (row) => cleanText(row.tournament_key) && cleanText(row.tournament_name)
  );
  if (realTournaments.length === 0) {
    errors.push("week_tournaments.csv nao contem nenhum torneio materializado.");
  }
  if (matchRows.length === 0) {
    errors.push("week_matches.csv nao contem nenhuma partida coletada.");
  }
  if (playerResultRows.length === 0) {
    errors.push("week_player_results.csv nao contem nenhum atleta coletado.");
  }
  if (resultSummaryRows.length !== realTournaments.length) {
    errors.push(
      `week_results_summary.csv esta incompleto: ${resultSummaryRows.length}/${realTournaments.length} torneios.`
    );
  }
  if (resultErrorRows.length > 0) {
    const message = `week_results_errors.csv contem ${resultErrorRows.length} erro(s) de coleta.`;
    if (allowPartialCollection) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }
  if (rankingDate && !html.includes(`\"ranking_date\":\"${rankingDate}\"`)) {
    errors.push(`index.html nao contem dados da base oficial ${rankingDate}.`);
  }

  return {
    valid: errors.length === 0,
    ranking_date: rankingDate,
    live_ranking_date: liveRankingDate,
    week_start: weekStart,
    week_end: weekEnd,
    snapshot_players: snapshotRows.length,
    live_players: liveRows.length,
    tournaments: realTournaments.length,
    matches: matchRows.length,
    player_results: playerResultRows.length,
    result_summaries: resultSummaryRows.length,
    collection_errors: resultErrorRows.length,
    partial_collection_allowed: allowPartialCollection,
    warnings,
    errors,
  };
}

export async function main() {
  const report = await validatePublication();
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) {
    throw new Error("Publicacao bloqueada: base oficial, semana e site nao estao coerentes.");
  }
  if (report.warnings.length > 0) {
    console.log(
      `Publicacao validada: pacote coerente; ${report.warnings.join(" ")}`
    );
  } else {
    console.log("Publicacao validada: pacote coerente e sem erros de coleta.");
  }
}

const isCli = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCli) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
