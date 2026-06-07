import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

const LIVE_RANKING_FILE = path.resolve(
  "data/clean/live_ranking_with_drops.csv"
);

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");
const WEEK_PLAYER_RESULTS_FILE = path.resolve(
  "data/clean/week_player_results.csv"
);
const WEEK_LIVE_LEDGER_ROWS_FILE = path.resolve(
  "data/clean/week_live_ledger_rows.csv"
);
const DROPPED_POINTS_FILE = path.resolve("data/clean/live_dropped_points.csv");
const LIVE_COMBINED_LEDGER_FILE = path.resolve(
  "data/clean/live_combined_ledger_with_drops.csv"
);

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

function countryCodeToIso2(countryCode) {
  const code = cleanText(countryCode).toUpperCase();

  if (!code || code.length !== 3) return "";

  const iso3ToIso2 = {
    ALG: "DZ",
    ARG: "AR",
    ARM: "AM",
    AUS: "AU",
    AUT: "AT",
    AZE: "AZ",
    BEL: "BE",
    BIH: "BA",
    BLR: "BY",
    BOL: "BO",
    BOT: "BW",
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
    DOM: "DO",
    ECU: "EC",
    EGY: "EG",
    ESA: "SV",
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
    JAM: "JM",
    JPN: "JP",
    KAZ: "KZ",
    KEN: "KE",
    KGZ: "KG",
    KOR: "KR",
    KSA: "SA",
    LAT: "LV",
    LIE: "LI",
    LTU: "LT",
    MAR: "MA",
    MAS: "MY",
    MDA: "MD",
    MDV: "MV",
    MEX: "MX",
    MKD: "MK",
    MON: "MC",
    NAM: "NA",
    NED: "NL",
    NEP: "NP",
    NGR: "NG",
    NOR: "NO",
    NZL: "NZ",
    PAK: "PK",
    PAR: "PY",
    PER: "PE",
    POL: "PL",
    POR: "PT",
    PUR: "PR",
    ROU: "RO",
    RSA: "ZA",
    RUS: "RU",
    SLO: "SI",
    SGP: "SG",
    SRB: "RS",
    SRI: "LK",
    SVK: "SK",
    SUI: "CH",
    SWE: "SE",
    THA: "TH",
    TJK: "TJ",
    TKM: "TM",
    TPE: "TW",
    TUN: "TN",
    TUR: "TR",
    UGA: "UG",
    UKR: "UA",
    URU: "UY",
    USA: "US",
    UZB: "UZ",
    VEN: "VE",
    ZIM: "ZW",
  };

  const iso2 = iso3ToIso2[code];

  if (!iso2) return "";

  return iso2.toLowerCase();
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

function normalizeWeekEventType(row) {
  const eventType = cleanText(row.event_type).toLowerCase();
  const matchType = cleanText(row.match_type_code).toUpperCase();

  if (eventType === "singles" || matchType === "S") return "singles";
  if (eventType === "doubles" || matchType === "D") return "doubles";

  return eventType || matchType.toLowerCase();
}

function getWeekTournamentKey(row) {
  return cleanText(row.tournament_key) || cleanText(row.tournament_name);
}

function buildLiveRoundMap(weekLiveLedgerRows) {
  const map = new Map();

  for (const row of weekLiveLedgerRows) {
    const playerId = cleanText(row.player_id);
    const tournamentKey = getWeekTournamentKey(row);
    const eventType = normalizeWeekEventType(row);
    const round = cleanText(row.round);

    if (!playerId || !tournamentKey || !eventType || !round) continue;

    map.set([playerId, tournamentKey, eventType].join("|"), round);
  }

  return map;
}

function getParticipationRoundLabel(row, round) {
  const status = cleanText(row.status).toLowerCase();

  if (status === "eliminated") {
    return `${round} ❌`;
  }

  return round;
}

function buildWeekParticipationMap(weekPlayerResults, weekLiveLedgerRows) {
  const liveRoundMap = buildLiveRoundMap(weekLiveLedgerRows);
  const map = new Map();
  const priorityByEvent = new Map();
  const today = new Date().toISOString().slice(0, 10);

  function getClassificationPriority(row) {
    const classification = cleanText(row.event_classification_code).toUpperCase();

    if (classification === "M") return 2;
    if (classification === "Q") return 1;
    return 0;
  }

  function getParticipationEventKey(playerId, tournamentKey, eventType) {
    return [playerId, tournamentKey, eventType].join("|");
  }

  for (const row of weekPlayerResults) {
    const playerId = cleanText(row.player_id);
    const tournamentKey = getWeekTournamentKey(row);
    const tournament = cleanText(row.tournament_name);
    const category = cleanText(row.category || row.tournament_category);
    const endDate = cleanText(row.end_date);
    const eventType = normalizeWeekEventType(row);

    if (!playerId || !tournamentKey || !tournament || !eventType) continue;

    const eventKey = getParticipationEventKey(playerId, tournamentKey, eventType);
    const priority = getClassificationPriority(row);
    const currentPriority = priorityByEvent.get(eventKey) ?? -1;

    if (priority < currentPriority) continue;

    const participation =
      map.get(playerId) ||
      {
        tournament,
        tournamentKey,
        category,
        endDate,
        isFinishedByDate: endDate ? endDate <= today : false,
        singlesSummary: "",
        doublesSummary: "",
        singlesStatus: "",
        doublesStatus: "",
      };

    if (participation.tournamentKey !== tournamentKey) continue;

    const liveRound =
      priority >= currentPriority
        ? liveRoundMap.get([playerId, tournamentKey, eventType].join("|")) ||
          liveRoundMap.get([playerId, tournament, eventType].join("|"))
        : "";
    const round = liveRound || cleanText(row.highest_round_name);
    const roundLabel = round ? getParticipationRoundLabel(row, round) : "";

    if (eventType === "singles") {
      participation.singlesStatus = cleanText(row.status).toLowerCase();

      if (roundLabel) {
        participation.singlesSummary = `Simples: ${roundLabel}`;
      }
    }

    if (eventType === "doubles") {
      participation.doublesStatus = cleanText(row.status).toLowerCase();

      if (roundLabel) {
        participation.doublesSummary = `Duplas: ${roundLabel}`;
      }
    }

    priorityByEvent.set(eventKey, priority);
    map.set(playerId, participation);
  }

  return map;
}

function getRankingImpact(row) {
  const points = toNumber(row.points);
  const eventType = cleanText(row.event_type).toLowerCase();

  if (eventType === "doubles") {
    return Number((points * 0.25).toFixed(2));
  }

  return points;
}

function getEventShortLabel(row) {
  const eventType = cleanText(row.event_type).toLowerCase();

  if (eventType === "singles") return "Simples";
  if (eventType === "doubles") return "Duplas";

  return eventType.toUpperCase();
}

function getTournamentYear(row) {
  const startDate = cleanText(row.start_date);
  const match = startDate.match(/\d{4}/);

  return match ? match[0] : "";
}

function buildPointDetail(row) {
  const impactPoints = getRankingImpact(row);

  return {
    event: getEventShortLabel(row),
    tournament: cleanText(row.tournament_name),
    category: cleanText(row.category),
    year: getTournamentYear(row),
    impact_points: impactPoints,
  };
}

function buildPointDetailsMap(weekLiveLedgerRows, droppedRows) {
  const map = new Map();

  function getPlayerDetails(playerId) {
    if (!map.has(playerId)) {
      map.set(playerId, { live: [], drops: [] });
    }

    return map.get(playerId);
  }

  for (const row of weekLiveLedgerRows) {
    const playerId = cleanText(row.player_id);
    const impactPoints = getRankingImpact(row);

    if (!playerId || impactPoints <= 0) continue;

    getPlayerDetails(playerId).live.push(buildPointDetail(row));
  }

  for (const row of droppedRows) {
    const playerId = cleanText(row.player_id);
    const impactPoints = getRankingImpact(row);

    if (!playerId || impactPoints <= 0) continue;

    getPlayerDetails(playerId).drops.push(buildPointDetail(row));
  }

  for (const details of map.values()) {
    details.live.sort((a, b) => b.impact_points - a.impact_points);
    details.drops.sort((a, b) => b.impact_points - a.impact_points);
  }

  return map;
}

function sortLedgerResults(rows) {
  return [...rows].sort((a, b) => {
    const pointsDiff = toNumber(b.points) - toNumber(a.points);

    if (pointsDiff !== 0) return pointsDiff;

    const liveA = cleanText(a.source_type) === "live" ? 1 : 0;
    const liveB = cleanText(b.source_type) === "live" ? 1 : 0;

    if (liveA !== liveB) return liveB - liveA;

    return cleanText(b.start_date).localeCompare(cleanText(a.start_date));
  });
}

function buildResultKey(row) {
  return [
    cleanText(row.player_id),
    cleanText(row.event_type),
    cleanText(row.tournament_name),
    cleanText(row.category),
    cleanText(row.start_date),
    cleanText(row.round),
    toNumber(row.points),
    cleanText(row.source_type),
  ].join("|");
}

function buildPointCartelMap(combinedLedgerRows) {
  const byPlayer = new Map();

  for (const row of combinedLedgerRows) {
    const playerId = cleanText(row.player_id);
    const eventType = cleanText(row.event_type);

    if (!playerId) continue;
    if (eventType !== "singles" && eventType !== "doubles") continue;

    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, { singles: [], doubles: [] });
    }

    byPlayer.get(playerId)[eventType].push(row);
  }

  const map = new Map();

  for (const [playerId, groups] of byPlayer.entries()) {
    const cartel = { singles: [], doubles: [] };

    for (const eventType of ["singles", "doubles"]) {
      const sorted = sortLedgerResults(groups[eventType]);
      const countingKeys = new Set(
        sorted.slice(0, 6).map((row) => buildResultKey(row))
      );

      cartel[eventType] = sorted.map((row) => ({
        tournament: cleanText(row.tournament_name),
        category: cleanText(row.category),
        round: cleanText(row.round),
        date: cleanText(row.start_date),
        points: toNumber(row.points),
        source: cleanText(row.source_type) === "live" ? "LIVE" : "",
        counting: countingKeys.has(buildResultKey(row)),
      }));
    }

    map.set(playerId, cartel);
  }

  return map;
}

