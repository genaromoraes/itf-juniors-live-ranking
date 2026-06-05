import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const WEEK_PLAYER_RESULTS_FILE = path.resolve(
  "data/clean/week_player_results.csv"
);

const WEEK_MATCHES_FILE = path.resolve("data/clean/week_matches.csv");

const OUT_DIR_CLEAN = path.resolve("data/clean");
const OUT_DIR_CONFIG = path.resolve("data/config");

const POINTS_TABLE_FILE = path.join(
  OUT_DIR_CONFIG,
  "junior_points_table.csv"
);

const WEEK_LIVE_POINTS_FILE = path.join(
  OUT_DIR_CLEAN,
  "week_live_points.csv"
);

const WEEK_LIVE_LEDGER_ROWS_FILE = path.join(
  OUT_DIR_CLEAN,
  "week_live_ledger_rows.csv"
);

const DOUBLES_RANKING_WEIGHT = 0.25;

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_CLEAN, { recursive: true });
  await fs.mkdir(OUT_DIR_CONFIG, { recursive: true });
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

function normalizeCategory(value) {
  return cleanText(value).toUpperCase();
}

function normalizeMatchType(value) {
  const text = cleanText(value).toUpperCase();

  if (text === "S") return "singles";
  if (text === "D") return "doubles";

  return text.toLowerCase();
}

function normalizeEventClassification(value) {
  const text = cleanText(value).toUpperCase();

  if (text === "M") return "main_draw";
  if (text === "Q") return "qualifying";

  return text.toLowerCase();
}

function getEventKey(row) {
  return [
    row.tournament_key,
    row.player_type_code,
    row.match_type_code,
    row.event_classification_code,
  ].join("|");
}

function getDefaultPointsRows() {
  const rows = [];

  function add(category, eventType, eventClassification, roundLabel, points) {
    rows.push({
      category,
      event_type: eventType,
      event_classification: eventClassification,
      round_label: roundLabel,
      points,
    });
  }

  const mainDrawTables = {
    singles: {
      JGS: {
        R128: 0,
        R64: 0,
        R32: 90,
        R16: 180,
        QF: 300,
        SF: 490,
        F: 700,
        W: 1000,
      },
      J500: {
        R128: 0,
        R64: 0,
        R32: 45,
        R16: 90,
        QF: 150,
        SF: 250,
        F: 350,
        W: 500,
      },
      J300: {
        R128: 0,
        R64: 0,
        R32: 30,
        R16: 60,
        QF: 100,
        SF: 140,
        F: 210,
        W: 300,
      },
      J200: {
        R128: 0,
        R64: 0,
        R32: 18,
        R16: 36,
        QF: 60,
        SF: 100,
        F: 140,
        W: 200,
      },
      J100: {
        R128: 0,
        R64: 0,
        R32: 5,
        R16: 10,
        QF: 20,
        SF: 36,
        F: 60,
        W: 100,
      },
      J60: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 5,
        QF: 10,
        SF: 18,
        F: 36,
        W: 60,
      },
      J30: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 2,
        QF: 5,
        SF: 9,
        F: 18,
        W: 30,
      },
    },
    doubles: {
      JGS: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 135,
        QF: 225,
        SF: 367,
        F: 525,
        W: 750,
      },
      J500: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 67,
        QF: 112,
        SF: 187,
        F: 262,
        W: 375,
      },
      J300: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 45,
        QF: 75,
        SF: 105,
        F: 157,
        W: 225,
      },
      J200: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 27,
        QF: 45,
        SF: 75,
        F: 105,
        W: 150,
      },
      J100: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 7,
        QF: 15,
        SF: 27,
        F: 45,
        W: 75,
      },
      J60: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 0,
        QF: 7,
        SF: 14,
        F: 27,
        W: 45,
      },
      J30: {
        R128: 0,
        R64: 0,
        R32: 0,
        R16: 0,
        QF: 3,
        SF: 6,
        F: 13,
        W: 25,
      },
    },
  };

  for (const [eventType, categoryTables] of Object.entries(mainDrawTables)) {
    for (const [category, table] of Object.entries(categoryTables)) {
      for (const [roundLabel, points] of Object.entries(table)) {
        add(category, eventType, "main_draw", roundLabel, points);
      }
    }
  }

  for (const category of Object.keys(mainDrawTables.singles)) {
    for (const eventType of ["singles", "doubles"]) {
      for (const roundLabel of ["Q1", "Q2", "Q3", "Q", "W"]) {
        add(category, eventType, "qualifying", roundLabel, 0);
      }
    }
  }

  return rows;
}

async function ensurePointsTableExists() {
  try {
    await fs.access(POINTS_TABLE_FILE);
    return;
  } catch {
    const rows = getDefaultPointsRows();

    await writeCsv(POINTS_TABLE_FILE, rows, [
      "category",
      "event_type",
      "event_classification",
      "round_label",
      "points",
    ]);

    console.log("");
    console.log("Tabela de pontos criada:");
    console.log("data/config/junior_points_table.csv");
  }
}

