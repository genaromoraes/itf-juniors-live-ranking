import path from "node:path";
import {
  EXTERNAL_CANDIDATE_COLUMNS,
  classifyExternalCandidates,
  collectExternalParticipants,
  readCsv,
  writeCsv,
} from "./lib/external_candidates.mjs";

const CLEAN_DIR = path.resolve("data", "clean");
const CONFIG_DIR = path.resolve("data", "config");

const PLAYERS_FILE = path.join(CLEAN_DIR, "players.csv");
const WEEK_PLAYER_RESULTS_FILE = path.join(CLEAN_DIR, "week_player_results.csv");
const WEEK_MATCHES_FILE = path.join(CLEAN_DIR, "week_matches.csv");
const WEEK_LIVE_LEDGER_FILE = path.join(CLEAN_DIR, "week_live_ledger_rows.csv");
const RANKINGS_UNIVERSE_FILE = path.join(CLEAN_DIR, "rankings_universe.csv");
const LIVE_RANKING_FILE = path.join(CLEAN_DIR, "live_ranking_with_drops.csv");
const POINTS_TABLE_FILE = path.join(CONFIG_DIR, "junior_points_table.csv");
const EXTERNAL_CANDIDATES_FILE = path.join(CLEAN_DIR, "external_candidates.csv");

async function main() {
  const playersRows = await readCsv(PLAYERS_FILE);
  const weekPlayerResultsRows = await readCsv(WEEK_PLAYER_RESULTS_FILE, {
    optional: true,
  });
  const weekMatchesRows = await readCsv(WEEK_MATCHES_FILE, { optional: true });
  const weekLiveLedgerRows = await readCsv(WEEK_LIVE_LEDGER_FILE, {
    optional: true,
  });
  const universeRows = await readCsv(RANKINGS_UNIVERSE_FILE, { optional: true });
  const baseRankingRows = await readCsv(LIVE_RANKING_FILE, { optional: true });
  const pointsTableRows = await readCsv(POINTS_TABLE_FILE);
  const existingCandidates = await readCsv(EXTERNAL_CANDIDATES_FILE, {
    optional: true,
  });

  const participants = collectExternalParticipants({
    playersRows,
    weekPlayerResultsRows,
    weekMatchesRows,
    weekLiveLedgerRows,
  });

  const candidates = classifyExternalCandidates({
    participants,
    universeRows,
    weekLiveLedgerRows,
    pointsTableRows,
    baseRankingRows,
    existingCandidates,
  });

  await writeCsv(EXTERNAL_CANDIDATES_FILE, candidates, EXTERNAL_CANDIDATE_COLUMNS);

  console.log(`Participantes externos encontrados: ${participants.length}`);
  console.log(`Candidatos externos classificados: ${candidates.length}`);
  console.log(
    `FETCH_REQUIRED: ${
      candidates.filter((row) => row.candidate_status === "FETCH_REQUIRED").length
    }`
  );
  console.log(`Arquivo gerado: ${path.relative(process.cwd(), EXTERNAL_CANDIDATES_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