const ROUND_ORDER = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];

const POINTS_BY_CATEGORY = {
  singles: {
    JGS: { R128: 0, R64: 0, R32: 90, R16: 180, QF: 300, SF: 490, F: 700, W: 1000 },
    J500: { R128: 0, R64: 0, R32: 45, R16: 90, QF: 150, SF: 250, F: 350, W: 500 },
    J300: { R128: 0, R64: 0, R32: 30, R16: 60, QF: 100, SF: 140, F: 210, W: 300 },
    J200: { R128: 0, R64: 0, R32: 18, R16: 36, QF: 60, SF: 100, F: 140, W: 200 },
    J100: { R128: 0, R64: 0, R32: 5, R16: 10, QF: 20, SF: 36, F: 60, W: 100 },
    J60: { R128: 0, R64: 0, R32: 0, R16: 5, QF: 10, SF: 18, F: 36, W: 60 },
    J30: { R128: 0, R64: 0, R32: 0, R16: 2, QF: 5, SF: 9, F: 18, W: 30 },
  },
  doubles: {
    JGS: { R128: 0, R64: 0, R32: 0, R16: 135, QF: 225, SF: 367, F: 525, W: 750 },
    J500: { R128: 0, R64: 0, R32: 0, R16: 67, QF: 112, SF: 187, F: 262, W: 375 },
    J300: { R128: 0, R64: 0, R32: 0, R16: 45, QF: 75, SF: 105, F: 157, W: 225 },
    J200: { R128: 0, R64: 0, R32: 0, R16: 27, QF: 45, SF: 75, F: 105, W: 150 },
    J100: { R128: 0, R64: 0, R32: 0, R16: 7, QF: 15, SF: 27, F: 45, W: 75 },
    J60: { R128: 0, R64: 0, R32: 0, R16: 0, QF: 7, SF: 14, F: 27, W: 45 },
    J30: { R128: 0, R64: 0, R32: 0, R16: 0, QF: 3, SF: 6, F: 13, W: 25 },
  },
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
  const eventPoints = POINTS_BY_CATEGORY[eventType] || POINTS_BY_CATEGORY.singles;
  const categoryPoints = eventPoints[category] || eventPoints.JGS;
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

function combineProjectedScenarios(singlesScenario, doublesScenario, livePoints) {
  if (!singlesScenario || !doublesScenario) return null;

  const singlesGain = singlesScenario.projectedTotal - livePoints;
  const doublesGain = doublesScenario.projectedTotal - livePoints;
  const sameRound = singlesScenario.targetRound === doublesScenario.targetRound;

  return {
    eventType: "combined",
    targetRound: sameRound
      ? singlesScenario.targetRound
      : `${singlesScenario.targetRound}/${doublesScenario.targetRound}`,
    projectedTotal: livePoints + singlesGain + doublesGain,
  };
}

function shouldProjectEvent(row, weekParticipationMap, eventType) {
  const participation = weekParticipationMap.get(cleanText(row.player_id));

  if (!participation) return false;
  if (participation.isFinishedByDate) return false;

  const status =
    eventType === "singles"
      ? cleanText(participation.singlesStatus).toLowerCase()
      : cleanText(participation.doublesStatus).toLowerCase();

  return status === "still_alive_or_champion";
}

function buildDataForHtml(
  rows,
  weekParticipationMap = new Map(),
  pointDetailsMap = new Map(),
  pointCartelMap = new Map()
) {
  return rows.map((row) => ({
    live_rank: toNumber(row.live_rank),
    official_rank: toNumber(row.official_rank),
    rank_change_vs_official: toNumber(row.rank_change_vs_official),

    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    gender: cleanText(row.gender),
    gender_label: getGenderLabel(row.gender),

    country: cleanText(row.country),
    country_iso2: countryCodeToIso2(row.country),
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

    playing_this_week:
      weekParticipationMap.get(cleanText(row.player_id)) || getPlayingThisWeek(row),
    point_details:
      pointDetailsMap.get(cleanText(row.player_id)) || { live: [], drops: [] },
    point_cartel:
      pointCartelMap.get(cleanText(row.player_id)) || { singles: [], doubles: [] },

    next_round_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        livePoints
      );

      return [
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        combinedScenario,
      ].filter(Boolean);
    })(),

    title_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.title,
        doublesScenario.title,
        livePoints
      );

      return [
        singlesScenario.title,
        doublesScenario.title,
        combinedScenario,
      ].filter(Boolean);
    })(),

    ranking_date: cleanText(row.ranking_date),
    calculated_at: cleanText(row.calculated_at),
  }));
}

