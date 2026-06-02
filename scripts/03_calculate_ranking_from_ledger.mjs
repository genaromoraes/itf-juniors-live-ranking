import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const POINTS_LEDGER_FILE = path.resolve("data/clean/points_ledger.csv");
const RANKINGS_SNAPSHOT_FILE = path.resolve("data/clean/rankings_snapshot.csv");

const OUT_DIR_CLEAN = path.resolve("data/clean");

const CALCULATED_RANKING_FILE = path.join(
  OUT_DIR_CLEAN,
  "calculated_ranking.csv"
);

const VALIDATION_FILE = path.join(
  OUT_DIR_CLEAN,
  "ranking_validation.csv"
);

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);

  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function groupByPlayer(rows) {
  const map = new Map();

  for (const row of rows) {
    const playerId = String(row.player_id || "").trim();

    if (!playerId) continue;

    if (!map.has(playerId)) {
      map.set(playerId, []);
    }

    map.get(playerId).push(row);
  }

  return map;
}

function getPlayerBaseInfo(rows) {
  const first = rows[0] || {};

  return {
    player_id: cleanText(first.player_id),
    player_name: cleanText(first.player_name),
    gender: cleanText(first.gender),
    country: cleanText(first.country),
    country_name: cleanText(first.country_name),
    birth_year: cleanText(first.birth_year),
  };
}

function sortResultsByPointsDesc(rows) {
  return [...rows].sort((a, b) => {
    const pointsDiff = toNumber(b.points) - toNumber(a.points);

    if (pointsDiff !== 0) return pointsDiff;

    const dateA = String(a.start_date || "");
    const dateB = String(b.start_date || "");

    return dateB.localeCompare(dateA);
  });
}

function sumPoints(rows) {
  return rows.reduce((sum, row) => sum + toNumber(row.points), 0);
}

function formatResult(row) {
  if (!row) return "";

  const tournament = cleanText(row.tournament_name);
  const category = cleanText(row.category);
  const round = cleanText(row.round);
  const points = toNumber(row.points);
  const date = cleanText(row.start_date);
  const countable = cleanText(row.countable_status);

  return `${points} pts | ${countable} | ${category} | ${round} | ${tournament} | ${date}`;
}

function calculateOfficialRebuild(rows) {
  const countableRows = rows.filter(
    (row) => cleanText(row.countable_status) === "countable"
  );

  const singles = countableRows.filter((row) => row.event_type === "singles");
  const doubles = countableRows.filter((row) => row.event_type === "doubles");

  const singlesTotal = sumPoints(singles);
  const doublesRawTotal = sumPoints(doubles);
  const doublesWeightedTotal = doublesRawTotal / 4;
  const total = singlesTotal + doublesWeightedTotal;

  return {
    official_rebuild_points: Number(total.toFixed(2)),
    official_rebuild_singles_points: Number(singlesTotal.toFixed(2)),
    official_rebuild_doubles_raw: Number(doublesRawTotal.toFixed(2)),
    official_rebuild_doubles_weighted: Number(doublesWeightedTotal.toFixed(2)),
    official_rebuild_singles_count: singles.length,
    official_rebuild_doubles_count: doubles.length,
  };
}

function calculateSimulatedTopSix(rows) {
  const singles = rows.filter((row) => row.event_type === "singles");
  const doubles = rows.filter((row) => row.event_type === "doubles");

  const bestSingles = sortResultsByPointsDesc(singles).slice(0, 6);
  const bestDoubles = sortResultsByPointsDesc(doubles).slice(0, 6);

  const singlesTotal = sumPoints(bestSingles);
  const doublesRawTotal = sumPoints(bestDoubles);
  const doublesWeightedTotal = doublesRawTotal / 4;
  const total = singlesTotal + doublesWeightedTotal;

  return {
    simulated_points: Number(total.toFixed(2)),
    simulated_singles_points: Number(singlesTotal.toFixed(2)),
    simulated_doubles_raw: Number(doublesRawTotal.toFixed(2)),
    simulated_doubles_weighted: Number(doublesWeightedTotal.toFixed(2)),

    simulated_singles_results_used: bestSingles.length,
    simulated_doubles_results_used: bestDoubles.length,

    best_singles_1: formatResult(bestSingles[0]),
    best_singles_2: formatResult(bestSingles[1]),
    best_singles_3: formatResult(bestSingles[2]),
    best_singles_4: formatResult(bestSingles[3]),
    best_singles_5: formatResult(bestSingles[4]),
    best_singles_6: formatResult(bestSingles[5]),

    best_doubles_1: formatResult(bestDoubles[0]),
    best_doubles_2: formatResult(bestDoubles[1]),
    best_doubles_3: formatResult(bestDoubles[2]),
    best_doubles_4: formatResult(bestDoubles[3]),
    best_doubles_5: formatResult(bestDoubles[4]),
    best_doubles_6: formatResult(bestDoubles[5]),
  };
}

