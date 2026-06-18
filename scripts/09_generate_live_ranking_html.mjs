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
const WEEK_MATCHES_FILE = path.resolve("data/clean/week_matches.csv");
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
    timeZone: "America/Sao_Paulo",
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

function getClassificationLabel(row) {
  const classification = cleanText(row.event_classification_code).toUpperCase();
  const classificationDesc = cleanText(row.event_classification_desc).toLowerCase();

  if (
    classification === "Q" ||
    classificationDesc.includes("qual") ||
    classificationDesc.includes("qualification")
  ) {
    return "Qualy";
  }

  return "";
}

function getParticipationRoundLabel(row, round) {
  const status = cleanText(row.status).toLowerCase();
  const classificationLabel = getClassificationLabel(row);
  const visibleRound = getDisplayRoundLabel(round);
  const displayRound = classificationLabel ? `${classificationLabel} ${visibleRound}` : visibleRound;

  if (status === "eliminated") {
    return `${displayRound} ❌`;
  }

  return displayRound;
}

function getDisplayRoundLabel(round) {
  const text = cleanText(round);

  if (/^1st\s+round$/i.test(text)) return "R1";
  if (/^2nd\s+round$/i.test(text)) return "R2";
  if (/^3rd\s+round$/i.test(text)) return "R3";

  return text;
}

