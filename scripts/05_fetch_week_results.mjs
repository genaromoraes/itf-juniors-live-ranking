import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { pathToFileURL } from "url";

const DEFAULT_INPUT_DIR = path.resolve("data/clean");
const DEFAULT_OUT_DIR_RAW = path.resolve("data/raw/week_results");
const DEFAULT_OUT_DIR_CLEAN = path.resolve("data/clean");
const IS_CI = process.env.CI === "true";

const EVENT_FILTERS_URL =
  "https://www.itftennis.com/tennis/api/TournamentApi/GetEventFilters";

const DRAWSHEET_URL =
  "https://www.itftennis.com/tennis/api/TournamentApi/GetDrawsheet";

const DELAY_BETWEEN_EVENTS_MS = 2000;
const DELAY_BETWEEN_TOURNAMENTS_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 10000;
const BLOCK_DELAY_MS = 15000;
const MAX_RETRIES = 2;
const USE_WEEK_RESULTS_CACHE =
  String(process.env.ITF_USE_WEEK_RESULTS_CACHE || "").toLowerCase() === "true";

function getArg(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function parseArgs(argv = process.argv.slice(2)) {
  return {
    inputDir: cleanText(getArg("input-dir", argv)),
    outputDir: cleanText(getArg("output-dir", argv)),
  };
}

export function resolvePaths(args = parseArgs()) {
  const inputDir = args.inputDir ? path.resolve(args.inputDir) : DEFAULT_INPUT_DIR;

  if (!args.outputDir) {
    return {
      inputDir,
      rawDir: DEFAULT_OUT_DIR_RAW,
      cleanDir: DEFAULT_OUT_DIR_CLEAN,
      tournamentsFile: path.join(inputDir, "week_tournaments.csv"),
      weekMatchesFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_matches.csv"),
      weekPlayerResultsFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_player_results.csv"),
      weekResultsErrorsFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_results_errors.csv"),
      weekResultsSummaryFile: path.join(DEFAULT_OUT_DIR_CLEAN, "week_results_summary.csv"),
    };
  }

  const outputDir = path.resolve(args.outputDir);

  return {
    inputDir,
    rawDir: path.join(outputDir, "raw", "week_results"),
    cleanDir: outputDir,
    tournamentsFile: path.join(inputDir, "week_tournaments.csv"),
    weekMatchesFile: path.join(outputDir, "week_matches.csv"),
    weekPlayerResultsFile: path.join(outputDir, "week_player_results.csv"),
    weekResultsErrorsFile: path.join(outputDir, "week_results_errors.csv"),
    weekResultsSummaryFile: path.join(outputDir, "week_results_summary.csv"),
  };
}

async function ensureDirs(paths) {
  await fs.mkdir(paths.rawDir, { recursive: true });
  await fs.mkdir(paths.cleanDir, { recursive: true });
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

function normalizeUrl(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPlayerName(player) {
  if (!player) return "";

  return [player.givenName, player.familyName]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTeamName(team) {
  if (!team?.players) return "";

  return team.players
    .filter(Boolean)
    .map(getPlayerName)
    .filter(Boolean)
    .join(" / ");
}

function getTeamPlayerIds(team) {
  if (!team?.players) return "";

  return team.players
    .filter(Boolean)
    .map((player) => player.playerId)
    .filter(Boolean)
    .join("|");
}

function getTeamNationalities(team) {
  if (!team?.players) return "";

  return team.players
    .filter(Boolean)
    .map((player) => player.nationality)
    .filter(Boolean)
    .join("|");
}

function formatScore(match) {
  const teams = match.teams || [];
  const teamA = teams[0];
  const teamB = teams[1];

  if (!teamA?.scores || !teamB?.scores) return "";

  const sets = [];

  for (let i = 0; i < Math.max(teamA.scores.length, teamB.scores.length); i++) {
    const a = teamA.scores[i];
    const b = teamB.scores[i];

    if (!a || !b) continue;
    if (a.score === null || a.score === undefined) continue;
    if (b.score === null || b.score === undefined) continue;

    let set = `${a.score}-${b.score}`;

    const tieBreak = a.losingScore ?? b.losingScore;

    if (tieBreak !== null && tieBreak !== undefined) {
      set += `(${tieBreak})`;
    }

    sets.push(set);
  }

  return sets.join(" ");
}

function findWinnerSide(match) {
  const teams = match.teams || [];

  if (teams[0]?.isWinner) return 1;
  if (teams[1]?.isWinner) return 2;

  return "";
}

function getMatchTeamPlayerIdSets(match) {
  const teams = match?.teams || [];

  return [teams[0] || {}, teams[1] || {}].map((team) =>
    new Set(
      String(getTeamPlayerIds(team) || "")
        .split("|")
        .filter(Boolean)
    )
  );
}

function hasAnyPlayerInSet(playerIds, laterPlayerIds) {
  for (const playerId of playerIds) {
    if (laterPlayerIds.has(playerId)) return true;
  }

  return false;
}

function buildLaterRoundPlayerIdsByRound(rounds) {
  const laterByRound = new Map();
  let laterPlayerIds = new Set();

  for (let roundIndex = rounds.length - 1; roundIndex >= 0; roundIndex--) {
    laterByRound.set(roundIndex, laterPlayerIds);

    const currentRoundPlayerIds = new Set();
    const matches = getMatchesFromRound(rounds[roundIndex]);

    for (const match of matches) {
      for (const ids of getMatchTeamPlayerIdSets(match)) {
        for (const playerId of ids) {
          currentRoundPlayerIds.add(playerId);
        }
      }
    }

    laterPlayerIds = new Set([...laterPlayerIds, ...currentRoundPlayerIds]);
  }

  return laterByRound;
}

function inferWinnerSideFromLaterRounds(match, laterRoundPlayerIds) {
  const [team1PlayerIds, team2PlayerIds] = getMatchTeamPlayerIdSets(match);

  if (team1PlayerIds.size === 0 || team2PlayerIds.size === 0) return "";

  const team1Advanced = hasAnyPlayerInSet(team1PlayerIds, laterRoundPlayerIds);
  const team2Advanced = hasAnyPlayerInSet(team2PlayerIds, laterRoundPlayerIds);

  if (team1Advanced && !team2Advanced) return 1;
  if (team2Advanced && !team1Advanced) return 2;

  return "";
}

function getRoundName(round, fallbackIndex) {
  const candidates = [
    round?.roundName,
    round?.name,
    round?.round,
    round?.roundDesc,
    round?.roundDescription,
    round?.roundDisplayName,
    round?.title,
    round?.groupName,
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return cleanText(value);
    }
  }

  return fallbackIndex ? `Round ${fallbackIndex}` : "";
}

function getRoundNumber(round, fallbackIndex) {
  const candidates = [
    round?.roundNumber,
    round?.roundNo,
    round?.roundOrder,
    round?.order,
    fallbackIndex,
  ];

  for (const value of candidates) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return fallbackIndex;
}

function getMatchesFromRound(round) {
  const possibleKeys = ["matches", "Matches", "drawsheetMatches", "items"];

  for (const key of possibleKeys) {
    if (Array.isArray(round?.[key])) {
      return round[key];
    }
  }

  return [];
}

function getRoundRobinMatchesFromGroup(group) {
  const matches = new Map();
  const addMatch = (match) => {
    if (!match || typeof match !== "object") return;

    const key = cleanText(match.matchId) || JSON.stringify(match);
    if (!key || matches.has(key)) return;

    matches.set(key, match);
  };

  for (const match of getMatchesFromRound(group)) {
    addMatch(match);
  }

  for (const team of Array.isArray(group?.teams) ? group.teams : []) {
    for (const match of Array.isArray(team?.matches) ? team.matches : []) {
      addMatch(match);
    }
  }

  return [...matches.values()];
}

function buildRoundRobinParticipationMatches(group) {
  const teams = Array.isArray(group?.teams) ? group.teams : [];

  return teams
    .filter((team) => getTeamPlayerIds(team))
    .map((team, index) => ({
      matchId: `rr-participation-${cleanText(group?.groupName) || "group"}-${index + 1}`,
      playStatusCode: "RR",
      playStatusDesc: "Round-robin",
      teams: [team, {}],
    }));
}

function isRoundRobinMatchComplete(match) {
  const resultStatus = cleanText(match?.resultStatusCode).toUpperCase();

  if (resultStatus === "BYE") return false;

  return Boolean(
    findWinnerSide(match) ||
      cleanText(match?.playStatusCode).toUpperCase() === "PC" ||
      cleanText(match?.playStatusDesc).toLowerCase().includes("completed")
  );
}

function getRoundRobinGroupMetadata(group) {
  const standings = Array.isArray(group?.groupStandings)
    ? group.groupStandings
    : [];
  const teams = Array.isArray(group?.teams) ? group.teams : [];
  const groupSize = Math.max(standings.length, teams.length);
  const uniqueMatches = getRoundRobinMatchesFromGroup(group);
  const expectedMatches = groupSize >= 2 ? (groupSize * (groupSize - 1)) / 2 : 0;
  const completedMatches = uniqueMatches.filter(isRoundRobinMatchComplete).length;
  const groupComplete =
    expectedMatches > 0 && completedMatches >= expectedMatches;
  const byPlayerId = new Map();

  standings.forEach((standing, index) => {
    const playerIds = getTeamPlayerIds(standing)
      .split("|")
      .map(cleanText)
      .filter(Boolean);

    for (const playerId of playerIds) {
      byPlayerId.set(playerId, {
        position: index + 1,
        wins: Number(standing?.matches || 0),
      });
    }
  });

  return {
    groupSize,
    groupComplete,
    byPlayerId,
  };
}

function createMatchRow({
  drawsheet,
  eventInfo,
  tournament,
  group,
  roundName,
  roundOrder,
  match,
  winnerSide,
  structureCode,
  structureDesc,
  roundRobinMetadata,
}) {
  const teams = match.teams || [];
  const team1 = teams[0] || {};
  const team2 = teams[1] || {};
  const team1PlayerId = getTeamPlayerIds(team1).split("|").find(Boolean) || "";
  const team2PlayerId = getTeamPlayerIds(team2).split("|").find(Boolean) || "";
  const team1Standing = roundRobinMetadata?.byPlayerId.get(team1PlayerId);
  const team2Standing = roundRobinMetadata?.byPlayerId.get(team2PlayerId);

  return {
    tournament_key: tournament.tournament_key,
    tournament_name: tournament.tournament_name,
    category: tournament.category,
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    tournament_id: eventInfo.tournamentId,
    event_id: drawsheet?.eventId || "",
    player_type_code: eventInfo.playerTypeCode,
    player_type_desc: eventInfo.playerTypeDesc,
    match_type_code: eventInfo.matchTypeCode,
    match_type_desc: eventInfo.matchTypeDesc,
    event_classification_code: eventInfo.eventClassificationCode,
    event_classification_desc: eventInfo.eventClassificationDesc,
    drawsheet_structure_code: structureCode || eventInfo.drawsheetStructureCode,
    drawsheet_structure_desc: structureDesc || eventInfo.drawsheetStructureDesc,
    group_name: cleanText(group?.groupName),
    rr_group_size: roundRobinMetadata?.groupSize || "",
    rr_group_complete: roundRobinMetadata
      ? String(roundRobinMetadata.groupComplete)
      : "",
    rr_team1_position: team1Standing?.position || "",
    rr_team1_wins: team1Standing?.wins ?? "",
    rr_team2_position: team2Standing?.position || "",
    rr_team2_wins: team2Standing?.wins ?? "",
    round_name: roundName,
    round_order: roundOrder,
    match_id: match.matchId || "",
    play_status_code: cleanText(match.playStatusCode),
    play_status_desc: cleanText(match.playStatusDesc),
    result_status_code: cleanText(match.resultStatusCode),
    result_status_desc: cleanText(match.resultStatusDesc),
    team1_player_ids: getTeamPlayerIds(team1),
    team1_names: getTeamName(team1),
    team1_nationalities: getTeamNationalities(team1),
    team1_seed: cleanText(team1.seeding),
    team1_entry_status: cleanText(team1.entryStatus),
    team2_player_ids: getTeamPlayerIds(team2),
    team2_names: getTeamName(team2),
    team2_nationalities: getTeamNationalities(team2),
    team2_seed: cleanText(team2.seeding),
    team2_entry_status: cleanText(team2.entryStatus),
    winner_side: winnerSide,
    winner_names:
      winnerSide === 1 ? getTeamName(team1) : winnerSide === 2 ? getTeamName(team2) : "",
    score: formatScore(match),
    h2h_link: normalizeUrl(match.h2hLink),
    live_scores_link: normalizeUrl(match.liveScoresLink),
    raw_json: JSON.stringify(match),
    collected_at: new Date().toISOString(),
  };
}

export function extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament) {
  const matches = [];
  const koGroups = Array.isArray(drawsheet?.koGroups) ? drawsheet.koGroups : [];
  const rrGroups = Array.isArray(drawsheet?.rrGroups) ? drawsheet.rrGroups : [];

  for (let groupIndex = 0; groupIndex < koGroups.length; groupIndex++) {
    const group = koGroups[groupIndex];
    const rounds = Array.isArray(group?.rounds) ? group.rounds : [];
    const laterRoundPlayerIdsByRound = buildLaterRoundPlayerIdsByRound(rounds);

    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
      const round = rounds[roundIndex];
      const roundName = getRoundName(round, roundIndex + 1);
      const roundOrder = getRoundNumber(round, roundIndex + 1);
      const roundMatches = getMatchesFromRound(round);

      for (const match of roundMatches) {
        const winnerSide =
          findWinnerSide(match) ||
          inferWinnerSideFromLaterRounds(
            match,
            laterRoundPlayerIdsByRound.get(roundIndex) || new Set()
          );

        matches.push(
          createMatchRow({
            drawsheet,
            eventInfo,
            tournament,
            group,
            roundName,
            roundOrder,
            match,
            winnerSide,
          })
        );
      }
    }
  }

  for (const group of rrGroups) {
    const roundRobinMetadata = getRoundRobinGroupMetadata(group);
    const roundRobinMatches = getRoundRobinMatchesFromGroup(group);
    const participationMatches =
      roundRobinMatches.length > 0 ? roundRobinMatches : buildRoundRobinParticipationMatches(group);

    for (const match of participationMatches) {
      matches.push(
        createMatchRow({
          drawsheet,
          eventInfo,
          tournament,
          group,
          roundName: "Round-robin",
          roundOrder: 1,
          match,
          winnerSide: findWinnerSide(match),
          structureCode: "RR",
          structureDesc: "Round-robin",
          roundRobinMetadata,
        })
      );
    }
  }

  return matches;
}

function flattenEventsFromFilters(filtersJson) {
  const tournamentId = filtersJson.tournamentId;
  const tourType = filtersJson.tourType || "N";
  const weekNumber = filtersJson.weekNumber ?? 0;
  const circuitCode = filtersJson.circuitCode || "JT";
  const events = [];
  const playerTypeFilters = filtersJson.filters || [];

  for (const playerType of playerTypeFilters) {
    const playerTypeCode = playerType.valueCode;
    const playerTypeDesc = playerType.valueDesc;

    for (const matchType of playerType.subFilter || []) {
      const matchTypeCode = matchType.valueCode;
      const matchTypeDesc = matchType.valueDesc;

      for (const eventClassification of matchType.subFilter || []) {
        const eventClassificationCode = eventClassification.valueCode;
        const eventClassificationDesc = eventClassification.valueDesc;

        for (const drawsheetStructure of eventClassification.subFilter || []) {
          const drawsheetStructureCode = drawsheetStructure.valueCode;
          const drawsheetStructureDesc = drawsheetStructure.valueDesc;

          events.push({
            tournamentId,
            tourType,
            weekNumber,
            circuitCode,
            playerTypeCode,
            playerTypeDesc,
            matchTypeCode,
            matchTypeDesc,
            eventClassificationCode,
            eventClassificationDesc,
            drawsheetStructureCode,
            drawsheetStructureDesc,
          });
        }
      }
    }
  }

  return events;
}

function buildEventFiltersUrl(tournamentKey) {
  const params = new URLSearchParams({
    tournamentKey: String(tournamentKey).toLowerCase(),
  });

  return `${EVENT_FILTERS_URL}?${params.toString()}`;
}

function buildDrawsheetUrl(eventInfo) {
  const params = new URLSearchParams({
    drawsheetStructureCode: String(eventInfo.drawsheetStructureCode || ""),
    eventClassificationCode: String(eventInfo.eventClassificationCode || ""),
    matchTypeCode: String(eventInfo.matchTypeCode || ""),
    playerTypeCode: String(eventInfo.playerTypeCode || ""),
    tourType: String(eventInfo.tourType || "N"),
    tournamentId: String(Number(eventInfo.tournamentId)),
    weekNumber: String(Number(eventInfo.weekNumber ?? 0)),
  });

  return `${DRAWSHEET_URL}?${params.toString()}`;
}

function looksBlockedOrHtml(result) {
  const contentType = String(result?.contentType || "").toLowerCase();
  const textStart = String(result?.textStart || "").toLowerCase();

  if (contentType.includes("text/html")) return true;
  if (textStart.includes("_incapsula_resource")) return true;
  if (textStart.includes("incapsula")) return true;
  if (textStart.includes("imperva")) return true;
  if (textStart.includes("<html")) return true;

  return false;
}

async function fetchJsonInsideBrowser(page, url, options = {}) {
  return await page.evaluate(
    async ({ url: requestUrl, options: requestOptions, timeoutMs }) => {
      const headers = {
        accept: "application/json, text/plain, */*",
      };

      if (requestOptions.body) {
        headers["content-type"] = "application/json";
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(requestUrl, {
          method: requestOptions.method || "GET",
          credentials: "include",
          headers,
          body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
          signal: controller.signal,
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
            timedOut: false,
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          contentType,
          textStart: "",
          json,
          timedOut: false,
        };
      } catch (err) {
        const timedOut = err?.name === "AbortError";

        return {
          ok: false,
          status: 0,
          contentType: "",
          textStart: timedOut
            ? `Request timeout after ${timeoutMs}ms`
            : String(err?.message || err),
          json: null,
          timedOut,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { url, options, timeoutMs: REQUEST_TIMEOUT_MS }
  );
}

async function fetchJsonWithRetry(page, url, options = {}, label = "request") {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Tentativa ${attempt}/${MAX_RETRIES}: ${label}`);

      const result = await fetchJsonInsideBrowser(page, url, options);

      if (result.ok && result.json) {
        return result;
      }

      const errorPrefix = result.timedOut ? "Request timeout" : `HTTP ${result.status}`;
      const error = new Error(
        `${errorPrefix}. Content-Type: ${result.contentType}. Text: ${result.textStart}`
      );

      error.isBlocked = !result.timedOut && looksBlockedOrHtml(result);
      error.timedOut = result.timedOut;
      throw error;
    } catch (err) {
      lastError = err;

      if (attempt >= MAX_RETRIES) {
        throw lastError;
      }

      if (err.isBlocked) {
        console.log(
          `Possivel bloqueio/HTML detectado. Esperando ${BLOCK_DELAY_MS / 1000}s...`
        );
        await sleep(BLOCK_DELAY_MS);
      } else {
        console.log(`Erro temporario. Esperando ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

async function fetchEventFilters(page, tournament) {
  const url = buildEventFiltersUrl(tournament.tournament_key);

  console.log("");
  console.log("Buscando filtros/eventos:");
  console.log(url);

  const result = await fetchJsonWithRetry(
    page,
    url,
    {},
    `GetEventFilters ${tournament.tournament_key}`
  );

  return {
    url,
    json: result.json,
    events: flattenEventsFromFilters(result.json),
  };
}

function hasDrawsheetContent(json) {
  if (!json) return false;

  if (Array.isArray(json.koGroups) && json.koGroups.length > 0) return true;
  if (Array.isArray(json.rrGroups) && json.rrGroups.length > 0) return true;
  if (json.eventId) return true;

  return false;
}

async function fetchDrawsheet(page, eventInfo) {
  console.log("");
  console.log(
    `Buscando chave: ${eventInfo.playerTypeDesc} ${eventInfo.matchTypeDesc} ${eventInfo.eventClassificationDesc}`
  );

  const url = buildDrawsheetUrl(eventInfo);
  const result = await fetchJsonWithRetry(
    page,
    url,
    {
      method: "GET",
    },
    `GetDrawsheet ${eventInfo.playerTypeDesc} ${eventInfo.matchTypeDesc} ${eventInfo.eventClassificationDesc}`
  );

  if (result.json && hasDrawsheetContent(result.json)) {
    return {
      method_used: "GET",
      url,
      body: null,
      json: result.json,
    };
  }

  throw new Error("GetDrawsheet retornou JSON, mas sem conteudo de chave.");
}

function splitTeamPlayers(matchRow, side) {
  const ids = side === 1 ? matchRow.team1_player_ids : matchRow.team2_player_ids;
  const names = side === 1 ? matchRow.team1_names : matchRow.team2_names;
  const nats = side === 1 ? matchRow.team1_nationalities : matchRow.team2_nationalities;

  const idList = String(ids || "").split("|").filter(Boolean);
  const nameList = String(names || "").split(" / ").filter(Boolean);
  const natList = String(nats || "").split("|").filter(Boolean);

  return idList.map((playerId, index) => ({
    player_id: playerId,
    player_name: nameList[index] || "",
    nationality: natList[index] || "",
  }));
}

function isCompletedMatch(match) {
  return (
    match.play_status_code === "PC" ||
    String(match.play_status_desc || "").toLowerCase().includes("completed")
  );
}

function getMatchEventKey(match) {
  return [
    match.tournament_key,
    match.player_type_code,
    match.match_type_code,
    match.event_classification_code,
  ].join("|");
}

function isRoundRobinMatch(match) {
  const structureCode = cleanText(match.drawsheet_structure_code).toUpperCase();
  const text = [
    match.drawsheet_structure_desc,
    match.round_name,
    match.group_name,
    match.play_status_desc,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();

  return (
    structureCode === "RR" ||
    text.includes("round-robin") ||
    text.includes("round robin")
  );
}

export function buildPlayerResultsFromMatches(matches) {
  const map = new Map();
  const maxRoundOrderByEvent = new Map();
  const completedFinalEvents = new Set();

  for (const match of matches) {
    if (isRoundRobinMatch(match)) continue;

    const eventKey = getMatchEventKey(match);
    const roundOrder = Number(match.round_order || 0);

    if (!eventKey || !roundOrder) continue;

    maxRoundOrderByEvent.set(
      eventKey,
      Math.max(maxRoundOrderByEvent.get(eventKey) || 0, roundOrder)
    );
  }

  for (const match of matches) {
    if (isRoundRobinMatch(match)) continue;

    const eventKey = getMatchEventKey(match);
    const roundOrder = Number(match.round_order || 0);
    const maxRoundOrder = maxRoundOrderByEvent.get(eventKey) || 0;

    if (roundOrder && maxRoundOrder && roundOrder === maxRoundOrder && isCompletedMatch(match)) {
      completedFinalEvents.add(eventKey);
    }
  }

  for (const match of matches) {
    const eventKey = getMatchEventKey(match);
    const eventHasCompletedFinal = completedFinalEvents.has(eventKey);
    const roundRobinMatch = isRoundRobinMatch(match);
    const team1Players = splitTeamPlayers(match, 1);
    const team2Players = splitTeamPlayers(match, 2);
    const allSides = [
      { side: 1, players: team1Players },
      { side: 2, players: team2Players },
    ];

    for (const sideInfo of allSides) {
      for (const player of sideInfo.players) {
        if (!player.player_id) continue;

        const key = [
          match.tournament_key,
          match.player_type_code,
          match.match_type_code,
          match.event_classification_code,
          player.player_id,
        ].join("|");

        const won = Number(match.winner_side) === sideInfo.side;
        const completed = isCompletedMatch(match);

        if (!map.has(key)) {
          map.set(key, {
            tournament_key: match.tournament_key,
            tournament_name: match.tournament_name,
            category: match.category,
            start_date: match.start_date,
            end_date: match.end_date,
            player_id: player.player_id,
            player_name: player.player_name,
            nationality: player.nationality,
            player_type_code: match.player_type_code,
            player_type_desc: match.player_type_desc,
            match_type_code: match.match_type_code,
            match_type_desc: match.match_type_desc,
            event_classification_code: match.event_classification_code,
            event_classification_desc: match.event_classification_desc,
            matches_played: 0,
            wins: 0,
            losses: 0,
            highest_round_order: 0,
            highest_round_name: "",
            last_match_id: "",
            last_match_status: "",
            status: "unknown",
            round_robin_position: "",
            round_robin_group_size: "",
            round_robin_group_complete: "false",
            round_robin_matches_played: 0,
            round_robin_wins: 0,
            round_robin_losses: 0,
            elimination_matches_seen: 0,
            live_points: "",
            collected_at: new Date().toISOString(),
          });
        }

        const row = map.get(key);

        if (roundRobinMatch) {
          const resultStatus = cleanText(match.result_status_code).toUpperCase();
          const roundRobinCompleted =
            completed || Boolean(match.winner_side);
          const position =
            sideInfo.side === 1
              ? match.rr_team1_position
              : match.rr_team2_position;
          const standingWins =
            sideInfo.side === 1 ? match.rr_team1_wins : match.rr_team2_wins;

          row.round_robin_position = position || row.round_robin_position;
          row.round_robin_group_size =
            match.rr_group_size || row.round_robin_group_size;
          row.round_robin_group_complete =
            cleanText(match.rr_group_complete).toLowerCase() === "true"
              ? "true"
              : row.round_robin_group_complete;

          if (roundRobinCompleted && resultStatus !== "BYE") {
            row.round_robin_matches_played += 1;
            if (won) {
              row.round_robin_wins += 1;
            } else if (match.winner_side) {
              row.round_robin_losses += 1;
            }
          }

          if (standingWins !== "" && standingWins !== undefined) {
            row.round_robin_wins = Number(standingWins);
          }

          if (Number(match.round_order || 0) >= Number(row.highest_round_order || 0)) {
            row.highest_round_order = match.round_order || 1;
            if (!row.elimination_matches_seen) {
              row.highest_round_name = "Round-robin";
            }
            row.last_match_id = match.match_id;
            row.last_match_status = match.play_status_desc;
            if (!row.elimination_matches_seen) {
              row.status = "round_robin";
            }
          }

          continue;
        }

        row.elimination_matches_seen += 1;
        if (row.status === "round_robin") {
          row.status = "unknown";
        }

        if (completed) {
          row.matches_played += 1;

          if (won) {
            row.wins += 1;
          } else if (match.winner_side) {
            row.losses += 1;
          }
        }

        if (
          (completed || !eventHasCompletedFinal) &&
          Number(match.round_order) >= Number(row.highest_round_order || 0)
        ) {
          row.highest_round_order = match.round_order;
          row.highest_round_name = match.round_name;
          row.last_match_id = match.match_id;
          row.last_match_status = match.play_status_desc;
        }
      }
    }
  }

  for (const row of map.values()) {
    if (
      row.status === "round_robin" &&
      !row.elimination_matches_seen &&
      cleanText(row.highest_round_name) === "Round-robin"
    ) {
      continue;
    }

    const eventKey = getMatchEventKey(row);
    const eventHasCompletedFinal = completedFinalEvents.has(eventKey);
    const maxRoundOrder = maxRoundOrderByEvent.get(eventKey) || 0;

    if (row.losses > 0) {
      row.status = "eliminated";
    } else if (
      eventHasCompletedFinal &&
      maxRoundOrder &&
      Number(row.highest_round_order || 0) < maxRoundOrder
    ) {
      row.status = "eliminated";
    } else if (
      eventHasCompletedFinal &&
      maxRoundOrder &&
      Number(row.highest_round_order || 0) === maxRoundOrder
    ) {
      row.status = "champion";
    } else if (row.wins > 0) {
      row.status = "still_alive_or_champion";
    } else {
      row.status = "not_started_or_unknown";
    }
  }

  return [...map.values()].sort((a, b) => {
    const tournamentCompare = String(a.tournament_name).localeCompare(String(b.tournament_name));
    if (tournamentCompare !== 0) return tournamentCompare;

    const eventCompare = String(a.match_type_code).localeCompare(String(b.match_type_code));
    if (eventCompare !== 0) return eventCompare;

    return String(a.player_name).localeCompare(String(b.player_name));
  });
}

function getRawFilePath(tournament, paths) {
  const safeKey = tournament.tournament_key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(paths.rawDir, `${safeKey}_draws.json`);
}

async function readCachedTournament(tournament, paths) {
  const rawFile = getRawFilePath(tournament, paths);

  try {
    const text = await fs.readFile(rawFile, "utf8");
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.raw_draws) && parsed.raw_draws.length > 0) {
      const matches = [];

      for (const rawDraw of parsed.raw_draws) {
        const eventInfo = rawDraw.eventInfo;
        const drawsheetJson = rawDraw.json;

        matches.push(...extractMatchesFromDrawsheet(drawsheetJson, eventInfo, tournament));
      }

      return {
        matches,
        errors: [],
        summary: {
          tournament_key: tournament.tournament_key,
          tournament_name: tournament.tournament_name,
          category: tournament.category,
          events_found: parsed.raw_draws.length,
          matches_found: matches.length,
          errors_found: 0,
          raw_file: rawFile,
          from_cache: "true",
          collected_at: new Date().toISOString(),
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function processTournament(page, tournament, paths) {
  console.log("");
  console.log("========================================");
  console.log(
    `Torneio: ${tournament.tournament_name} | ${tournament.category} | ${tournament.tournament_key}`
  );
  console.log("========================================");

  if (USE_WEEK_RESULTS_CACHE) {
    const cached = await readCachedTournament(tournament, paths);

    if (cached) {
      console.log(`Usando cache: ${cached.matches.length} partidas`);
      return cached;
    }
  } else {
    console.log("Cache ignorado: relendo resultados da semana.");
  }

  const allMatches = [];
  const errors = [];
  const rawDraws = [];

  try {
    await page.goto(tournament.tournament_link, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(2500);

    const filters = await fetchEventFilters(page, tournament);

    console.log(`Eventos encontrados: ${filters.events.length}`);

    for (const eventInfo of filters.events) {
      try {
        const drawsheet = await fetchDrawsheet(page, eventInfo);
        const matches = extractMatchesFromDrawsheet(drawsheet.json, eventInfo, tournament);

        console.log(`Partidas extraidas: ${matches.length}`);

        allMatches.push(...matches);

        rawDraws.push({
          eventInfo,
          method_used: drawsheet.method_used,
          url: drawsheet.url,
          body: drawsheet.body || null,
          matches_count: matches.length,
          json: drawsheet.json,
        });

        await sleep(DELAY_BETWEEN_EVENTS_MS);
      } catch (err) {
        console.log(`ERRO evento: ${err.message}`);

        errors.push({
          tournament_key: tournament.tournament_key,
          tournament_name: tournament.tournament_name,
          category: tournament.category,
          player_type_code: eventInfo.playerTypeCode,
          player_type_desc: eventInfo.playerTypeDesc,
          match_type_code: eventInfo.matchTypeCode,
          match_type_desc: eventInfo.matchTypeDesc,
          event_classification_code: eventInfo.eventClassificationCode,
          event_classification_desc: eventInfo.eventClassificationDesc,
          drawsheet_structure_code: eventInfo.drawsheetStructureCode,
          error_message: err.message,
          collected_at: new Date().toISOString(),
        });
      }
    }

    await fs.writeFile(
      getRawFilePath(tournament, paths),
      JSON.stringify(
        {
          tournament,
          filters_url: filters.url,
          filters_json: filters.json,
          raw_draws: rawDraws,
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      matches: allMatches,
      errors,
      summary: {
        tournament_key: tournament.tournament_key,
        tournament_name: tournament.tournament_name,
        category: tournament.category,
        events_found: filters.events.length,
        matches_found: allMatches.length,
        errors_found: errors.length,
        raw_file: getRawFilePath(tournament, paths),
        from_cache: "false",
        collected_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.log(`ERRO torneio: ${err.message}`);

    errors.push({
      tournament_key: tournament.tournament_key,
      tournament_name: tournament.tournament_name,
      category: tournament.category,
      player_type_code: "",
      player_type_desc: "",
      match_type_code: "",
      match_type_desc: "",
      event_classification_code: "",
      event_classification_desc: "",
      drawsheet_structure_code: "",
      error_message: err.message,
      collected_at: new Date().toISOString(),
    });

    return {
      matches: [],
      errors,
      summary: {
        tournament_key: tournament.tournament_key,
        tournament_name: tournament.tournament_name,
        category: tournament.category,
        events_found: 0,
        matches_found: 0,
        errors_found: errors.length,
        raw_file: "",
        from_cache: "false",
        collected_at: new Date().toISOString(),
      },
    };
  }
}

export async function main(cliArgs = parseArgs()) {
  const paths = resolvePaths(cliArgs);

  await ensureDirs(paths);

  const tournaments = await readCsv(paths.tournamentsFile);

  console.log("");
  console.log(`Torneios da semana carregados: ${tournaments.length}`);
  console.log(`Pausa entre eventos: ${DELAY_BETWEEN_EVENTS_MS / 1000}s`);
  console.log(`Pausa entre torneios: ${DELAY_BETWEEN_TOURNAMENTS_MS / 1000}s`);
  console.log(`Tentativas por request: ${MAX_RETRIES}`);

  const browser = await chromium.launch({
    headless: IS_CI ? true : false,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1500,
      height: 950,
    },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });

  const page = await context.newPage();

  const allMatches = [];
  const allErrors = [];
  const summaries = [];

  try {
    for (let i = 0; i < tournaments.length; i++) {
      const tournament = tournaments[i];

      console.log("");
      console.log(`[${i + 1}/${tournaments.length}]`);

      const result = await processTournament(page, tournament, paths);

      allMatches.push(...result.matches);
      allErrors.push(...result.errors);
      summaries.push(result.summary);

      await sleep(DELAY_BETWEEN_TOURNAMENTS_MS);
    }

    const playerResults = buildPlayerResultsFromMatches(allMatches);

    await writeCsv(paths.weekMatchesFile, allMatches, [
      "tournament_key",
      "tournament_name",
      "category",
      "start_date",
      "end_date",
      "tournament_id",
      "event_id",
      "player_type_code",
      "player_type_desc",
      "match_type_code",
      "match_type_desc",
      "event_classification_code",
      "event_classification_desc",
      "drawsheet_structure_code",
      "drawsheet_structure_desc",
      "group_name",
      "rr_group_size",
      "rr_group_complete",
      "rr_team1_position",
      "rr_team1_wins",
      "rr_team2_position",
      "rr_team2_wins",
      "round_name",
      "round_order",
      "match_id",
      "play_status_code",
      "play_status_desc",
      "result_status_code",
      "result_status_desc",
      "team1_player_ids",
      "team1_names",
      "team1_nationalities",
      "team1_seed",
      "team1_entry_status",
      "team2_player_ids",
      "team2_names",
      "team2_nationalities",
      "team2_seed",
      "team2_entry_status",
      "winner_side",
      "winner_names",
      "score",
      "h2h_link",
      "live_scores_link",
      "raw_json",
      "collected_at",
    ]);

    await writeCsv(paths.weekPlayerResultsFile, playerResults, [
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
      "match_type_code",
      "match_type_desc",
      "event_classification_code",
      "event_classification_desc",
      "matches_played",
      "wins",
      "losses",
      "round_robin_position",
      "round_robin_group_size",
      "round_robin_group_complete",
      "round_robin_matches_played",
      "round_robin_wins",
      "round_robin_losses",
      "elimination_matches_seen",
      "highest_round_order",
      "highest_round_name",
      "last_match_id",
      "last_match_status",
      "status",
      "live_points",
      "collected_at",
    ]);

    await writeCsv(paths.weekResultsErrorsFile, allErrors, [
      "tournament_key",
      "tournament_name",
      "category",
      "player_type_code",
      "player_type_desc",
      "match_type_code",
      "match_type_desc",
      "event_classification_code",
      "event_classification_desc",
      "drawsheet_structure_code",
      "error_message",
      "collected_at",
    ]);

    await writeCsv(paths.weekResultsSummaryFile, summaries, [
      "tournament_key",
      "tournament_name",
      "category",
      "events_found",
      "matches_found",
      "errors_found",
      "raw_file",
      "from_cache",
      "collected_at",
    ]);

    console.log("");
    console.log("Finalizado.");
    console.log(`Torneios processados: ${tournaments.length}`);
    console.log(`Partidas extraidas: ${allMatches.length}`);
    console.log(`Resultados por jogador: ${playerResults.length}`);
    console.log(`Erros: ${allErrors.length}`);
    console.log("");
    console.log("Arquivos gerados:");
    console.log(paths.weekMatchesFile);
    console.log(paths.weekPlayerResultsFile);
    console.log(paths.weekResultsErrorsFile);
    console.log(paths.weekResultsSummaryFile);
    console.log(paths.rawDir);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("");
    console.error("Erro fatal:");
    console.error(err);
    process.exit(1);
  });
}