function calculatePlayerRanking(rows) {
  const base = getPlayerBaseInfo(rows);

  const officialRebuild = calculateOfficialRebuild(rows);
  const simulatedTopSix = calculateSimulatedTopSix(rows);

  return {
    ...base,
    ...officialRebuild,
    ...simulatedTopSix,
    calculated_at: new Date().toISOString(),
  };
}

function assignRanks(rows, pointsField, rankField) {
  const byGender = new Map();

  for (const row of rows) {
    const gender = row.gender || "unknown";

    if (!byGender.has(gender)) {
      byGender.set(gender, []);
    }

    byGender.get(gender).push(row);
  }

  const ranked = [];

  for (const [, genderRows] of byGender.entries()) {
    const sorted = [...genderRows].sort((a, b) => {
      const diff = toNumber(b[pointsField]) - toNumber(a[pointsField]);

      if (diff !== 0) return diff;

      return String(a.player_name).localeCompare(String(b.player_name));
    });

    let previousPoints = null;
    let previousRank = 0;

    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const currentPoints = toNumber(row[pointsField]);

      let rank;

      if (previousPoints !== null && currentPoints === previousPoints) {
        rank = previousRank;
      } else {
        rank = i + 1;
      }

      previousPoints = currentPoints;
      previousRank = rank;

      ranked.push({
        ...row,
        [rankField]: rank,
      });
    }
  }

  return ranked;
}

function addRanks(rows) {
  const withOfficialRanks = assignRanks(
    rows,
    "official_rebuild_points",
    "official_rebuild_rank"
  );

  const withBothRanks = assignRanks(
    withOfficialRanks,
    "simulated_points",
    "simulated_rank"
  );

  return withBothRanks.sort((a, b) => {
    if (a.gender !== b.gender) {
      return String(a.gender).localeCompare(String(b.gender));
    }

    return toNumber(a.official_rebuild_rank) - toNumber(b.official_rebuild_rank);
  });
}

function buildOfficialSnapshotMap(snapshotRows) {
  const map = new Map();

  for (const row of snapshotRows) {
    const playerId = String(row.player_id || "").trim();

    if (!playerId) continue;

    map.set(playerId, {
      official_rank: toNumber(row.rank),
      official_points: toNumber(row.official_points),
      ranking_date: cleanText(row.ranking_date),
    });
  }

  return map;
}

function buildValidationRows(calculatedRows, snapshotRows) {
  const officialMap = buildOfficialSnapshotMap(snapshotRows);

  return calculatedRows.map((row) => {
    const official = officialMap.get(String(row.player_id)) || {};

    const officialPoints = toNumber(official.official_points);
    const officialRank = toNumber(official.official_rank);

    const officialRebuildPoints = toNumber(row.official_rebuild_points);
    const simulatedPoints = toNumber(row.simulated_points);

    const officialRebuildRank = toNumber(row.official_rebuild_rank);
    const simulatedRank = toNumber(row.simulated_rank);

    return {
      player_id: row.player_id,
      player_name: row.player_name,
      gender: row.gender,
      country: row.country,
      birth_year: row.birth_year,

      official_rank: officialRank || "",
      official_rebuild_rank: officialRebuildRank || "",
      simulated_rank: simulatedRank || "",

      official_points: officialPoints || "",
      official_rebuild_points: officialRebuildPoints,
      simulated_points: simulatedPoints,

      official_rebuild_points_difference:
        officialPoints || officialPoints === 0
          ? Number((officialRebuildPoints - officialPoints).toFixed(2))
          : "",

      simulated_points_difference:
        officialPoints || officialPoints === 0
          ? Number((simulatedPoints - officialPoints).toFixed(2))
          : "",

      official_rebuild_rank_difference:
        officialRank || officialRank === 0
          ? officialRebuildRank - officialRank
          : "",

      simulated_rank_difference:
        officialRank || officialRank === 0 ? simulatedRank - officialRank : "",

      official_rebuild_singles_points: row.official_rebuild_singles_points,
      official_rebuild_doubles_raw: row.official_rebuild_doubles_raw,
      official_rebuild_doubles_weighted:
        row.official_rebuild_doubles_weighted,

      simulated_singles_points: row.simulated_singles_points,
      simulated_doubles_raw: row.simulated_doubles_raw,
      simulated_doubles_weighted: row.simulated_doubles_weighted,

      ranking_date: official.ranking_date || "",
      calculated_at: row.calculated_at,
    };
  });
}