function buildPointsMap(pointsRows) {
  const map = new Map();

  for (const row of pointsRows) {
    const key = [
      normalizeCategory(row.category),
      cleanText(row.event_type),
      cleanText(row.event_classification),
      cleanText(row.round_label),
    ].join("|");

    map.set(key, toNumber(row.points));
  }

  return map;
}

function buildMaxRoundOrderByEventFromMatches(matchRows) {
  const map = new Map();

  for (const row of matchRows) {
    const key = getEventKey(row);
    const roundOrder = toNumber(row.round_order);

    const current = map.get(key) || 0;

    if (roundOrder > current) {
      map.set(key, roundOrder);
    }
  }

  return map;
}

function getRoundLabelsForMainDraw(totalRounds) {
  const drawSize = Math.pow(2, totalRounds);

  const labels = [];

  for (let roundOrder = 1; roundOrder <= totalRounds; roundOrder++) {
    const playersRemainingAtStart = drawSize / Math.pow(2, roundOrder - 1);

    if (roundOrder === totalRounds) {
      labels.push("F");
    } else if (roundOrder === totalRounds - 1) {
      labels.push("SF");
    } else if (roundOrder === totalRounds - 2) {
      labels.push("QF");
    } else {
      labels.push(`R${playersRemainingAtStart}`);
    }
  }

  labels.push("W");

  return labels;
}

function getMainDrawRoundLabel(row, maxRoundOrderByEvent) {
  const eventKey = getEventKey(row);
  const totalRounds =
    maxRoundOrderByEvent.get(eventKey) || toNumber(row.highest_round_order) || 1;

  const labels = getRoundLabelsForMainDraw(totalRounds);

  const wins = toNumber(row.wins);
  const losses = toNumber(row.losses);

  let achievedIndex;

  if (losses > 0) {
    // Perdeu na rodada depois de X vitórias.
    // Exemplo: 0 vitórias + derrota = caiu na primeira rodada.
    achievedIndex = wins;
  } else {
    // Ainda vivo.
    // Exemplo: 0 vitórias = está na primeira rodada.
    // 1 vitória = chegou na segunda rodada.
    // Se ganhou todas as rodadas da chave = campeão.
    achievedIndex = wins;
  }

  if (achievedIndex < 0) achievedIndex = 0;
  if (achievedIndex >= labels.length) achievedIndex = labels.length - 1;

  return labels[achievedIndex];
}

function getQualifyingRoundLabel(row) {
  const wins = toNumber(row.wins);
  const losses = toNumber(row.losses);

  if (losses > 0) {
    return `Q${wins + 1}`;
  }

  if (wins > 0) {
    return "Q";
  }

  return "Q1";
}

function getRoundLabelFromResult(row, maxRoundOrderByEvent) {
  const eventClassification = normalizeEventClassification(
    row.event_classification_code
  );

  if (eventClassification === "qualifying") {
    return getQualifyingRoundLabel(row);
  }

  return getMainDrawRoundLabel(row, maxRoundOrderByEvent);
}

function isMainDrawFirstRoundLoss(row) {
  const eventClassification = normalizeEventClassification(
    row.event_classification_code
  );

  return (
    eventClassification === "main_draw" &&
    toNumber(row.wins) === 0 &&
    toNumber(row.losses) > 0
  );
}

export function getLivePoints(row, roundLabel, pointsMap) {
  if (isMainDrawFirstRoundLoss(row)) {
    return 0;
  }

  const category = normalizeCategory(row.category);
  const eventType = normalizeMatchType(row.match_type_code);
  const eventClassification = normalizeEventClassification(
    row.event_classification_code
  );

  const key = [
    category,
    eventType,
    eventClassification,
    roundLabel,
  ].join("|");

  if (pointsMap.has(key)) {
    return pointsMap.get(key);
  }

  return 0;
}

export function buildLivePointRows(playerResults, matchRows, pointsMap) {
  const maxRoundOrderByEvent = buildMaxRoundOrderByEventFromMatches(matchRows);

  return playerResults.map((row) => {
    const eventType = normalizeMatchType(row.match_type_code);
    const eventClassification = normalizeEventClassification(
      row.event_classification_code
    );

    const eventKey = getEventKey(row);
    const totalRounds = maxRoundOrderByEvent.get(eventKey) || "";

    const roundLabel = getRoundLabelFromResult(row, maxRoundOrderByEvent);
    const livePoints = getLivePoints(row, roundLabel, pointsMap);

    const doublesWeightedPoints =
      eventType === "doubles"
        ? Number((livePoints * DOUBLES_RANKING_WEIGHT).toFixed(2))
        : "";

    return {
      tournament_key: row.tournament_key,
      tournament_name: row.tournament_name,
      category: normalizeCategory(row.category),
      start_date: row.start_date,
      end_date: row.end_date,

      player_id: row.player_id,
      player_name: row.player_name,
      nationality: row.nationality,

      player_type_code: row.player_type_code,
      player_type_desc: row.player_type_desc,

      event_type: eventType,
      event_classification: eventClassification,

      matches_played: row.matches_played,
      wins: row.wins,
      losses: row.losses,

      highest_round_order: row.highest_round_order,
      highest_round_name: row.highest_round_name,
      total_rounds_in_draw: totalRounds,
      calculated_round_label: roundLabel,

      status: row.status,
      live_points_raw: livePoints,
      live_points_weighted:
        eventType === "doubles" ? doublesWeightedPoints : livePoints,

      collected_at: new Date().toISOString(),
    };
  });
}

