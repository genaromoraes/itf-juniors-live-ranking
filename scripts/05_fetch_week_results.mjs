import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");

const OUT_DIR_RAW = path.resolve("data/raw/week_results");
const OUT_DIR_CLEAN = path.resolve("data/clean");

const WEEK_MATCHES_FILE = path.join(OUT_DIR_CLEAN, "week_matches.csv");
const WEEK_PLAYER_RESULTS_FILE = path.join(
  OUT_DIR_CLEAN,
  "week_player_results.csv"
);
const WEEK_RESULTS_ERRORS_FILE = path.join(
  OUT_DIR_CLEAN,
  "week_results_errors.csv"
);

// Por enquanto vamos testar só Roland Garros Junior.
// Depois que estiver 100%, a gente muda para rodar todos os torneios da semana.
const TARGET_TOURNAMENT_KEY = "J-JGS-FRA-2026-001";

const EVENT_FILTERS_URL =
  "https://www.itftennis.com/tennis/api/TournamentApi/GetEventFilters";

const DRAWSHEET_URL =
  "https://www.itftennis.com/tennis/api/TournamentApi/GetDrawsheet";

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_RAW, { recursive: true });
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

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;

  return raw;
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
    .map((p) => p.playerId)
    .filter(Boolean)
    .join("|");
}

function getTeamNationalities(team) {
  if (!team?.players) return "";

  return team.players
    .filter(Boolean)
    .map((p) => p.nationality)
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

function extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament) {
  const matches = [];

  const koGroups = Array.isArray(drawsheet?.koGroups) ? drawsheet.koGroups : [];

  for (let groupIndex = 0; groupIndex < koGroups.length; groupIndex++) {
    const group = koGroups[groupIndex];
    const rounds = Array.isArray(group?.rounds) ? group.rounds : [];

    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
      const round = rounds[roundIndex];
      const roundName = getRoundName(round, roundIndex + 1);
      const roundOrder = getRoundNumber(round, roundIndex + 1);
      const roundMatches = getMatchesFromRound(round);

      for (const match of roundMatches) {
        const teams = match.teams || [];
        const team1 = teams[0] || {};
        const team2 = teams[1] || {};

        const winnerSide = findWinnerSide(match);

        matches.push({
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
          drawsheet_structure_code: eventInfo.drawsheetStructureCode,
          drawsheet_structure_desc: eventInfo.drawsheetStructureDesc,

          group_name: cleanText(group?.groupName),
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
            winnerSide === 1
              ? getTeamName(team1)
              : winnerSide === 2
                ? getTeamName(team2)
                : "",

          score: formatScore(match),
          h2h_link: normalizeUrl(match.h2hLink),
          live_scores_link: normalizeUrl(match.liveScoresLink),

          raw_json: JSON.stringify(match),
          collected_at: new Date().toISOString(),
        });
      }
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

async function fetchJsonInsideBrowser(page, url, options = {}) {
  return await page.evaluate(
    async ({ url, options }) => {
      const headers = {
        accept: "application/json, text/plain, */*",
      };

      if (options.body) {
        headers["content-type"] = "application/json";
      }

      const response = await fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
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
        };
      }

      return {
        ok: response.ok,
        status: response.status,
        contentType,
        textStart: "",
        json,
      };
    },
    { url, options }
  );
}

async function fetchEventFilters(page, tournament) {
  const url = buildEventFiltersUrl(tournament.tournament_key);

  console.log("");
  console.log("Buscando filtros/eventos:");
  console.log(url);

  const result = await fetchJsonInsideBrowser(page, url);

  if (!result.ok || !result.json) {
    throw new Error(
      `Erro GetEventFilters HTTP ${result.status}. ${result.contentType}. ${result.textStart}`
    );
  }

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

  const body = {
    tournamentId: Number(eventInfo.tournamentId),
    tourType: eventInfo.tourType || "N",
    weekNumber: Number(eventInfo.weekNumber ?? 0),
    playerTypeCode: eventInfo.playerTypeCode,
    matchTypeCode: eventInfo.matchTypeCode,
    eventClassificationCode: eventInfo.eventClassificationCode,
    drawsheetStructureCode: eventInfo.drawsheetStructureCode,
  };

  const result = await fetchJsonInsideBrowser(page, DRAWSHEET_URL, {
    method: "POST",
    body,
  });

  if (result.ok && result.json && hasDrawsheetContent(result.json)) {
    return {
      method_used: "POST",
      url: DRAWSHEET_URL,
      body,
      json: result.json,
    };
  }

  throw new Error(
    `Não consegui GetDrawsheet. POST status ${result.status}. Content-Type ${result.contentType}. Text: ${result.textStart}`
  );
}

