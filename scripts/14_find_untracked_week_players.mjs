import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const CLEAN_DIR = path.resolve("data", "clean");
const AUDIT_DIR = path.resolve("data", "audit");

const PLAYERS_FILE = path.join(CLEAN_DIR, "players.csv");
const POINTS_LEDGER_FILE = path.join(CLEAN_DIR, "points_ledger.csv");
const WEEK_PLAYER_RESULTS_FILE = path.join(CLEAN_DIR, "week_player_results.csv");
const WEEK_MATCHES_FILE = path.join(CLEAN_DIR, "week_matches.csv");
const OUTPUT_FILE = path.join(AUDIT_DIR, "untracked_week_players.csv");

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNameCountryKey(name, country) {
  const normalizedName = normalizeName(name);
  const normalizedCountry = cleanText(country).toUpperCase();

  return normalizedName && normalizedCountry
    ? `${normalizedName}|${normalizedCountry}`
    : "";
}

async function readCsv(filePath, { optional = false } = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });
  } catch (err) {
    if (optional && err.code === "ENOENT") return [];
    throw err;
  }
}

function splitList(value, separator) {
  return cleanText(value)
    .split(separator)
    .map(cleanText)
    .filter(Boolean);
}

function inferGender(row) {
  const code = cleanText(row.player_type_code).toUpperCase();
  if (code === "B") return "M";
  if (code === "G") return "F";
  return "";
}

function getEventLabel(row) {
  return cleanText(row.match_type_desc) || cleanText(row.match_type_code);
}

function getClassificationLabel(row) {
  return cleanText(row.event_classification_desc) || cleanText(row.event_classification_code);
}

function createCandidate(row) {
  const playerId = cleanText(row.player_id);
  const playerName = cleanText(row.player_name);

  return {
    player_id: playerId,
    player_name: playerName,
    gender: cleanText(row.gender) || inferGender(row),
    nationality: cleanText(row.nationality || row.country),
    player_type_code: cleanText(row.player_type_code),
    player_type_desc: cleanText(row.player_type_desc),
    tournaments: new Set(),
    categories: new Set(),
    event_types: new Set(),
    classifications: new Set(),
    sources: new Set(),
    first_seen_source: "",
    result_rows: 0,
    match_rows: 0,
  };
}

function addCandidate(candidates, tracked, row, source) {
  const playerId = cleanText(row.player_id);
  const playerName = cleanText(row.player_name);
  const nationality = cleanText(row.nationality || row.country);

  if (!playerId && !playerName) return;
  if (playerId && tracked.ids.has(playerId)) return;

  const nameCountryKey = getNameCountryKey(playerName, nationality);
  if (!playerId && nameCountryKey && tracked.nameCountryKeys.has(nameCountryKey)) return;

  const key = playerId || nameCountryKey || normalizeName(playerName);
  if (!key) return;

  if (!candidates.has(key)) {
    candidates.set(key, createCandidate(row));
  }

  const candidate = candidates.get(key);
  const tournament = cleanText(row.tournament_name);
  const category = cleanText(row.category);
  const eventType = getEventLabel(row);
  const classification = getClassificationLabel(row);

  if (tournament) candidate.tournaments.add(tournament);
  if (category) candidate.categories.add(category);
  if (eventType) candidate.event_types.add(eventType);
  if (classification) candidate.classifications.add(classification);
  if (source) candidate.sources.add(source);
  if (!candidate.first_seen_source) candidate.first_seen_source = source;

  if (source === "week_player_results") candidate.result_rows += 1;
  if (source === "week_matches") candidate.match_rows += 1;
}

function addMatchSideCandidates(candidates, tracked, row, side) {
  const ids = splitList(row[`team${side}_player_ids`], "|");
  const namesByPipe = splitList(row[`team${side}_names`], "|");
  const namesBySlash = splitList(row[`team${side}_names`], " / ");
  const names = namesByPipe.length === ids.length ? namesByPipe : namesBySlash;
  const nationalities = splitList(row[`team${side}_nationalities`], "|");

  for (let i = 0; i < ids.length; i += 1) {
    addCandidate(
      candidates,
      tracked,
      {
        ...row,
        player_id: ids[i],
        player_name: names[i] || "",
        nationality: nationalities[i] || "",
      },
      "week_matches"
    );
  }
}

function buildTrackedPlayers(players, pointsLedger) {
  const ids = new Set();
  const nameCountryKeys = new Set();

  for (const row of [...players, ...pointsLedger]) {
    const playerId = cleanText(row.player_id);
    const playerName = cleanText(row.player_name);
    const country = cleanText(row.country || row.nationality);

    if (playerId) ids.add(playerId);

    const key = getNameCountryKey(playerName, country);
    if (key) nameCountryKeys.add(key);
  }

  return { ids, nameCountryKeys };
}

function formatSet(values) {
  return [...values].sort((a, b) => a.localeCompare(b)).join("; ");
}

function buildReportRows(candidates) {
  return [...candidates.values()]
    .map((candidate) => ({
      player_id: candidate.player_id,
      player_name: candidate.player_name,
      gender: candidate.gender,
      nationality: candidate.nationality,
      player_type_code: candidate.player_type_code,
      player_type_desc: candidate.player_type_desc,
      categories: formatSet(candidate.categories),
      tournaments: formatSet(candidate.tournaments),
      event_types: formatSet(candidate.event_types),
      classifications: formatSet(candidate.classifications),
      sources: formatSet(candidate.sources),
      result_rows: candidate.result_rows,
      match_rows: candidate.match_rows,
    }))
    .sort((a, b) => {
      const byName = a.player_name.localeCompare(b.player_name);
      if (byName) return byName;
      return a.player_id.localeCompare(b.player_id);
    });
}

async function main() {
  const players = await readCsv(PLAYERS_FILE);
  const pointsLedger = await readCsv(POINTS_LEDGER_FILE);
  const weekPlayerResults = await readCsv(WEEK_PLAYER_RESULTS_FILE);
  const weekMatches = await readCsv(WEEK_MATCHES_FILE);

  const tracked = buildTrackedPlayers(players, pointsLedger);
  const candidates = new Map();

  for (const row of weekPlayerResults) {
    addCandidate(candidates, tracked, row, "week_player_results");
  }

  for (const row of weekMatches) {
    addMatchSideCandidates(candidates, tracked, row, 1);
    addMatchSideCandidates(candidates, tracked, row, 2);
  }

  const reportRows = buildReportRows(candidates);

  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(
    OUTPUT_FILE,
    stringify(reportRows, {
      header: true,
      columns: [
        "player_id",
        "player_name",
        "gender",
        "nationality",
        "player_type_code",
        "player_type_desc",
        "categories",
        "tournaments",
        "event_types",
        "classifications",
        "sources",
        "result_rows",
        "match_rows",
      ],
    }),
    "utf8"
  );

  console.log(`Tracked players by ID: ${tracked.ids.size}`);
  console.log(`Weekly player-result rows: ${weekPlayerResults.length}`);
  console.log(`Weekly match rows: ${weekMatches.length}`);
  console.log(`Untracked weekly players found: ${reportRows.length}`);
  console.log(`Report written to: ${path.relative(process.cwd(), OUTPUT_FILE)}`);

  if (reportRows.length) {
    console.log("");
    console.log("First untracked players:");

    for (const row of reportRows.slice(0, 20)) {
      console.log(
        `- ${row.player_name || "(sem nome)"} (${row.nationality || "-"}) ` +
          `[${row.player_id || "sem ID"}] - ${row.categories || "-"} - ${row.tournaments || "-"}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