function buildWeekParticipationMap(weekPlayerResults, weekLiveLedgerRows, weekMatches = []) {
  const liveRoundMap = buildLiveRoundMap(weekLiveLedgerRows);
  const map = new Map();
  const priorityByEvent = new Map();
  const maxRoundOrderByEvent = new Map();
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

  function getDrawEventKey(row) {
    return [
      getWeekTournamentKey(row),
      cleanText(row.player_type_code),
      cleanText(row.match_type_code),
      cleanText(row.event_classification_code),
    ].join("|");
  }

  function getTechnicalRoundFromOrder(row) {
    const order = toNumber(row.highest_round_order);
    const maxOrder = maxRoundOrderByEvent.get(getDrawEventKey(row)) || 0;

    if (!order || !maxOrder) return "";

    const firstRoundIndex = ROUND_ORDER.indexOf("F") - maxOrder + 1;
    const roundIndex = firstRoundIndex + order - 1;

    return ROUND_ORDER[roundIndex] || "";
  }

  for (const row of weekMatches) {
    const eventKey = getDrawEventKey(row);
    const order = toNumber(row.round_order);

    if (!eventKey || !order) continue;

    maxRoundOrderByEvent.set(eventKey, Math.max(maxRoundOrderByEvent.get(eventKey) || 0, order));
  }

  for (const row of weekPlayerResults) {
    const eventKey = getDrawEventKey(row);
    const order = toNumber(row.highest_round_order);

    if (!eventKey || !order) continue;

    maxRoundOrderByEvent.set(eventKey, Math.max(maxRoundOrderByEvent.get(eventKey) || 0, order));
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
        singlesRound: "",
        doublesRound: "",
      };

    if (participation.tournamentKey !== tournamentKey) continue;

    const liveRound =
      priority >= currentPriority
        ? liveRoundMap.get([playerId, tournamentKey, eventType].join("|")) ||
          liveRoundMap.get([playerId, tournament, eventType].join("|"))
        : "";
    const round = liveRound || cleanText(row.highest_round_name);
    const roundLabel = round ? getParticipationRoundLabel(row, round) : "";
    const technicalRound = normalizeProjectionRound(liveRound) || getTechnicalRoundFromOrder(row);

    if (eventType === "singles") {
      participation.singlesStatus = cleanText(row.status).toLowerCase();
      participation.singlesRound = technicalRound;

      if (roundLabel) {
        participation.singlesSummary = `Simples: ${roundLabel}`;
      }
    }

    if (eventType === "doubles") {
      participation.doublesStatus = cleanText(row.status).toLowerCase();
      participation.doublesRound = technicalRound;

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

function getDetailKey(detail) {
  return [
    cleanText(detail.event),
    cleanText(detail.tournament),
    cleanText(detail.category),
    cleanText(detail.year),
  ].join("|");
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

function parseBestResultForDetail(resultText, eventType, { includeLive = false } = {}) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());

  if (parts.length < 6) return null;

  const source = cleanText(parts[1]).toUpperCase();

  if (source === "LIVE" && !includeLive) return null;

  return {
    event: eventType === "doubles" ? "Duplas" : "Simples",
    tournament: cleanText(parts[4]),
    category: cleanText(parts[2]),
    year: getTournamentYear({ start_date: cleanText(parts[5]) }),
    impact_points:
      eventType === "doubles"
        ? Number((toNumber(parts[0]) * 0.25).toFixed(2))
        : toNumber(parts[0]),
    source,
  };
}

function getCountingLiveDetailsForRow(row) {
  const bestItems = [
    ...getBestSingles(row).map((item) => ({ item, eventType: "singles" })),
    ...getBestDoubles(row).map((item) => ({ item, eventType: "doubles" })),
  ];

  return bestItems
    .map(({ item, eventType }) =>
      parseBestResultForDetail(item, eventType, { includeLive: true })
    )
    .filter((detail) => detail && detail.source === "LIVE")
    .map(({ source, ...detail }) => detail);
}

function buildPointDetailsMap(weekLiveLedgerRows, droppedRows, rankingRows) {
  const map = new Map();

  function getPlayerDetails(playerId) {
    if (!map.has(playerId)) {
      map.set(playerId, { live: [], drops: [] });
    }

    return map.get(playerId);
  }

  for (const row of droppedRows) {
    const playerId = cleanText(row.player_id);
    const impactPoints = getRankingImpact(row);
    const wasCountable =
      cleanText(row.countable_status) === "countable" ||
      cleanText(row.is_countable_at_collection).toLowerCase() === "true";

    if (!playerId || impactPoints <= 0 || !wasCountable) continue;

    getPlayerDetails(playerId).drops.push(buildPointDetail(row));
  }

  for (const row of rankingRows) {
    const playerId = cleanText(row.player_id);

    if (!playerId) continue;

    const details = getPlayerDetails(playerId);
    const existingKeys = new Set([
      ...details.live.map(getDetailKey),
      ...details.drops.map(getDetailKey),
    ]);

    for (const liveDetail of getCountingLiveDetailsForRow(row)) {
      if (existingKeys.has(getDetailKey(liveDetail))) continue;

      details.live.push(liveDetail);
      existingKeys.add(getDetailKey(liveDetail));
    }

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

function normalizeProjectionRound(value) {
  const text = cleanText(value)
    .replace("❌", "")
    .replace("🏆", "W")
    .replace(/^Simples:\s*/i, "")
    .replace(/^Duplas:\s*/i, "")
    .replace(/^Singles\s*/i, "")
    .replace(/^Doubles\s*/i, "")
    .replace(/^Qualy\s*/i, "")
    .trim()
    .toUpperCase();

  if (text === "WR") return "W";
  if (text === "1ST ROUND" || text === "R1") return "R32";

  const match = text.match(/\b(R128|R64|R32|R16|QF|SF|F|W)\b/);
  return match ? match[1] : "";
}

function getParticipationRound(participation, eventType) {
  if (!participation) return "";

  const technicalRound =
    eventType === "singles"
      ? cleanText(participation.singlesRound)
      : cleanText(participation.doublesRound);

  if (technicalRound) return technicalRound;

  const summary =
    eventType === "singles"
      ? participation.singlesSummary
      : participation.doublesSummary;

  return normalizeProjectionRound(summary);
}

function getProjectedTotalFromTopSix(bestResults, livePoints, multiplier, targetRawPoints) {
  const parsedResults = bestResults
    .map((item) => ({
      text: item,
      result: parseLiveResult(item),
      isLive: item.toUpperCase().includes("LIVE"),
    }))
    .filter((item) => Number.isFinite(item.result.points));
  const liveIndex = parsedResults.findIndex((item) => item.isLive);
  const currentRawPoints = parsedResults
    .map((item) => item.result.points)
    .sort((a, b) => b - a)
    .slice(0, 6);
  const projectedRawPoints = parsedResults.map((item) => item.result.points);

  if (liveIndex >= 0) {
    projectedRawPoints[liveIndex] = targetRawPoints;
  } else {
    projectedRawPoints.push(targetRawPoints);
  }

  const currentContribution = currentRawPoints.reduce((sum, points) => sum + points, 0);
  const projectedContribution = projectedRawPoints
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, points) => sum + points, 0);

  return livePoints + (projectedContribution - currentContribution) * multiplier;
}

function getProjectedScenario(bestResults, livePoints, eventType, multiplier, participation) {
  const liveItems = getLiveResultsFromBest(bestResults);
  const participationRound = getParticipationRound(participation, eventType);

  if (!liveItems.length && !participationRound) return { nextRound: null, title: null };

  const liveResult = parseLiveResult(liveItems[0]);
  const category = liveResult.category || cleanText(participation?.category) || "JGS";
  const eventPoints = POINTS_BY_CATEGORY[eventType] || POINTS_BY_CATEGORY.singles;
  const categoryPoints = eventPoints[category] || eventPoints.JGS;
  const currentRound = normalizeProjectionRound(liveResult.round) || participationRound;

  const currentIndex = ROUND_ORDER.indexOf(currentRound);
  const nextRound = currentIndex >= 0 && currentIndex < ROUND_ORDER.length - 1
    ? ROUND_ORDER[currentIndex + 1]
    : null;

  const nextRoundScenario = nextRound
    ? {
        eventType,
        targetRound: nextRound,
        projectedTotal: getProjectedTotalFromTopSix(
          bestResults,
          livePoints,
          multiplier,
          categoryPoints[nextRound] || 0
        ),
      }
    : null;

  const titleScenario = currentRound !== "W"
    ? {
        eventType,
        targetRound: "W",
        projectedTotal: getProjectedTotalFromTopSix(
          bestResults,
          livePoints,
          multiplier,
          categoryPoints.W || 0
        ),
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

function getMeaningfulProjectionScenarios(scenarios, livePoints) {
  const meaningful = scenarios.filter(
    (scenario) => scenario && scenario.projectedTotal > livePoints
  );
  const bestIndividualTotal = meaningful
    .filter((scenario) => scenario.eventType !== "combined")
    .reduce((max, scenario) => Math.max(max, scenario.projectedTotal), livePoints);

  return meaningful.filter(
    (scenario) =>
      scenario.eventType !== "combined" ||
      scenario.projectedTotal > bestIndividualTotal
  );
}

function shouldProjectEvent(row, weekParticipationMap, eventType) {
  const participation = weekParticipationMap.get(cleanText(row.player_id));

  if (!participation) return false;
  if (participation.isFinishedByDate) return false;

  const status =
    eventType === "singles"
      ? cleanText(participation.singlesStatus).toLowerCase()
      : cleanText(participation.doublesStatus).toLowerCase();

  return status === "still_alive_or_champion" || status === "not_started_or_unknown";
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
      pointDetailsMap.get(cleanText(row.player_id)) ||
      { live: [], drops: [] },
    point_cartel:
      pointCartelMap.get(cleanText(row.player_id)) || { singles: [], doubles: [] },

    next_round_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const participation = weekParticipationMap.get(cleanText(row.player_id));
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1, participation)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25, participation)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        livePoints
      );

      return getMeaningfulProjectionScenarios([
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        combinedScenario,
      ], livePoints);
    })(),

    title_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const participation = weekParticipationMap.get(cleanText(row.player_id));
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1, participation)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25, participation)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.title,
        doublesScenario.title,
        livePoints
      );

      return getMeaningfulProjectionScenarios([
        singlesScenario.title,
        doublesScenario.title,
        combinedScenario,
      ], livePoints);
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
    const surface = cleanText(row.surface);
    const surfaceCode = cleanText(row.surface_code).toUpperCase();

    if (!name) continue;

    if (!map.has(category)) {
      map.set(category, []);
    }

    map.get(category).push({
      name,
      displayName: getTournamentDisplayName(name, category),
      country,
      surface,
      surfaceCode,
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
  <script>
    document.documentElement.dataset.theme = localStorage.getItem("itf-live-theme") || "light";
  </script>
  <style>
    :root {
      --bg: #f5f8f7;
      --bg-glow: #e7f3ef;
      --bg-bottom: #f9fbfa;
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

    :root[data-theme="dark"] {
      --bg: #101820;
      --bg-glow: #14252b;
      --bg-bottom: #0d141a;
      --panel: rgba(18, 28, 36, 0.94);
      --panel-solid: #121c24;
      --panel-soft: #17242d;
      --text: #e7eef2;
      --muted: #9aacb8;
      --muted-soft: #71838f;
      --border: #2a3a44;
      --border-soft: #21313a;
      --green-dark: #61c6b8;
      --green: #72d5ad;
      --green-soft: rgba(97, 198, 184, 0.16);
      --red: #ff8390;
      --red-soft: rgba(255, 131, 144, 0.15);
      --yellow: #f3c36c;
      --yellow-soft: rgba(243, 195, 108, 0.16);
      --blue: #8cc8f1;
      --blue-soft: rgba(140, 200, 241, 0.16);
      --shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      --shadow-soft: 0 8px 24px rgba(0, 0, 0, 0.22);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(220, 244, 236, 0.84), transparent 32rem),
        linear-gradient(180deg, var(--bg-glow) 0%, var(--bg) 34%, var(--bg-bottom) 100%);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    :root[data-theme="dark"] body {
      background:
        radial-gradient(circle at top left, rgba(32, 88, 96, 0.42), transparent 32rem),
        linear-gradient(180deg, var(--bg-glow) 0%, var(--bg) 38%, var(--bg-bottom) 100%);
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

    :root[data-theme="dark"] .top-controls,
    :root[data-theme="dark"] .filters {
      background: rgba(18, 28, 36, 0.74);
      border-color: rgba(255, 255, 255, 0.08);
    }

    :root[data-theme="dark"] select,
    :root[data-theme="dark"] input,
    :root[data-theme="dark"] .toggle-button {
      color: var(--text);
      background: rgba(17, 27, 35, 0.9);
      border-color: var(--border);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    }

    :root[data-theme="dark"] select:focus,
    :root[data-theme="dark"] input:focus {
      background: #111b23;
      border-color: rgba(97, 198, 184, 0.48);
      box-shadow: 0 0 0 4px rgba(97, 198, 184, 0.12);
    }

    :root[data-theme="dark"] input:disabled {
      color: var(--muted);
      background: rgba(17, 27, 35, 0.62);
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.2fr) minmax(150px, 0.7fr) 206px 130px 150px 130px;
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

    .toggle-filter {
      align-self: stretch;
    }

    .segmented-control {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 28px;
      padding: 3px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(238, 244, 246, 0.82);
      gap: 3px;
    }

    .segmented-control button {
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;
    }

    .segmented-control button.active {
      background: #ffffff;
      color: var(--text);
      box-shadow: 0 4px 12px rgba(26, 45, 57, 0.08);
    }

    :root[data-theme="dark"] .segmented-control {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border);
    }

    :root[data-theme="dark"] .segmented-control button.active {
      background: rgba(255, 255, 255, 0.1);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .toggle-button {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 7px;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.9);
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
    }

    .toggle-button input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .toggle-track {
      width: 25px;
      height: 14px;
      border-radius: 999px;
      background: #d7e0df;
      position: relative;
      flex: 0 0 auto;
      transition: background 160ms ease;
    }

    .toggle-track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
      transition: transform 160ms ease;
    }

    .toggle-button input:checked + .toggle-track {
      background: var(--green-dark);
    }

    .toggle-button input:checked + .toggle-track::after {
      transform: translateX(11px);
    }

    .toggle-button:has(input:checked) {
      color: var(--text);
      border-color: rgba(8, 117, 109, 0.25);
      background: rgba(255, 255, 255, 0.96);
    }

    :root[data-theme="dark"] .toggle-button:has(input:checked) {
      border-color: rgba(97, 198, 184, 0.36);
      background: rgba(25, 42, 50, 0.96);
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
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 5px 10px;
      padding: 7px 8px;
      border-bottom: 1px solid var(--border-soft);
    }

    .formula {
      color: var(--muted);
      font-size: 9px;
      line-height: 1.1;
      white-space: nowrap;
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

    :root[data-theme="dark"] thead {
      background: rgba(23, 36, 45, 0.92);
    }

    th {
      text-align: left;
      color: var(--muted);
      font-size: 9px;
      line-height: 1.05;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 5px 5px;
      border-bottom: 1px solid var(--border-soft);
      font-weight: 700;
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

    tbody tr:nth-child(even) {
      background: rgba(18, 60, 74, 0.018);
    }

    tbody tr:hover {
      background: rgba(235, 247, 243, 0.56);
    }

    tbody tr.selected {
      background: rgba(224, 244, 237, 0.82);
      box-shadow: 4px 0 0 var(--green-dark) inset;
    }

    :root[data-theme="dark"] tbody tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.018);
    }

    :root[data-theme="dark"] tbody tr:hover {
      background: rgba(97, 198, 184, 0.08);
    }

    :root[data-theme="dark"] tbody tr.selected {
      background: rgba(97, 198, 184, 0.14);
    }

    .rank {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .rank-meta {
      margin-top: 2px;
      color: var(--muted);
      font-size: 8px;
      font-weight: 500;
      line-height: 1.05;
      white-space: nowrap;
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
      color: var(--text);
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

    :root[data-theme="dark"] .points-balance.positive {
      color: var(--green);
      background: var(--green-soft);
      border-color: rgba(114, 213, 173, 0.26);
    }

    :root[data-theme="dark"] .points-balance.negative {
      color: var(--red);
      background: var(--red-soft);
      border-color: rgba(255, 131, 144, 0.28);
    }

    :root[data-theme="dark"] .points-balance.neutral,
    :root[data-theme="dark"] .same {
      color: var(--muted);
      background: rgba(255, 255, 255, 0.06);
      border-color: var(--border);
    }

    .points-info-button {
      margin-top: 0;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.78);
      color: var(--green-dark);
      border-radius: 999px;
      width: 16px;
      height: 16px;
      padding: 0;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      box-shadow: none;
      opacity: 0;
      transform: translateY(1px);
      transition: opacity 140ms ease, border-color 140ms ease, background 140ms ease, transform 140ms ease;
    }

    tbody tr:hover .points-info-button,
    tbody tr.selected .points-info-button,
    .points-cell:focus-within .points-info-button,
    .points-info-button.active {
      opacity: 1;
      transform: translateY(0);
    }

    .points-info-button:hover,
    .points-info-button.active {
      background: #ffffff;
      border-color: rgba(8, 117, 109, 0.26);
    }

    :root[data-theme="dark"] .points-info-button {
      background: rgba(17, 27, 35, 0.82);
    }

    :root[data-theme="dark"] .points-info-button:hover,
    :root[data-theme="dark"] .points-info-button.active {
      background: rgba(25, 42, 50, 0.96);
      border-color: rgba(97, 198, 184, 0.34);
    }

    .points-detail {
      margin-top: 4px;
      padding: 5px 6px;
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      background: rgba(247, 250, 249, 0.82);
      color: var(--text);
    }

    :root[data-theme="dark"] .points-detail {
      background: rgba(17, 27, 35, 0.86);
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
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
      color: var(--muted);
      font-size: 9px;
      font-weight: 500;
      line-height: 1.12;
    }

    .week-result-item {
      color: var(--muted);
      white-space: nowrap;
    }

    .week-result-item strong {
      color: var(--cat-color, var(--text));
      font-weight: 600;
    }

    .week-result-item.title strong {
      font-weight: 700;
    }

    .week-result-item.title {
      font-weight: 700;
    }

    .week-result-item.eliminated strong {
      color: var(--muted);
    }

    .projection-list {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 2px;
      min-width: 0;
      max-width: none;
      line-height: 1;
    }

    .projection-item {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 16px;
      padding: 1px 4px;
      border: 1px solid var(--cat-border, var(--border));
      border-radius: 999px;
      background: var(--cat-soft, rgba(247, 250, 249, 0.9));
      color: var(--cat-color, var(--text));
      font-size: 8.5px;
      font-weight: 600;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .projection-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
    }

    .projection-main {
      color: var(--cat-color, var(--text));
      font-weight: 700;
    }

    .projection-points {
      color: var(--muted);
      font-weight: 600;
    }

    .projection-item .trophy {
      font-size: 12px;
      line-height: 0.8;
      vertical-align: -1px;
    }

    .week-result-separator {
      color: var(--muted-soft);
    }

    .week-result-item .out {
      color: var(--red);
      font-weight: 700;
      font-size: 13px;
      line-height: 0.8;
    }

    .week-result-item .trophy {
      font-size: 13px;
      line-height: 0.8;
      vertical-align: -1px;
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

    .cat-jgs,
    .cat-j500,
    .cat-j300,
    .cat-j200,
    .cat-j100,
    .cat-j60,
    .cat-j30 {
      --cat-color: #4f5f6b;
      --cat-bg: rgba(247, 250, 249, 0.9);
      --cat-soft: rgba(247, 250, 249, 0.9);
      --cat-border: rgba(79, 95, 107, 0.22);
    }

    :root[data-theme="dark"] .cat-jgs,
    :root[data-theme="dark"] .cat-j500,
    :root[data-theme="dark"] .cat-j300,
    :root[data-theme="dark"] .cat-j200,
    :root[data-theme="dark"] .cat-j100,
    :root[data-theme="dark"] .cat-j60,
    :root[data-theme="dark"] .cat-j30 {
      --cat-color: var(--muted);
      --cat-bg: rgba(255, 255, 255, 0.05);
      --cat-soft: rgba(255, 255, 255, 0.05);
      --cat-border: rgba(255, 255, 255, 0.12);
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
      align-items: center;
      gap: 5px;
      padding: 3px 0;
      border-top: 1px solid var(--border-soft);
    }

    .tournament-group:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .tournament-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      line-height: 1.18;
      font-weight: 500;
    }

    .week-tournament-name {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 1px 5px;
      background: rgba(247, 250, 249, 0.82);
      border: 1px solid var(--border-soft);
      color: var(--muted);
      font-weight: 600;
      line-height: 1.1;
    }

    :root[data-theme="dark"] .week-tournament-name {
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border);
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
      border: 1px solid rgba(223, 233, 230, 0.72);
      border-radius: var(--radius-sm);
      padding: 4px;
      margin-bottom: 3px;
      background: rgba(248, 251, 250, 0.86);
      font-size: 9px;
      line-height: 1.08;
    }

    .result-card.counting {
      background: #ffffff;
      border-color: rgba(18, 128, 95, 0.38);
      box-shadow: 0 5px 14px rgba(26, 45, 57, 0.05);
    }

    .result-card.not-counting {
      opacity: 0.58;
      background: rgba(248, 251, 250, 0.54);
      border-color: rgba(237, 243, 241, 0.86);
      box-shadow: none;
    }

    :root[data-theme="dark"] .result-card {
      background: rgba(17, 27, 35, 0.82);
      border-color: var(--border);
    }

    :root[data-theme="dark"] .result-card.counting {
      background: rgba(22, 36, 45, 0.94);
      border-color: rgba(97, 198, 184, 0.34);
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.18);
    }

    :root[data-theme="dark"] .result-card.not-counting {
      background: rgba(17, 27, 35, 0.54);
      border-color: var(--border-soft);
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

    .result-category-scope {
      display: contents;
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

    :root[data-theme="dark"] .result-status {
      background: rgba(255, 255, 255, 0.06);
    }

    .result-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 1px 3px;
      font-size: 8px;
      font-weight: 500;
      white-space: nowrap;
      color: color-mix(in srgb, var(--cat-color, var(--muted)) 72%, var(--muted));
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--cat-border, var(--border)) 60%, transparent);
    }

    .result-card.not-counting .result-badge {
      color: var(--muted);
      background: transparent;
      border-color: var(--border-soft);
    }

    .summary-row {
      color: var(--muted);
      font-size: 9px;
      display: flex;
      gap: 5px;
      align-items: baseline;
      white-space: nowrap;
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
  min-width: 126px;
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
        padding: 10px 10px 8px;
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
          <label class="toggle-button theme-toggle" for="themeToggle">
            <input id="themeToggle" type="checkbox" />
            <span class="toggle-track"></span>
            <span>Escuro</span>
          </label>
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
        <label>Categoria</label>
        <div class="segmented-control" role="group" aria-label="Filtrar categoria">
          <button type="button" class="active" data-gender-option="M">Masculino</button>
          <button type="button" data-gender-option="F">Feminino</button>
        </div>
        <select id="genderFilter" class="visually-hidden" aria-label="Categoria">
          <option value="M" selected>Masculino</option>
          <option value="F">Feminino</option>
        </select>
      </div>

      <div class="filter">
        <label>Ordenar por</label>
        <select id="sortFilter">
          <option value="RANK" selected>Ranking ao vivo</option>
          <option value="OFFICIAL_RANK">Ranking oficial</option>
        </select>
      </div>

      <div class="filter toggle-filter">
        <label>Filtro semanal</label>
        <label class="toggle-button" for="playingOnlyFilter">
          <input id="playingOnlyFilter" type="checkbox" />
          <span class="toggle-track"></span>
          <span>Jogando</span>
        </label>
      </div>

      <div class="filter">
        <label>Última atualização (UTC-3)</label>
        <input value="${escapeHtml(formatDateTime(calculatedAt))}" disabled />
      </div>
    </section>

    <main class="layout">
      <section class="ranking-card">
        <div class="ranking-card-header">
          <span class="formula">Pontos = ∑ 6 melhores resultados de simples + ∑ 25% dos 6 melhores resultados de duplas</span>
          <span class="summary-row">
            <span id="visibleSummary">Carregando...</span>
            <span id="rankingContext">Base oficial: ${escapeHtml(rankingDate || "não informado")}</span>
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>
                <button class="sort-header active" type="button" data-sort-header="RANK" onclick="setTableSort('RANK')">
                  <span id="rankHeaderLabel">Ranking<br />ao vivo</span>
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
              <th>Projeção<br />próx. rodada</th>
              <th>Projeção<br />título</th>
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
    const officialRankingDate = ${JSON.stringify(rankingDate || "não informado")};

    const searchInput = document.getElementById("searchInput");
    const countrySearchInput = document.getElementById("countrySearchInput");
    const themeToggle = document.getElementById("themeToggle");
    const genderFilter = document.getElementById("genderFilter");
    const genderButtons = Array.from(document.querySelectorAll("[data-gender-option]"));
    const sortFilter = document.getElementById("sortFilter");
    const playingOnlyFilter = document.getElementById("playingOnlyFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");
    const weekTournaments = document.getElementById("weekTournaments");
    const profileCard = document.getElementById("profileCard");

    let selectedPlayerId = "";
    let expandedPointsPlayerId = "";
    let sortColumn = "RANK";
    let sortDirection = "asc";

    function applyTheme(theme) {
      const normalizedTheme = theme === "dark" ? "dark" : "light";

      document.documentElement.dataset.theme = normalizedTheme;
      themeToggle.checked = normalizedTheme === "dark";
      localStorage.setItem("itf-live-theme", normalizedTheme);
    }

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

    function getTournamentDisplayNameClient(name, category) {
      const text = String(name || "").trim();
      const categoryText = String(category || "").trim();

      if (!text || !categoryText) return text;

      const prefix = categoryText.toLowerCase() + " ";
      return text.toLowerCase().startsWith(prefix)
        ? text.slice(categoryText.length).trimStart()
        : text;
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
      return "";
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
      const hasDetails =
        liveDetails.length ||
        dropDetails.length;
      const buttonLabel = "i";
      const buttonTitle = isExpanded ? "Ocultar detalhes dos pontos" : "Ver detalhes dos pontos";
      const buttonClass = isExpanded ? "points-info-button active" : "points-info-button";

      return '<div class="points-cell">' +
             '<div class="points-main">' +
             '<span class="points">' + formatNumberClient(row.live_points) + '</span>' +
             '<span class="points-balance ' + balanceTone + '">' +
             balanceSign + formatNumberClient(balance) +
             '</span>' +
             (hasDetails
               ? '<button class="' + buttonClass + '" type="button" title="' + buttonTitle + '" aria-label="' + buttonTitle + '" onclick="togglePointsInfo(event, \\'' + escapeHtmlClient(row.player_id) + '\\')">' + buttonLabel + '</button>'
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

    function getWeekRoundDisplay(round) {
      if (/^1st\\s+round$/i.test(round)) return "R1";
      if (/^2nd\\s+round$/i.test(round)) return "R2";
      if (/^3rd\\s+round$/i.test(round)) return "R3";
      return round;
    }

    function getWeekRoundHtml(round) {
      const display = getWeekRoundDisplay(round);
      if (display.toUpperCase() === "W") return '<span class="trophy">🏆</span>';
      return escapeHtmlClient(display);
    }

    function getWeekResultHtml(label, summary) {
      if (!summary) return "";

      const eliminated = summary.includes("❌");
      const round = summary
        .replace(/^Simples:\\s*/i, "")
        .replace(/^Duplas:\\s*/i, "")
        .replace(/❌/g, "")
        .trim();
      const isTitle = round.toUpperCase() === "W";
      const className = [
        "week-result-item",
        eliminated ? "eliminated" : "",
        isTitle ? "title" : "",
      ].filter(Boolean).join(" ");

      return '<span class="' + className + '">' +
             label + ' <strong>' + getWeekRoundHtml(round || "-") + '</strong>' +
             (eliminated ? ' <span class="out">×</span>' : '') +
             '</span>';
    }

    function getPlayingHtml(row) {
      if (!row.playing_this_week) {
        return '<span class="dash">-</span>';
      }

      const p = row.playing_this_week;
      const categoryClass = getCategoryClass(p.category);
      const tournamentName = getTournamentDisplayNameClient(
        p.tournament || "Torneio da semana",
        p.category
      );
      const resultChips = [
        getWeekResultHtml("🎾", p.singlesSummary),
        getWeekResultHtml("👥", p.doublesSummary),
      ].filter(Boolean).join('<span class="week-result-separator">·</span>');

      return \`
        <div class="week-tournament \${categoryClass}">
          \${getCategoryChipHtml(p.category)}
          <strong class="tournament-name">\${escapeHtmlClient(tournamentName)}</strong>
        </div>
        \${resultChips ? '<div class="week-sub ' + categoryClass + '">' + resultChips + '</div>' : ''}
      \`;
    }

    function getNextRoundHtml(row) {
      if (!row.next_round_scenarios || !row.next_round_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return getProjectionListHtml(row, row.next_round_scenarios);
    }

    function getScenarioEventLabel(scenario) {
      if (scenario.eventType === "singles") return "🎾";
      if (scenario.eventType === "doubles") return "👥";
      if (scenario.eventType === "combined") return "🎾+👥";
      return "";
    }

    function getProjectionRoundHtml(round) {
      const text = escapeHtmlClient(round);

      return text
        .split("/")
        .map((part) => part.toUpperCase() === "W" ? '<span class="trophy">🏆</span>' : part)
        .join("/");
    }

    function isTitleProjection(round) {
      return String(round || "")
        .split("/")
        .some((part) => part.toUpperCase() === "W");
    }

    function getProjectionItemHtml(scenario) {
      const eventLabel = getScenarioEventLabel(scenario);
      const roundHtml = getProjectionRoundHtml(scenario.targetRound);
      const pointsHtml = formatNumberClient(scenario.projectedTotal);
      const isTitle = isTitleProjection(scenario.targetRound);

      if (isTitle) {
        return \`
            <div class="projection-item projection-item-title">
              <span class="projection-main">\${roundHtml}</span>
              <span class="projection-chip">\${eventLabel}</span>
              <span class="projection-points">\${pointsHtml}</span>
            </div>
          \`;
      }

      return \`
            <div class="projection-item">
              <span class="projection-chip">\${eventLabel}</span>
              <span class="projection-main">\${roundHtml}</span>
              <span class="projection-points">\${pointsHtml}</span>
            </div>
          \`;
    }

    function getProjectionListHtml(row, scenarios) {
      const categoryClass = row.playing_this_week
        ? getCategoryClass(row.playing_this_week.category)
        : "";

      return '<div class="projection-list ' + categoryClass + '">' +
        scenarios
          .map((scenario) => getProjectionItemHtml(scenario))
          .join("") +
        '</div>';
    }

    function getTitleHtml(row) {
      if (!row.title_scenarios || !row.title_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return getProjectionListHtml(row, row.title_scenarios);
    }

    function passesFilters(row) {
      const gender = genderFilter.value;
      const athleteSearch = normalizeSearchText(searchInput.value);
      const countrySearch = normalizeSearchText(countrySearchInput.value);
      const playingOnly = playingOnlyFilter.checked;

      if (row.gender !== gender) {
        return false;
      }

      if (Number(row.live_rank || 0) > 500) {
        return false;
      }

      if (playingOnly && !row.playing_this_week) {
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
        button.classList.toggle("active", key === sortColumn || (key === "RANK" && sortColumn === "OFFICIAL_RANK"));
      });

      document.querySelectorAll("[data-sort-indicator]").forEach((indicator) => {
        const key = indicator.getAttribute("data-sort-indicator");
        const active = key === sortColumn || (key === "RANK" && sortColumn === "OFFICIAL_RANK");
        indicator.textContent = active
          ? (sortDirection === "asc" ? "↑" : "↓")
          : "↕";
      });

      const rankHeaderLabel = document.getElementById("rankHeaderLabel");
      if (rankHeaderLabel) {
        rankHeaderLabel.innerHTML = sortColumn === "OFFICIAL_RANK"
          ? "Ranking<br />oficial"
          : "Ranking<br />ao vivo";
      }

      const rankingContext = document.getElementById("rankingContext");
      if (rankingContext) {
        rankingContext.textContent = sortColumn === "OFFICIAL_RANK"
          ? "Ranking oficial ITF: " + officialRankingDate
          : "Base oficial: " + officialRankingDate;
      }
    }

    function updateGenderControl() {
      genderButtons.forEach((button) => {
        const active = button.getAttribute("data-gender-option") === genderFilter.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
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
              \${group.items.map((item) => '<span class="week-tournament-name" title="' + escapeHtmlClient(item.name) + '">' + escapeHtmlClient(item.displayName || item.name) + '</span>').join("")}
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
          getWeekRoundDisplay(item.round),
        ].filter(Boolean).map(escapeHtmlClient).join(" · ");

        return \`
          <div class="result-card \${cardClass}">
            <div class="result-main">
              <div class="result-category-scope \${categoryClass}">
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
      const total = results.length;

      return \`
        <div class="profile-section">
          <div class="profile-section-title">
            <span>\${title}</span>
            <span class="profile-section-meta">\${counting.length}/\${total}</span>
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
      const tags = statusTags(row);

      profileCard.innerHTML = \`
        <h3>Pontuações do atleta</h3>

        <div class="profile-head">
          <div class="profile-flag">\${flag}</div>
          <div>
            <div class="profile-name">\${escapeHtmlClient(row.player_name)}</div>
            <div class="profile-meta">\${formatNumberClient(row.live_points)} pts ao vivo</div>
          </div>
        </div>

        \${tags ? '<div class="profile-line">' + tags + '</div>' : ''}

        \${renderCartelSection("Simples", row.point_cartel?.singles || [])}
        \${renderCartelSection("Duplas", row.point_cartel?.doubles || [])}
      \`;
    }

    function getRankingCellHtml(row) {
      if (sortColumn === "OFFICIAL_RANK") {
        const officialRank = Number(row.official_rank || 0);
        const officialPoints = Number(row.official_points || 0);

        return '<span class="rank">' + (officialRank ? officialRank : "NR") + '</span>' +
               '<div class="rank-meta">' + formatNumberClient(officialPoints) + ' pts</div>';
      }

      const moveClass = movementClass(row.rank_change_vs_official);

      return '<span class="rank">' + row.live_rank + '</span>' +
             '<span class="rank-change ' + moveClass + '">' + formatChange(row.rank_change_vs_official) + '</span>';
    }

    function renderTable() {
      const rows = sortRows(rankingData.filter(passesFilters));
      updateSortHeaders();
      updateGenderControl();

      visibleSummary.innerHTML = '<strong>' + rows.length.toLocaleString("pt-BR") + '</strong> jogadores exibidos';

      if (selectedPlayerId && !rows.some((row) => row.player_id === selectedPlayerId)) {
        selectedPlayerId = "";
        renderProfile(null);
      }

      rankingBody.innerHTML = rows.map((row) => {
        const selected = selectedPlayerId === row.player_id ? "selected" : "";
        const flag = getFlagHtml(row);

        return \`
          <tr class="\${selected}" onclick="selectPlayer('\${escapeHtmlClient(row.player_id)}')">
            <td>
              \${getRankingCellHtml(row)}
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
    themeToggle.addEventListener("change", () => {
      applyTheme(themeToggle.checked ? "dark" : "light");
    });
    playingOnlyFilter.addEventListener("change", renderTable);
    genderFilter.addEventListener("change", () => {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    });
    genderButtons.forEach((button) => {
      button.addEventListener("click", () => {
        genderFilter.value = button.getAttribute("data-gender-option");
        genderFilter.dispatchEvent(new Event("change"));
      });
    });
    sortFilter.addEventListener("change", () => {
      sortColumn = sortFilter.value;
      sortDirection = "asc";
      renderTable();
    });

    renderTournaments();
    applyTheme(localStorage.getItem("itf-live-theme") || "light");
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

  console.log("Lendo week_matches.csv...");
  const weekMatches = await readCsv(WEEK_MATCHES_FILE);

  console.log("Lendo week_live_ledger_rows.csv...");
  const weekLiveLedgerRows = await readCsv(WEEK_LIVE_LEDGER_ROWS_FILE);

  console.log("Lendo live_dropped_points.csv...");
  const droppedRows = await readCsv(DROPPED_POINTS_FILE);

  console.log("Lendo live_combined_ledger_with_drops.csv...");
  const combinedLedgerRows = await readCsv(LIVE_COMBINED_LEDGER_FILE);

  const weekParticipationMap = buildWeekParticipationMap(
    weekPlayerResults,
    weekLiveLedgerRows,
    weekMatches
  );

  const pointDetailsMap = buildPointDetailsMap(
    weekLiveLedgerRows,
    droppedRows,
    rows
  );
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