function splitTeamPlayers(matchRow, side) {
  const ids =
    side === 1 ? matchRow.team1_player_ids : matchRow.team2_player_ids;
  const names = side === 1 ? matchRow.team1_names : matchRow.team2_names;
  const nats =
    side === 1 ? matchRow.team1_nationalities : matchRow.team2_nationalities;

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

function buildPlayerResultsFromMatches(matches) {
  const map = new Map();

  for (const match of matches) {
    const team1Players = splitTeamPlayers(match, 1);
    const team2Players = splitTeamPlayers(match, 2);

    const allSides = [
      {
        side: 1,
        players: team1Players,
      },
      {
        side: 2,
        players: team2Players,
      },
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
            live_points: "",
            collected_at: new Date().toISOString(),
          });
        }

        const row = map.get(key);

        if (completed) {
          row.matches_played += 1;

          if (won) {
            row.wins += 1;
          } else if (match.winner_side) {
            row.losses += 1;
          }
        }

        if (Number(match.round_order) >= Number(row.highest_round_order || 0)) {
          row.highest_round_order = match.round_order;
          row.highest_round_name = match.round_name;
          row.last_match_id = match.match_id;
          row.last_match_status = match.play_status_desc;
        }
      }
    }
  }

  for (const row of map.values()) {
    if (row.losses > 0) {
      row.status = "eliminated";
    } else if (row.wins > 0) {
      row.status = "still_alive_or_champion";
    } else {
      row.status = "not_started_or_unknown";
    }
  }

  return [...map.values()].sort((a, b) => {
    const eventCompare = String(a.match_type_code).localeCompare(
      String(b.match_type_code)
    );
    if (eventCompare !== 0) return eventCompare;

    return String(a.player_name).localeCompare(String(b.player_name));
  });
}

async function main() {
  await ensureDirs();

  const tournaments = await readCsv(WEEK_TOURNAMENTS_FILE);

  const tournament = tournaments.find(
    (t) => t.tournament_key === TARGET_TOURNAMENT_KEY
  );

  if (!tournament) {
    throw new Error(
      `Não encontrei ${TARGET_TOURNAMENT_KEY} em data/clean/week_tournaments.csv`
    );
  }

  console.log("");
  console.log("Torneio alvo:");
  console.log(
    `${tournament.tournament_name} | ${tournament.category} | ${tournament.tournament_key}`
  );

  const browser = await chromium.launch({
    headless: false,
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
  const errors = [];
  const rawDraws = [];

  try {
    await page.goto(tournament.tournament_link, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(3000);

    const filters = await fetchEventFilters(page, tournament);

    console.log("");
    console.log(`Eventos encontrados: ${filters.events.length}`);

    for (const eventInfo of filters.events) {
      try {
        const drawsheet = await fetchDrawsheet(page, eventInfo);

        const matches = extractMatchesFromDrawsheet(
          drawsheet.json,
          eventInfo,
          tournament
        );

        console.log(`Partidas extraídas: ${matches.length}`);

        allMatches.push(...matches);

        rawDraws.push({
          eventInfo,
          method_used: drawsheet.method_used,
          url: drawsheet.url,
          body: drawsheet.body || null,
          matches_count: matches.length,
          json: drawsheet.json,
        });

        await page.waitForTimeout(700);
      } catch (err) {
        console.log(`ERRO evento: ${err.message}`);

        errors.push({
          tournament_key: tournament.tournament_key,
          tournament_name: tournament.tournament_name,
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

    const playerResults = buildPlayerResultsFromMatches(allMatches);

    const safeKey = tournament.tournament_key.replace(/[^a-zA-Z0-9_-]/g, "_");

    await fs.writeFile(
      path.join(OUT_DIR_RAW, `${safeKey}_draws.json`),
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

    await writeCsv(WEEK_MATCHES_FILE, allMatches, [
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

    await writeCsv(WEEK_PLAYER_RESULTS_FILE, playerResults, [
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
      "highest_round_order",
      "highest_round_name",
      "last_match_id",
      "last_match_status",
      "status",
      "live_points",
      "collected_at",
    ]);

    await writeCsv(WEEK_RESULTS_ERRORS_FILE, errors, [
      "tournament_key",
      "tournament_name",
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

    console.log("");
    console.log("Finalizado.");
    console.log(`Partidas extraídas: ${allMatches.length}`);
    console.log(`Resultados por jogador: ${playerResults.length}`);
    console.log(`Erros: ${errors.length}`);
    console.log("");
    console.log("Arquivos gerados:");
    console.log("data/clean/week_matches.csv");
    console.log("data/clean/week_player_results.csv");
    console.log("data/clean/week_results_errors.csv");
    console.log(`data/raw/week_results/${safeKey}_draws.json`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});