function buildLedgerRows(livePointRows) {
  return livePointRows
    .filter((row) => toNumber(row.live_points_raw) > 0)
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      gender:
        row.player_type_code === "B"
          ? "M"
          : row.player_type_code === "G"
            ? "F"
            : "",
      country: row.nationality,
      country_name: "",
      birth_year: "",

      event_type: row.event_type,
      countable_status: "live_unconfirmed",

      tournament_name: row.tournament_name,
      category: row.category,
      draw_type: row.event_classification,
      host_nation: "",
      host_nation_code: "",
      surface: "",
      surface_code: "",

      start_date: row.start_date,
      drop_date_calculated: "",

      round: row.calculated_round_label,
      points: row.live_points_raw,

      tournament_link: "",
      is_countable_at_collection: "false",
      is_live: "true",
      status: row.status,

      source_url: "",
      collected_at: row.collected_at,
      raw_json: JSON.stringify(row),
    }));
}

function printSummary(livePointRows, ledgerRows) {
  const total = livePointRows.length;
  const withPoints = livePointRows.filter(
    (row) => toNumber(row.live_points_raw) > 0
  ).length;

  const byTournament = new Map();

  for (const row of livePointRows) {
    const key = row.tournament_name;

    if (!byTournament.has(key)) {
      byTournament.set(key, {
        tournament_name: row.tournament_name,
        rows: 0,
        with_points: 0,
        max_points: 0,
      });
    }

    const item = byTournament.get(key);

    item.rows += 1;

    if (toNumber(row.live_points_raw) > 0) {
      item.with_points += 1;
    }

    if (toNumber(row.live_points_raw) > item.max_points) {
      item.max_points = toNumber(row.live_points_raw);
    }
  }

  console.log("");
  console.log("Resumo:");
  console.log(`Resultados por jogador: ${total}`);
  console.log(`Resultados com pontos > 0: ${withPoints}`);
  console.log(`Linhas live para ledger: ${ledgerRows.length}`);

  console.log("");
  console.log("Por torneio:");
  for (const item of [...byTournament.values()].sort((a, b) =>
    a.tournament_name.localeCompare(b.tournament_name)
  )) {
    console.log(
      `${item.tournament_name}: ${item.with_points}/${item.rows} com pontos | máximo ${item.max_points}`
    );
  }
}

async function main() {
  await ensureDirs();
  await ensurePointsTableExists();

  console.log("");
  console.log("Lendo resultados da semana...");
  const playerResults = await readCsv(WEEK_PLAYER_RESULTS_FILE);

  console.log("Lendo partidas da semana...");
  const matchRows = await readCsv(WEEK_MATCHES_FILE);

  console.log("Lendo tabela de pontos...");
  const pointsRows = await readCsv(POINTS_TABLE_FILE);
  const pointsMap = buildPointsMap(pointsRows);

  const livePointRows = buildLivePointRows(playerResults, matchRows, pointsMap);
  const ledgerRows = buildLedgerRows(livePointRows);

  await writeCsv(WEEK_LIVE_POINTS_FILE, livePointRows, [
    "tournament_key",
    "tournament_name",
    "category",
    "start_date",
    "end_date",

    "player_id",
    "player_name",
    "nationality",

    "player_type_code",
    "player_type_desc",

    "event_type",
    "event_classification",

    "matches_played",
    "wins",
    "losses",

    "highest_round_order",
    "highest_round_name",
    "total_rounds_in_draw",
    "calculated_round_label",

    "status",
    "live_points_raw",
    "live_points_weighted",

    "collected_at",
  ]);

  await writeCsv(WEEK_LIVE_LEDGER_ROWS_FILE, ledgerRows, [
    "player_id",
    "player_name",
    "gender",
    "country",
    "country_name",
    "birth_year",

    "event_type",
    "countable_status",

    "tournament_name",
    "category",
    "draw_type",
    "host_nation",
    "host_nation_code",
    "surface",
    "surface_code",

    "start_date",
    "drop_date_calculated",

    "round",
    "points",

    "tournament_link",
    "is_countable_at_collection",
    "is_live",
    "status",

    "source_url",
    "collected_at",
    "raw_json",
  ]);

  printSummary(livePointRows, ledgerRows);

  console.log("");
  console.log("Arquivos gerados:");
  console.log("data/clean/week_live_points.csv");
  console.log("data/clean/week_live_ledger_rows.csv");
  console.log("data/config/junior_points_table.csv");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err);
    process.exit(1);
  });
}