function groupWeekTournaments(tournaments) {
  const map = new Map();

  function getTournamentDisplayName(name, category) {
    const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return name.replace(new RegExp(`^${escapedCategory}\\s+`, "i"), "");
  }

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
      displayName: getTournamentDisplayName(name, category),
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

function buildHtml(
  rows,
  weekTournaments,
  weekParticipationMap,
  pointDetailsMap,
  pointCartelMap
) {
  const data = buildDataForHtml(
    rows,
    weekParticipationMap,
    pointDetailsMap,
    pointCartelMap
  );
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
      --bg: #f5f8f7;
      --bg-glow: #e7f3ef;
      --panel: rgba(255, 255, 255, 0.94);
      --panel-solid: #ffffff;
      --panel-soft: #f7faf9;
      --text: #142432;
      --muted: #66788a;
      --muted-soft: #8a9aaa;
      --border: #dfe9e6;
      --border-soft: #edf3f1;
      --green-dark: #08756d;
      --green: #12805f;
      --green-soft: #dff7ee;
      --red: #d74855;
      --red-soft: #ffe8eb;
      --yellow: #a66a12;
      --yellow-soft: #fff2d7;
      --blue: #276f9f;
      --blue-soft: #e8f3fb;
      --shadow: 0 18px 50px rgba(26, 45, 57, 0.08);
      --shadow-soft: 0 8px 24px rgba(26, 45, 57, 0.06);
      --radius: 16px;
      --radius-sm: 10px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(220, 244, 236, 0.84), transparent 32rem),
        linear-gradient(180deg, var(--bg-glow) 0%, var(--bg) 34%, #f9fbfa 100%);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    .page {
      width: min(1760px, calc(100% - 48px));
      margin: 0 auto;
      padding: 16px 0 24px;
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: start;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      max-width: 780px;
      font-size: clamp(32px, 3vw, 42px);
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: var(--green-dark);
      font-weight: 800;
    }

    .creator {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      color: var(--muted);
      font-weight: 500;
      font-size: 11px;
      line-height: 1.2;
    }

    .creator a {
      color: var(--green-dark);
      text-decoration: none;
      font-weight: 600;
    }

    .beta {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      background: rgba(8, 117, 109, 0.1);
      color: var(--green-dark);
      border: 1px solid rgba(8, 117, 109, 0.12);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .top-controls {
      display: flex;
      gap: 6px;
      padding: 5px;
      background: rgba(255, 255, 255, 0.58);
      border: 1px solid rgba(255, 255, 255, 0.74);
      border-radius: 18px;
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(18px);
    }

    .mini-control {
      display: grid;
      gap: 3px;
    }

    .mini-control label,
    .filter label {
      font-size: 9px;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: 0.01em;
    }

    select,
    input {
      min-height: 28px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
      outline: none;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    input {
      width: 100%;
    }

    select:focus,
    input:focus {
      border-color: rgba(8, 117, 109, 0.38);
      box-shadow: 0 0 0 4px rgba(8, 117, 109, 0.1);
      background: #ffffff;
    }

    input:disabled {
      color: var(--muted);
      background: rgba(255, 255, 255, 0.62);
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(240px, 1.25fr) minmax(170px, 0.75fr) 170px 150px 170px;
      gap: 7px;
      align-items: end;
      margin-bottom: 8px;
      padding: 7px;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.74);
      border-radius: var(--radius);
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(18px);
    }

    .filter {
      display: grid;
      gap: 3px;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 290px;
      gap: 8px;
      align-items: start;
    }

    .ranking-card,
    .side-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(18px);
    }

    .ranking-card-header {
      padding: 9px 12px 7px;
      border-bottom: 1px solid var(--border-soft);
    }

    .ranking-card-header h2 {
      margin: 0;
      font-size: 13px;
      letter-spacing: -0.03em;
      font-weight: 700;
    }

    .formula {
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.18;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 10px;
    }

    thead {
      background: rgba(247, 250, 249, 0.92);
    }

    th {
      text-align: left;
      color: var(--muted);
      font-size: 8px;
      line-height: 1.05;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 5px 5px;
      border-bottom: 1px solid var(--border-soft);
      font-weight: 600;
      white-space: nowrap;
    }

    .sort-header {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;
    }

    .sort-header:hover,
    .sort-header.active {
      color: var(--green-dark);
    }

    .sort-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: rgba(8, 117, 109, 0.08);
      color: var(--green-dark);
      font-size: 7px;
      line-height: 1;
      opacity: 0.36;
    }

    .sort-header.active .sort-indicator {
      opacity: 1;
    }

    td {
      padding: 3px 5px;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: middle;
      line-height: 1.05;
    }

    tbody tr {
      cursor: pointer;
      transition: background 140ms ease, box-shadow 140ms ease;
    }

    tbody tr:hover {
      background: rgba(235, 247, 243, 0.56);
    }

    tbody tr.selected {
      background: rgba(224, 244, 237, 0.82);
      box-shadow: 4px 0 0 var(--green-dark) inset;
    }

    .rank {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .rank-change {
      display: inline-flex;
      min-width: 18px;
      justify-content: center;
      align-items: center;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      margin-left: 4px;
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
      background: #edf2f5;
      color: var(--muted);
    }

    .player {
      min-width: 170px;
    }

    .player-name {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
      line-height: 1.08;
      font-size: 11px;
      letter-spacing: -0.01em;
      word-break: normal;
      overflow-wrap: anywhere;
    }

    .country-flag {
      width: 16px;
      height: 11px;
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(20, 36, 50, 0.14), 0 4px 10px rgba(20, 36, 50, 0.08);
      flex: 0 0 auto;
      object-fit: cover;
    }

    .player-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 400;
      line-height: 1.25;
    }

    .points {
      font-weight: 700;
      color: #12324a;
      font-size: 11px;
      white-space: nowrap;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .points-cell {
      min-width: 156px;
    }

    .points-main {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-wrap: wrap;
    }

    .points-balance {
      display: inline-flex;
      align-items: center;
      min-height: 14px;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      border: 1px solid transparent;
      font-variant-numeric: tabular-nums;
    }

    .points-balance.positive {
      color: #087047;
      background: #e4f8ed;
      border-color: #b9ecd0;
    }

    .points-balance.negative {
      color: #b42334;
      background: #ffe8eb;
      border-color: #ffc6ce;
    }

    .points-balance.neutral {
      color: var(--muted);
      background: #edf2f5;
      border-color: #dbe5ea;
    }

    .points-info-button {
      margin-top: 0;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.78);
      color: var(--green-dark);
      border-radius: 999px;
      padding: 2px 6px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      box-shadow: none;
    }

    .points-info-button:hover {
      background: #ffffff;
      border-color: rgba(8, 117, 109, 0.26);
    }

    .points-detail {
      margin-top: 4px;
      padding: 5px 6px;
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      background: rgba(247, 250, 249, 0.82);
      color: var(--text);
    }

    .points-detail-section + .points-detail-section {
      margin-top: 4px;
    }

    .points-detail-title {
      color: var(--muted);
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .points-detail-line {
      margin-top: 2px;
      font-size: 8px;
      line-height: 1.14;
      color: #3d5264;
      overflow-wrap: anywhere;
    }

    .points-detail-impact {
      font-weight: 700;
      white-space: nowrap;
    }

    .small {
      color: var(--muted);
      font-size: 8px;
      line-height: 1.12;
    }

    .week-cell {
      min-width: 160px;
      font-weight: 600;
      line-height: 1.04;
      letter-spacing: -0.01em;
      word-break: normal;
      overflow-wrap: anywhere;
    }

    .week-tournament {
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .tournament-name {
      color: var(--cat-color, var(--text));
      font-weight: 700;
    }

    .week-tournament .tournament-name,
    .result-title.tournament-name {
      color: var(--cat-color, var(--text));
    }

    .week-sub {
      margin-top: 1px;
      color: var(--muted);
      font-size: 8px;
      font-weight: 500;
      line-height: 1.08;
    }

    .dash {
      color: var(--muted);
    }

    .status-pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      margin-right: 4px;
      white-space: nowrap;
      letter-spacing: 0.04em;
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

    .category-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 14px;
      border-radius: 999px;
      padding: 1px 5px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      color: var(--cat-color, var(--green-dark));
      background: var(--cat-bg, var(--green-soft));
      border: 1px solid var(--cat-border, rgba(8, 117, 109, 0.14));
    }

    .cat-jgs {
      --cat-color: #123C4A;
      --cat-bg: #F7F3EA;
      --cat-border: #123C4A;
    }

    .cat-j500 {
      --cat-color: #4F6F7A;
      --cat-bg: #F7F3EA;
      --cat-border: #4F6F7A;
    }

    .cat-j300 {
      --cat-color: #2B2B2B;
      --cat-bg: #E8DDC8;
      --cat-border: #C28A5C;
    }

    .cat-j200 {
      --cat-color: #123C4A;
      --cat-bg: #A7BFA3;
      --cat-border: #A7BFA3;
    }

    .cat-j100 {
      --cat-color: #2B2B2B;
      --cat-bg: #F7F3EA;
      --cat-border: #A7BFA3;
    }

    .cat-j60 {
      --cat-color: #C28A5C;
      --cat-bg: #F7F3EA;
      --cat-border: #C28A5C;
    }

    .cat-j30 {
      --cat-color: #4F6F7A;
      --cat-bg: #F7F3EA;
      --cat-border: #E8DDC8;
    }

    .side {
      display: grid;
      gap: 7px;
    }

    .side-card h3 {
      margin: 0 0 6px;
      font-size: 12px;
      letter-spacing: -0.03em;
      line-height: 1.2;
      font-weight: 700;
    }

    .side-card {
      padding: 7px;
    }

    .tournament-group {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 5px;
      padding: 3px 0;
      border-top: 1px solid var(--border-soft);
    }

    .tournament-group:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .tournament-list {
      font-size: 9px;
      line-height: 1.18;
      font-weight: 500;
    }

    .tournament-list .tournament-name + .tournament-name::before {
      content: ", ";
      color: var(--muted);
      font-weight: 400;
    }

    .profile-empty {
      color: var(--muted);
      line-height: 1.15;
      font-size: 10px;
      padding: 1px 0;
    }

    .profile-head {
      display: flex;
      gap: 5px;
      align-items: flex-start;
      margin-bottom: 5px;
    }

    .profile-flag {
      display: flex;
      align-items: center;
      padding-top: 2px;
    }

    .profile-flag .country-flag {
      width: 16px;
      height: 11px;
    }

    .profile-name {
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }

    .profile-meta {
      margin-top: 2px;
      color: var(--muted);
      font-size: 9px;
      line-height: 1.08;
    }

    .profile-line {
      font-size: 9px;
      color: var(--muted);
      line-height: 1.14;
      margin-bottom: 4px;
    }

    .profile-line strong {
      color: var(--text);
    }

    .profile-section {
      margin-top: 6px;
    }

    .profile-section-title {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      margin-bottom: 3px;
      letter-spacing: -0.01em;
    }

    .profile-section-meta {
      color: var(--muted);
      font-size: 8px;
      font-weight: 500;
      white-space: nowrap;
    }

    .result-card {
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      padding: 4px;
      margin-bottom: 3px;
      background: rgba(248, 251, 250, 0.86);
      font-size: 9px;
      line-height: 1.08;
    }

    .result-card.counting {
      background: #ffffff;
      border-color: var(--cat-border, rgba(8, 117, 109, 0.22));
      box-shadow: 0 5px 14px rgba(26, 45, 57, 0.05);
    }

    .result-card.not-counting {
      opacity: 0.58;
      background: rgba(248, 251, 250, 0.54);
      box-shadow: none;
    }

    .result-main {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 4px;
    }

    .result-title {
      font-weight: 600;
      line-height: 1.08;
    }

    .result-heading {
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .result-card.not-counting .result-title {
      font-weight: 500;
    }

    .result-points {
      margin-top: 2px;
      font-weight: 700;
      color: var(--green-dark);
      font-variant-numeric: tabular-nums;
    }

    .result-status {
      float: right;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 8px;
      font-weight: 700;
      border-radius: 999px;
      background: #edf4f2;
      padding: 1px 5px;
    }

    .result-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      white-space: nowrap;
      color: var(--green-dark);
      background: var(--green-soft);
    }

    .result-card.not-counting .result-badge {
      color: var(--muted);
      background: #edf2f5;
    }

    .summary-row {
      color: var(--muted);
      font-size: 9px;
      display: flex;
      justify-content: space-between;
      gap: 5px;
      border-bottom: 1px solid var(--border-soft);
    }

    .summary-row strong {
      color: var(--text);
    }
input,
select,
button {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
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
        padding-top: 26px;
      }

      .header {
        grid-template-columns: 1fr;
        gap: 18px;
      }

      .top-controls {
        justify-self: start;
      }

      .filters {
        grid-template-columns: 1fr 1fr;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .ranking-card {
        overflow-x: auto;
      }

      table {
        min-width: 820px;
      }
    }

    @media (max-width: 720px) {
      .page {
        width: min(100% - 16px, 100%);
        padding-bottom: 36px;
      }

      .filters {
        grid-template-columns: 1fr;
        padding: 12px;
      }

      .top-controls {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .ranking-card-header {
        padding: 20px 18px 14px;
      }

      .summary-row {
        flex-direction: column;
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
          Criado por
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
        <input id="searchInput" type="text" placeholder="Nome do atleta" />
      </div>

      <div class="filter">
        <label>Buscar país</label>
        <input id="countrySearchInput" type="text" placeholder="País ou sigla" />
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
        </select>
      </div>

      <div class="filter">
        <label>Ordenar por</label>
        <select id="sortFilter">
          <option value="RANK" selected>Ranking ao vivo</option>
          <option value="OFFICIAL_RANK">Ranking oficial</option>
          <option value="PLAYER">Atleta</option>
          <option value="YEAR">Ano</option>
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

        <div class="summary-row" style="padding: 4px 7px 0;">
          <span id="visibleSummary">Carregando...</span>
          <span>Base oficial: ${escapeHtml(rankingDate || "não informado")}</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>
                <button class="sort-header active" type="button" data-sort-header="RANK" onclick="setTableSort('RANK')">
                  <span>Ranking<br />ao vivo</span>
                  <span class="sort-indicator" data-sort-indicator="RANK">↑</span>
                </button>
              </th>
              <th>
                <button class="sort-header" type="button" data-sort-header="PLAYER" onclick="setTableSort('PLAYER')">
                  <span>Atleta</span>
                  <span class="sort-indicator" data-sort-indicator="PLAYER">↕</span>
                </button>
              </th>
              <th>
                <button class="sort-header" type="button" data-sort-header="YEAR" onclick="setTableSort('YEAR')">
                  <span>Ano</span>
                  <span class="sort-indicator" data-sort-indicator="YEAR">↕</span>
                </button>
              </th>
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
    const countrySearchInput = document.getElementById("countrySearchInput");
    const genderFilter = document.getElementById("genderFilter");
    const sortFilter = document.getElementById("sortFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");
    const weekTournaments = document.getElementById("weekTournaments");
    const profileCard = document.getElementById("profileCard");

    let selectedPlayerId = "";
    let expandedPointsPlayerId = "";
    let sortColumn = "RANK";
    let sortDirection = "asc";

    function escapeHtmlClient(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function normalizeSearchText(value) {
      return String(value ?? "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    function includesSearch(value, search) {
      if (!search) return true;
      return normalizeSearchText(value).includes(search);
    }

    function getCategoryClass(category) {
      const key = String(category || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");

      return key ? "cat-" + key : "";
    }

    function getCategoryChipHtml(category) {
      if (!category) return "";

      return '<span class="category-chip ' + getCategoryClass(category) + '">' +
             escapeHtmlClient(category) +
             '</span>';
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

    function getFlagHtml(row) {
      const iso2 = String(row.country_iso2 || "").toLowerCase();

      if (!iso2) return "";

      const country = escapeHtmlClient(row.country || "");
      const countryName = escapeHtmlClient(row.country_name || row.country || "");

      return '<img class="country-flag" src="https://flagcdn.com/24x18/' + iso2 + '.png" alt="' + country + '" title="' + countryName + '" loading="lazy" />';
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

    function getPointsHtml(row) {
      const balance = Number(row.points_change_vs_official || 0);
      const balanceClass = getBalanceClass(balance);
      const balanceSign = getBalanceSign(balance);
      const balanceTone = balanceClass === 'green'
        ? 'positive'
        : balanceClass === 'red'
          ? 'negative'
          : 'neutral';
      const isExpanded = expandedPointsPlayerId === row.player_id;
      const liveDetails = row.point_details?.live || [];
      const dropDetails = row.point_details?.drops || [];
      const hasDetails = liveDetails.length || dropDetails.length;
      const buttonLabel = isExpanded ? "menos info" : "+ info";

      return '<div class="points-cell">' +
             '<div class="points-main">' +
             '<span class="points">' + formatNumberClient(row.live_points) + '</span>' +
             '<span class="points-balance ' + balanceTone + '">' +
             balanceSign + formatNumberClient(balance) +
             '</span>' +
             (hasDetails
               ? '<button class="points-info-button" type="button" onclick="togglePointsInfo(event, \\'' + escapeHtmlClient(row.player_id) + '\\')">' + buttonLabel + '</button>'
               : '') +
             '</div>' +
             (isExpanded ? getPointsDetailHtml(row) : '') +
             '</div>';
    }

    function getPointDetailLineHtml(item, sign, className) {
      const impact = Number(item.impact_points || 0);
      const yearText = item.year ? ' ' + escapeHtmlClient(item.year) : '';
      const eventText = item.event ? ' · ' + escapeHtmlClient(item.event) : '';
      const categoryClass = getCategoryClass(item.category);

      return '<div class="points-detail-line ' + categoryClass + '">' +
             '<span class="points-detail-impact ' + className + '">' + sign + formatNumberClient(impact) + '</span>' +
             (item.category ? ' ' + getCategoryChipHtml(item.category) : '') +
             ' · <span class="tournament-name">' + escapeHtmlClient(item.tournament || "Torneio") + '</span>' +
             yearText +
             eventText +
             '</div>';
    }

    function getPointsDetailSectionHtml(title, items, sign, className) {
      if (!items.length) return "";

      return '<div class="points-detail-section">' +
             '<div class="points-detail-title">' + title + '</div>' +
             items.map((item) => getPointDetailLineHtml(item, sign, className)).join("") +
             '</div>';
    }

    function getPointsDetailHtml(row) {
      const liveDetails = row.point_details?.live || [];
      const dropDetails = row.point_details?.drops || [];

      return '<div class="points-detail">' +
             getPointsDetailSectionHtml("Entrando", liveDetails, "+", "up") +
             getPointsDetailSectionHtml("Caindo", dropDetails, "-", "down") +
             '</div>';
    }

    function getPlayingHtml(row) {
      if (!row.playing_this_week) {
        return '<span class="dash">-</span>';
      }

      const p = row.playing_this_week;
      const categoryClass = getCategoryClass(p.category);

      return \`
        <div class="week-tournament \${categoryClass}">
          \${getCategoryChipHtml(p.category)}
          <strong class="tournament-name">\${escapeHtmlClient(p.tournament || "Torneio da semana")}</strong>
        </div>
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
            (\${getScenarioEventLabel(scenario)}) \${escapeHtmlClient(scenario.targetRound)} \${formatNumberClient(scenario.projectedTotal)}
          </div>
        \`)
        .join("");
    }

    function getScenarioEventLabel(scenario) {
      if (scenario.eventType === "singles") return "S";
      if (scenario.eventType === "doubles") return "D";
      if (scenario.eventType === "combined") return "S+D";
      return "";
    }

    function getTitleHtml(row) {
      if (!row.title_scenarios || !row.title_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return row.title_scenarios
        .map((scenario) => \`
          <div class="small">
            (\${getScenarioEventLabel(scenario)}) \${escapeHtmlClient(scenario.targetRound)} \${formatNumberClient(scenario.projectedTotal)}
          </div>
        \`)
        .join("");
    }

    function passesFilters(row) {
      const gender = genderFilter.value;
      const athleteSearch = normalizeSearchText(searchInput.value);
      const countrySearch = normalizeSearchText(countrySearchInput.value);

      if (row.gender !== gender) {
        return false;
      }

      if (Number(row.live_rank || 0) > 500) {
        return false;
      }

      if (athleteSearch && !includesSearch(row.player_name, athleteSearch)) {
        return false;
      }

      if (
        countrySearch &&
        !includesSearch(row.country, countrySearch) &&
        !includesSearch(row.country_name, countrySearch)
      ) {
        return false;
      }

      return true;
    }

    function sortRows(rows) {
      const rankValue = (value) => {
        const n = Number(value || 0);
        return n > 0 ? n : Number.MAX_SAFE_INTEGER;
      };

      return [...rows].sort((a, b) => {
        let result = 0;

        if (sortColumn === "OFFICIAL_RANK") {
          result = rankValue(a.official_rank) - rankValue(b.official_rank);
        } else if (sortColumn === "PLAYER") {
          result = normalizeSearchText(a.player_name).localeCompare(
            normalizeSearchText(b.player_name),
            "pt-BR"
          );
        } else if (sortColumn === "YEAR") {
          result = rankValue(a.birth_year) - rankValue(b.birth_year);
        } else {
          result = rankValue(a.live_rank) - rankValue(b.live_rank);
        }

        if (result === 0) {
          result = rankValue(a.live_rank) - rankValue(b.live_rank);
        }

        return sortDirection === "desc" ? -result : result;
      });
    }

    function updateSortHeaders() {
      document.querySelectorAll("[data-sort-header]").forEach((button) => {
        const key = button.getAttribute("data-sort-header");
        button.classList.toggle("active", key === sortColumn);
      });

      document.querySelectorAll("[data-sort-indicator]").forEach((indicator) => {
        const key = indicator.getAttribute("data-sort-indicator");
        indicator.textContent = key === sortColumn
          ? (sortDirection === "asc" ? "↑" : "↓")
          : "↕";
      });
    }

    function setTableSort(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = column;
        sortDirection = "asc";
      }

      if (Array.from(sortFilter.options).some((option) => option.value === sortColumn)) {
        sortFilter.value = sortColumn;
      }

      renderTable();
    }

    function renderTournaments() {
      weekTournaments.innerHTML = tournamentGroups.map((group) => {
        const categoryClass = getCategoryClass(group.category);

        return \`
          <div class="tournament-group \${categoryClass}">
            <div>\${getCategoryChipHtml(group.category)}</div>
            <div class="tournament-list">
              \${group.items.map((item) => '<span class="tournament-name" title="' + escapeHtmlClient(item.name) + '">' + escapeHtmlClient(item.displayName || item.name) + '</span>').join("")}
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
        const cardClass = item.counting ? "counting" : "not-counting";
        const badge = item.counting ? "Contando" : "Não contando";
        const source = item.source ? ' · ' + escapeHtmlClient(item.source) : '';
        const categoryClass = getCategoryClass(item.category);
        const details = [
          item.date,
          item.round,
        ].filter(Boolean).map(escapeHtmlClient).join(" · ");

        return \`
          <div class="result-card \${cardClass} \${categoryClass}">
            <div class="result-main">
              <div>
                <div class="result-heading">
                  \${getCategoryChipHtml(item.category)}
                  <div>
                    <div class="result-title tournament-name">\${escapeHtmlClient(item.tournament || "Torneio")}</div>
                    <div class="small">\${details}\${source}</div>
                  </div>
                </div>
              </div>
              <span class="result-badge">\${badge}</span>
            </div>
            <div class="result-points">\${formatNumberClient(item.points)} pts</div>
          </div>
        \`;
      }).join("");
    }

    function renderCartelSection(title, results) {
      const counting = results.filter((item) => item.counting);

      return \`
        <div class="profile-section">
          <div class="profile-section-title">
            <span>\${title}</span>
            <span class="profile-section-meta">\${counting.length}/6 contando</span>
          </div>
          \${renderResultCards(results)}
        </div>
      \`;
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

      const flag = getFlagHtml(row);

      profileCard.innerHTML = \`
        <h3>Pontuações do atleta</h3>

        <div class="profile-head">
          <div class="profile-flag">\${flag}</div>
          <div>
            <div class="profile-name">\${escapeHtmlClient(row.player_name)}</div>
            <div class="profile-meta">\${formatNumberClient(row.live_points)} pts ao vivo</div>
          </div>
        </div>

        <div class="profile-line">
          \${statusTags(row)}
        </div>

        \${renderCartelSection("Simples", row.point_cartel?.singles || [])}
        \${renderCartelSection("Duplas", row.point_cartel?.doubles || [])}
      \`;
    }

    function renderTable() {
      const rows = sortRows(rankingData.filter(passesFilters));
      updateSortHeaders();

      visibleSummary.innerHTML = '<strong>' + rows.length.toLocaleString("pt-BR") + '</strong> jogadores exibidos';

      if (selectedPlayerId && !rows.some((row) => row.player_id === selectedPlayerId)) {
        selectedPlayerId = "";
        renderProfile(null);
      }

      rankingBody.innerHTML = rows.map((row) => {
        const selected = selectedPlayerId === row.player_id ? "selected" : "";
        const moveClass = movementClass(row.rank_change_vs_official);
        const flag = getFlagHtml(row);

        return \`
          <tr class="\${selected}" onclick="selectPlayer('\${escapeHtmlClient(row.player_id)}')">
            <td>
              <span class="rank">\${row.live_rank}</span>
              <span class="rank-change \${moveClass}">\${formatChange(row.rank_change_vs_official)}</span>
            </td>

            <td class="player">
              <div class="player-name">\${flag}<span>\${escapeHtmlClient(row.player_name)}</span></div>
            </td>

            <td>\${escapeHtmlClient(row.birth_year || "-")}</td>

            <td>
              \${getPointsHtml(row)}
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

    function togglePointsInfo(event, playerId) {
      event.stopPropagation();
      expandedPointsPlayerId = expandedPointsPlayerId === playerId ? "" : playerId;
      renderTable();
    }

    window.selectPlayer = selectPlayer;
    window.togglePointsInfo = togglePointsInfo;
    window.setTableSort = setTableSort;

    searchInput.addEventListener("input", renderTable);
    countrySearchInput.addEventListener("input", renderTable);
    genderFilter.addEventListener("change", () => {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    });
    sortFilter.addEventListener("change", () => {
      sortColumn = sortFilter.value;
      sortDirection = "asc";
      renderTable();
    });

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

  console.log("Lendo week_player_results.csv...");
  const weekPlayerResults = await readCsv(WEEK_PLAYER_RESULTS_FILE);

  console.log("Lendo week_live_ledger_rows.csv...");
  const weekLiveLedgerRows = await readCsv(WEEK_LIVE_LEDGER_ROWS_FILE);

  console.log("Lendo live_dropped_points.csv...");
  const droppedRows = await readCsv(DROPPED_POINTS_FILE);

  console.log("Lendo live_combined_ledger_with_drops.csv...");
  const combinedLedgerRows = await readCsv(LIVE_COMBINED_LEDGER_FILE);

  const weekParticipationMap = buildWeekParticipationMap(
    weekPlayerResults,
    weekLiveLedgerRows
  );

  const pointDetailsMap = buildPointDetailsMap(weekLiveLedgerRows, droppedRows);
  const pointCartelMap = buildPointCartelMap(combinedLedgerRows);

  const html = buildHtml(
    rows,
    weekTournaments,
    weekParticipationMap,
    pointDetailsMap,
    pointCartelMap
  );

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

