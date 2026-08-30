import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { pathToFileURL } from "url";
import { tournamentBelongsToOfficialWeek } from "./04_fetch_week_tournaments.mjs";

const RELATED_WEEKLY_FILES = [
  "week_matches.csv",
  "week_player_results.csv",
  "week_results_errors.csv",
  "week_results_summary.csv",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

async function readCsv(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const rows = parse(source, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  });
  const [columns = []] = parse(source, {
    bom: true,
    to_line: 1,
    skip_empty_lines: true,
  });

  return { rows, columns };
}

async function writeCsv(filePath, rows, columns) {
  await fs.writeFile(
    filePath,
    stringify(rows, {
      columns,
      header: true,
    }),
    "utf8"
  );
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function splitWeeklyTournaments(tournamentRows) {
  const reference = tournamentRows.find(
    (row) => cleanText(row.week_start) && cleanText(row.week_end)
  );

  if (!reference) {
    return {
      accepted: tournamentRows,
      rejected: [],
      weekWindow: null,
    };
  }

  const weekWindow = {
    week_start: cleanText(reference.week_start),
    week_end: cleanText(reference.week_end),
  };
  const accepted = [];
  const rejected = [];

  for (const row of tournamentRows) {
    if (tournamentBelongsToOfficialWeek(row, weekWindow)) {
      accepted.push(row);
    } else {
      rejected.push(row);
    }
  }

  return { accepted, rejected, weekWindow };
}

export async function sanitizeWeeklyPackage(cleanDir = path.resolve("data/clean")) {
  const tournamentsFile = path.join(cleanDir, "week_tournaments.csv");

  if (!(await fileExists(tournamentsFile))) {
    throw new Error(`Pacote semanal sem week_tournaments.csv: ${cleanDir}`);
  }

  const tournaments = await readCsv(tournamentsFile);
  const { accepted, rejected, weekWindow } = splitWeeklyTournaments(tournaments.rows);

  if (!weekWindow || rejected.length === 0) {
    console.log("Pacote semanal dentro da janela oficial; nenhum torneio removido.");
    return {
      weekWindow,
      tournamentsBefore: tournaments.rows.length,
      tournamentsAfter: tournaments.rows.length,
      removedTournamentKeys: [],
      removedRowsByFile: {},
    };
  }

  const rejectedKeys = new Set(
    rejected.map((row) => cleanText(row.tournament_key)).filter(Boolean)
  );

  await writeCsv(tournamentsFile, accepted, tournaments.columns);

  const removedRowsByFile = {};

  for (const file of RELATED_WEEKLY_FILES) {
    const filePath = path.join(cleanDir, file);

    if (!(await fileExists(filePath))) continue;

    const parsed = await readCsv(filePath);
    const filtered = parsed.rows.filter(
      (row) => !rejectedKeys.has(cleanText(row.tournament_key))
    );

    removedRowsByFile[file] = parsed.rows.length - filtered.length;

    if (filtered.length !== parsed.rows.length) {
      await writeCsv(filePath, filtered, parsed.columns);
    }
  }

  console.log(
    `Pacote semanal ${weekWindow.week_start} a ${weekWindow.week_end}: ` +
      `${rejected.length} torneio(s) fora da semana removido(s).`
  );
  for (const row of rejected) {
    console.log(
      `- ${cleanText(row.tournament_name) || cleanText(row.tournament_key)} ` +
        `(${cleanText(row.start_date)} a ${cleanText(row.end_date)})`
    );
  }

  return {
    weekWindow,
    tournamentsBefore: tournaments.rows.length,
    tournamentsAfter: accepted.length,
    removedTournamentKeys: [...rejectedKeys],
    removedRowsByFile,
  };
}

async function main() {
  const cleanDirArg = process.argv.find((arg) => arg.startsWith("--clean-dir="));
  const cleanDir = cleanDirArg
    ? path.resolve(cleanDirArg.slice("--clean-dir=".length))
    : path.resolve("data/clean");

  await sanitizeWeeklyPackage(cleanDir);
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}
