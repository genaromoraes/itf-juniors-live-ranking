import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const DEFAULT_SOURCE_DIR = path.resolve("data/staging/new_week_2026-08-03");
const DEFAULT_OUTPUT_DIR = path.resolve("data/clean");

const MATCH_COLUMNS = [
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
];

const PLAYER_RESULT_COLUMNS = [
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
];

const ERROR_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "player_type_code",
  "player_type_desc",
  "match_type_code",
  "match_type_desc",
  "event_classification_code",
  "drawsheet_structure_code",
  "error_message",
  "collected_at",
];

const SUMMARY_COLUMNS = [
  "tournament_key",
  "tournament_name",
  "category",
  "events_found",
  "matches_found",
  "errors_found",
  "raw_file",
  "from_cache",
  "collected_at",
];

function getArg(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : "";
}

function csvHeader(columns) {
  return stringify([], { header: true, columns });
}

async function writeEmptyCsv(filePath, columns) {
  await fs.writeFile(filePath, csvHeader(columns), "utf8");
}

export async function main() {
  const sourceDir = path.resolve(getArg("source-dir") || DEFAULT_SOURCE_DIR);
  const outputDir = path.resolve(getArg("output-dir") || DEFAULT_OUTPUT_DIR);
  const tournamentsFile = path.join(sourceDir, "week_tournaments.csv");
  const debugFile = path.join(sourceDir, "week_tournaments_debug_all.csv");

  await fs.mkdir(outputDir, { recursive: true });

  const tournamentCsv = await fs.readFile(tournamentsFile, "utf8");
  const tournaments = parse(tournamentCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  if (tournaments.length === 0) {
    throw new Error("O calendario da semana esta vazio.");
  }

  const weekStarts = [...new Set(tournaments.map((row) => row.week_start).filter(Boolean))];
  const weekEnds = [...new Set(tournaments.map((row) => row.week_end).filter(Boolean))];

  if (weekStarts.length !== 1 || weekEnds.length !== 1) {
    throw new Error(
      `Calendario inconsistente: week_start=${weekStarts.join(", ")}; week_end=${weekEnds.join(", ")}.`
    );
  }

  await fs.copyFile(tournamentsFile, path.join(outputDir, "week_tournaments.csv"));
  try {
    await fs.copyFile(
      debugFile,
      path.join(outputDir, "week_tournaments_debug_all.csv")
    );
  } catch {
    // O arquivo de debug e opcional para a publicacao.
  }

  await writeEmptyCsv(path.join(outputDir, "week_matches.csv"), MATCH_COLUMNS);
  await writeEmptyCsv(
    path.join(outputDir, "week_player_results.csv"),
    PLAYER_RESULT_COLUMNS
  );
  await writeEmptyCsv(path.join(outputDir, "week_results_errors.csv"), ERROR_COLUMNS);
  await writeEmptyCsv(path.join(outputDir, "week_results_summary.csv"), SUMMARY_COLUMNS);

  console.log(
    `Pacote inicial materializado: ${tournaments.length} torneios, ` +
      `${weekStarts[0]} a ${weekEnds[0]}, sem resultados coletados.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
