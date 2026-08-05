import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { summarizeWeekCompletion } from "./lib/week_completion.mjs";

const CLEAN_DIR = path.resolve("data/clean");
const PREVIOUS_WEEK_MATCHES_FILE = path.resolve(
  process.env.PREVIOUS_WEEK_MATCHES_FILE ||
    ".last-valid-data/data/clean/week_matches.csv"
);
const PREVIOUS_WEEK_TOURNAMENTS_FILE = path.resolve(
  process.env.PREVIOUS_WEEK_TOURNAMENTS_FILE ||
    ".last-valid-data/data/clean/week_tournaments.csv"
);

async function readCsvIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parse(text, {
      columns: true,
      skip_empty_lines: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekEnd(tournaments) {
  return tournaments
    .map((row) => cleanText(row.end_date))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function getWeekStart(tournaments) {
  return tournaments
    .map((row) => cleanText(row.week_start))
    .filter(Boolean)
    .sort()
    .at(0) || "";
}

function escapeMarkdownCell(value) {
  return cleanText(value).replaceAll("|", "\\|") || "-";
}

function hasWinner(matchRow) {
  return Boolean(cleanText(matchRow.winner_side) || cleanText(matchRow.winner_names));
}

function isTerminalSpecialResult(matchRow) {
  const haystack = [
    normalizeText(matchRow.play_status_code),
    normalizeText(matchRow.play_status_desc),
    normalizeText(matchRow.result_status_code),
    normalizeText(matchRow.result_status_desc),
    normalizeText(matchRow.score),
  ].join(" ");

  return (
    haystack.includes("BYE") ||
    haystack.includes("W O") ||
    haystack.includes("WALKOVER") ||
    haystack.includes("RET") ||
    haystack.includes("RETIRED") ||
    haystack.includes("DEFAULT") ||
    haystack.includes("CANCELLED")
  );
}

function isMatchComplete(matchRow) {
  return hasWinner(matchRow) || isTerminalSpecialResult(matchRow);
}

export function isActualMatchResult(matchRow) {
  const resultStatus = normalizeText(matchRow.result_status_code);
  const resultDescription = normalizeText(matchRow.result_status_desc);
  const playStatus = normalizeText(matchRow.play_status_code);
  const playDescription = normalizeText(matchRow.play_status_desc);
  const score = normalizeText(matchRow.score);
  const haystack = [
    resultStatus,
    resultDescription,
    playStatus,
    playDescription,
    score,
  ].join(" ");

  if (haystack.includes("BYE") || haystack.includes("CANCELLED")) return false;
  if (hasWinner(matchRow)) return true;

  return (
    haystack.includes("W O") ||
    haystack.includes("WALKOVER") ||
    haystack.includes("RET") ||
    haystack.includes("RETIRED") ||
    haystack.includes("DEFAULT")
  );
}

function getMatchIdentity(row) {
  const matchId = cleanText(row.match_id);
  if (matchId) return `id:${matchId}`;

  return [
    cleanText(row.tournament_key),
    cleanText(row.event_id),
    cleanText(row.player_type_code),
    cleanText(row.match_type_code),
    cleanText(row.event_classification_code),
    cleanText(row.group_name),
    cleanText(row.round_order || row.round_name),
    cleanText(row.team1_player_ids || row.team1_names),
    cleanText(row.team2_player_ids || row.team2_names),
  ].join("|");
}

export function countNewMatchResults(currentRows, previousRows) {
  const previousResultKeys = new Set(
    previousRows
      .filter(isActualMatchResult)
      .map(getMatchIdentity)
      .filter(Boolean)
  );

  return currentRows.filter((row) => {
    if (!isActualMatchResult(row)) return false;
    const key = getMatchIdentity(row);
    return key && !previousResultKeys.has(key);
  }).length;
}

function isFinalRound(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (
    text.includes("SEMIFINAL") ||
    text.includes("SEMI FINAL") ||
    text.includes("QUARTERFINAL") ||
    text.includes("QUARTER FINAL") ||
    text.includes("PLAYOFF")
  ) {
    return false;
  }
  return text === "F" || text === "FINAL" || text === "FINALS" || text === "FINAL ROUND";
}

function splitTeamTokens(value) {
  return cleanText(value)
    .split("|")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function getSideTokens(matchRow, side) {
  const idTokens = splitTeamTokens(matchRow[`team${side}_player_ids`]);
  if (idTokens.length > 0) return idTokens;

  return cleanText(matchRow[`team${side}_names`])
    .split("/")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function hasAnyTokenInSet(tokens, tokenSet) {
  return tokens.some((token) => tokenSet.has(token));
}

function collectLaterRoundTokens(rows, roundOrder) {
  const laterTokens = new Set();
  for (const row of rows) {
    if (toNumber(row.round_order) <= roundOrder) continue;
    for (const token of getSideTokens(row, 1)) laterTokens.add(token);
    for (const token of getSideTokens(row, 2)) laterTokens.add(token);
  }
  return laterTokens;
}

function hasCompletedFinal(rows) {
  return rows.some((row) => isFinalRound(row.round_name) && isMatchComplete(row));
}

function isFuturePendingMatch(matchRow) {
  const haystack = [
    normalizeText(matchRow.play_status_code),
    normalizeText(matchRow.play_status_desc),
    normalizeText(matchRow.result_status_code),
    normalizeText(matchRow.result_status_desc),
  ].join(" ");

  return (
    haystack.includes("TO BE PLAYED") ||
    haystack.includes("SCHEDULED") ||
    haystack.includes("NOT PLAYED") ||
    haystack.includes("NOT STARTED") ||
    normalizeText(matchRow.play_status_code) === "TP" ||
    normalizeText(matchRow.play_status_code) === "NP"
  ) && !isTerminalSpecialResult(matchRow);
}

function isPendingMatchResolvedByLaterDraw(matchRow, rows) {
  if (!hasCompletedFinal(rows) || !isFuturePendingMatch(matchRow) || isFinalRound(matchRow.round_name)) {
    return false;
  }

  const roundOrder = toNumber(matchRow.round_order);
  if (!roundOrder) return false;

  const team1Tokens = getSideTokens(matchRow, 1);
  const team2Tokens = getSideTokens(matchRow, 2);
  if (team1Tokens.length === 0 && team2Tokens.length === 0) return false;

  const laterTokens = collectLaterRoundTokens(rows, roundOrder);
  const team1Advanced = hasAnyTokenInSet(team1Tokens, laterTokens);
  const team2Advanced = hasAnyTokenInSet(team2Tokens, laterTokens);

  if (team1Advanced !== team2Advanced) return true;

  return !team1Advanced && !team2Advanced;
}

function getEventKey(row) {
  return [
    cleanText(row.tournament_key),
    cleanText(row.event_id) ||
      [
        cleanText(row.player_type_code),
        cleanText(row.match_type_code),
        cleanText(row.event_classification_code),
      ].join(":"),
  ].join("|");
}

function isKnockoutDrawMatch(matchRow) {
  const structure = normalizeText(
    `${matchRow.drawsheet_structure_code || ""} ${matchRow.drawsheet_structure_desc || ""}`
  );

  if (!structure) return true;
  if (structure.includes("ROUND ROBIN") || structure.includes("ROBIN")) return false;
  if (structure.includes("GROUP") || structure.includes("POOL")) return false;
  if (structure === "RR") return false;

  return true;
}

function getDrawLabel(row) {
  const playerType = normalizeText(row.player_type_code || row.player_type_desc);
  const matchType = normalizeText(row.match_type_code || row.match_type_desc);
  const gender = playerType === "B" || playerType.includes("BOY")
    ? "Masculino"
    : playerType === "G" || playerType.includes("GIRL")
      ? "Feminino"
      : cleanText(row.player_type_desc || row.player_type_code) || "-";
  const event = matchType === "S" || matchType.includes("SINGLE")
    ? "simples"
    : matchType === "D" || matchType.includes("DOUBLE")
      ? "duplas"
      : cleanText(row.match_type_desc || row.match_type_code) || "-";

  return `${gender} ${event}`;
}

function getDrawOrder(row) {
  const playerType = normalizeText(row.player_type_code || row.player_type_desc);
  const matchType = normalizeText(row.match_type_code || row.match_type_desc);
  const genderOrder = playerType === "B" || playerType.includes("BOY")
    ? 0
    : playerType === "G" || playerType.includes("GIRL")
      ? 1
      : 9;
  const eventOrder = matchType === "S" || matchType.includes("SINGLE")
    ? 0
    : matchType === "D" || matchType.includes("DOUBLE")
      ? 1
      : 9;

  return genderOrder * 10 + eventOrder;
}

function buildDrawProgressRows(weekMatchesRows) {
  const groups = new Map();
  const rowsByEvent = new Map();

  for (const row of weekMatchesRows) {
    const eventKey = getEventKey(row);
    if (!rowsByEvent.has(eventKey)) rowsByEvent.set(eventKey, []);
    rowsByEvent.get(eventKey).push(row);
  }

  for (const row of weekMatchesRows) {
    const tournamentKey = cleanText(row.tournament_key);
    const playerType = cleanText(row.player_type_code || row.player_type_desc);
    const matchType = cleanText(row.match_type_code || row.match_type_desc);
    if (!tournamentKey || !playerType || !matchType) continue;

    const key = [tournamentKey, playerType, matchType].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        tournament_key: tournamentKey,
        tournament_name: cleanText(row.tournament_name),
        category: cleanText(row.category),
        draw: getDrawLabel(row),
        draw_order: getDrawOrder(row),
        total_matches: 0,
        completed_matches: 0,
      });
    }

    const group = groups.get(key);
    const eventRows = rowsByEvent.get(getEventKey(row)) || [];
    group.total_matches += 1;
    if (isMatchComplete(row) || isPendingMatchResolvedByLaterDraw(row, eventRows)) {
      group.completed_matches += 1;
    }
  }

  return [...groups.values()]
    .map((row) => ({
      ...row,
      pending_matches: Math.max(row.total_matches - row.completed_matches, 0),
    }))
    .sort((a, b) =>
      cleanText(a.tournament_name).localeCompare(cleanText(b.tournament_name), "pt-BR") ||
      a.draw_order - b.draw_order
    );
}

function buildSummaryMarkdown({
  completion,
  drawProgressRows,
  nonKnockoutRows,
  scrapedWithFreshData,
  newMatchResults,
}) {
  const totalMatches = drawProgressRows.reduce(
    (sum, row) => sum + toNumber(row.total_matches),
    0
  );
  const completedMatches = drawProgressRows.reduce(
    (sum, row) => sum + toNumber(row.completed_matches),
    0
  );
  const pendingMatches = drawProgressRows.reduce(
    (sum, row) => sum + toNumber(row.pending_matches),
    0
  );
  const nonKnockoutTotal = nonKnockoutRows.length;
  const nonKnockoutCompleted = nonKnockoutRows.filter(isMatchComplete).length;
  const lines = [
    "## Resumo da raspagem semanal",
    "",
    `- Fonte dos dados: ${scrapedWithFreshData ? "raspagem ITF fresca" : "cache/local"}`,
    `- Torneios encontrados: ${completion.tournaments_total}`,
    `- Novos resultados de partidas identificados: ${
      newMatchResults === null ? "comparação indisponível" : newMatchResults
    }`,
    `- Jogos completos no mata-mata: ${completedMatches}/${totalMatches}`,
    `- Jogos pendentes no mata-mata: ${pendingMatches}`,
    ...(nonKnockoutTotal > 0
      ? [`- Jogos fora do mata-mata coletados: ${nonKnockoutCompleted}/${nonKnockoutTotal}`]
      : []),
    `- Eventos pendentes: ${completion.events_pending}`,
    `- Eventos pendentes tolerados: ${completion.tolerated_pending_events || 0}`,
    `- Eventos ausentes: ${completion.missing_events}`,
    `- Eventos ausentes tolerados: ${completion.tolerated_missing_events || 0}`,
    `- Erros de coleta: ${completion.results_errors}`,
    "",
    "### Jogos completos por torneio e chave (mata-mata)",
    "",
  ];

  if (!drawProgressRows.length) {
    lines.push("Nenhum jogo encontrado nos artefatos da semana.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Torneio | Nivel | Chave | Jogos completos | Pendentes |");
  lines.push("| --- | --- | --- | ---: | ---: |");

  for (const row of drawProgressRows) {
    lines.push([
      escapeMarkdownCell(row.tournament_name),
      escapeMarkdownCell(row.category),
      escapeMarkdownCell(row.draw),
      `${toNumber(row.completed_matches)}/${toNumber(row.total_matches)}`,
      String(toNumber(row.pending_matches)),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [
    weekTournamentRows,
    weekMatchesRows,
    weekResultsSummaryRows,
    weekResultsErrorsRows,
  ] = await Promise.all([
    readCsvIfExists(path.join(CLEAN_DIR, "week_tournaments.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_matches.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_results_summary.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_results_errors.csv")),
  ]);
  const previousMatchesAvailable = await fs
    .access(PREVIOUS_WEEK_MATCHES_FILE)
    .then(() => true)
    .catch(() => false);
  const previousWeekMatchesRows = previousMatchesAvailable
    ? await readCsvIfExists(PREVIOUS_WEEK_MATCHES_FILE)
    : [];
  const previousWeekTournamentsRows = await readCsvIfExists(
    PREVIOUS_WEEK_TOURNAMENTS_FILE
  );
  const currentWeekStart = getWeekStart(weekTournamentRows);
  const previousWeekStart = getWeekStart(previousWeekTournamentsRows);
  const hasComparablePreviousWeek =
    Boolean(currentWeekStart && currentWeekStart === previousWeekStart);

  const completion = summarizeWeekCompletion({
    weekTournamentRows,
    weekMatchesRows,
    weekResultsSummaryRows,
    weekResultsErrorsRows,
    currentDate: todayIsoDate(),
    weekEnd: getWeekEnd(weekTournamentRows),
  });
  const knockoutRows = weekMatchesRows.filter(isKnockoutDrawMatch);
  const nonKnockoutRows = weekMatchesRows.filter((row) => !isKnockoutDrawMatch(row));
  const markdown = buildSummaryMarkdown({
    completion,
    drawProgressRows: buildDrawProgressRows(knockoutRows),
    nonKnockoutRows,
    scrapedWithFreshData: process.env.ITF_SCRAPE_FRESH === "true",
    newMatchResults: hasComparablePreviousWeek
      ? countNewMatchResults(weekMatchesRows, previousWeekMatchesRows)
      : null,
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