function printSummary(calculatedRows, validationRows) {
  const totalPlayers = calculatedRows.length;

  const boys = calculatedRows.filter((row) => row.gender === "M").length;
  const girls = calculatedRows.filter((row) => row.gender === "F").length;

  const officialPointDiffRows = validationRows.filter(
    (row) => toNumber(row.official_rebuild_points_difference) !== 0
  );

  const simulatedPointDiffRows = validationRows.filter(
    (row) => toNumber(row.simulated_points_difference) !== 0
  );

  const officialRankDiffRows = validationRows.filter(
    (row) => toNumber(row.official_rebuild_rank_difference) !== 0
  );

  const simulatedRankDiffRows = validationRows.filter(
    (row) => toNumber(row.simulated_rank_difference) !== 0
  );

  console.log("");
  console.log("Resumo do cálculo:");
  console.log(`Jogadores calculados: ${totalPlayers}`);
  console.log(`Masculino: ${boys}`);
  console.log(`Feminino: ${girls}`);

  console.log("");
  console.log("Validação oficial usando apenas countables da ITF:");
  console.log(
    `Diferenças de pontos: ${officialPointDiffRows.length}/${totalPlayers}`
  );
  console.log(
    `Diferenças de ranking: ${officialRankDiffRows.length}/${totalPlayers}`
  );

  console.log("");
  console.log("Simulação top 6 simples + top 6 duplas:");
  console.log(
    `Diferenças de pontos: ${simulatedPointDiffRows.length}/${totalPlayers}`
  );
  console.log(
    `Diferenças de ranking: ${simulatedRankDiffRows.length}/${totalPlayers}`
  );

  if (officialPointDiffRows.length > 0) {
    console.log("");
    console.log("Diferenças oficiais de pontos:");
    for (const row of officialPointDiffRows.slice(0, 10)) {
      console.log(
        `${row.gender} #${row.official_rank} ${row.player_name}: oficial ${row.official_points}, rebuild ${row.official_rebuild_points}, diff ${row.official_rebuild_points_difference}`
      );
    }
  }

  if (simulatedPointDiffRows.length > 0) {
    console.log("");
    console.log("Primeiras diferenças simuladas de pontos:");
    for (const row of simulatedPointDiffRows.slice(0, 10)) {
      console.log(
        `${row.gender} #${row.official_rank} ${row.player_name}: oficial ${row.official_points}, simulado ${row.simulated_points}, diff ${row.simulated_points_difference}`
      );
    }
  }

  if (officialRankDiffRows.length > 0) {
    console.log("");
    console.log("Primeiras diferenças oficiais de ranking:");
    for (const row of officialRankDiffRows.slice(0, 10)) {
      console.log(
        `${row.gender} ${row.player_name}: oficial #${row.official_rank}, rebuild #${row.official_rebuild_rank}, diff ${row.official_rebuild_rank_difference}`
      );
    }
  }
}

async function main() {
  await ensureDirs();

  console.log("Lendo points_ledger.csv...");
  const ledgerRows = await readCsv(POINTS_LEDGER_FILE);

  console.log("Lendo rankings_snapshot.csv...");
  const snapshotRows = await readCsv(RANKINGS_SNAPSHOT_FILE);

  console.log(`Linhas no ledger: ${ledgerRows.length}`);

  const grouped = groupByPlayer(ledgerRows);

  console.log(`Jogadores encontrados no ledger: ${grouped.size}`);

  const calculated = [];

  for (const rows of grouped.values()) {
    calculated.push(calculatePlayerRanking(rows));
  }

  const ranked = addRanks(calculated);

  const validation = buildValidationRows(ranked, snapshotRows);

  await writeCsv(CALCULATED_RANKING_FILE, ranked, [
    "official_rebuild_rank",
    "simulated_rank",

    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",

    "official_rebuild_points",
    "official_rebuild_singles_points",
    "official_rebuild_doubles_raw",
    "official_rebuild_doubles_weighted",
    "official_rebuild_singles_count",
    "official_rebuild_doubles_count",

    "simulated_points",
    "simulated_singles_points",
    "simulated_doubles_raw",
    "simulated_doubles_weighted",
    "simulated_singles_results_used",
    "simulated_doubles_results_used",

    "best_singles_1",
    "best_singles_2",
    "best_singles_3",
    "best_singles_4",
    "best_singles_5",
    "best_singles_6",

    "best_doubles_1",
    "best_doubles_2",
    "best_doubles_3",
    "best_doubles_4",
    "best_doubles_5",
    "best_doubles_6",

    "calculated_at",
  ]);

  await writeCsv(VALIDATION_FILE, validation, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "birth_year",

    "official_rank",
    "official_rebuild_rank",
    "simulated_rank",

    "official_points",
    "official_rebuild_points",
    "simulated_points",

    "official_rebuild_points_difference",
    "simulated_points_difference",

    "official_rebuild_rank_difference",
    "simulated_rank_difference",

    "official_rebuild_singles_points",
    "official_rebuild_doubles_raw",
    "official_rebuild_doubles_weighted",

    "simulated_singles_points",
    "simulated_doubles_raw",
    "simulated_doubles_weighted",

    "ranking_date",
    "calculated_at",
  ]);

  printSummary(ranked, validation);

  console.log("");
  console.log("Arquivos gerados:");
  console.log("data/clean/calculated_ranking.csv");
  console.log("data/clean/ranking_validation.csv");
  console.log("");
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});