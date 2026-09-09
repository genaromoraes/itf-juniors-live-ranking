import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { certifyUniverse } from './lib/universe_coverage.mjs';
import {
  PUBLIC_BOUNDARY_AUDIT_COLUMNS,
  validatePublicationData,
} from "./lib/publication_validation.mjs";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

async function readCsv(filePath, { optional = false } = {}) {
  try {
    return {
      present: true,
      rows: parse(await fs.readFile(filePath, "utf8"), {
        columns: true,
        skip_empty_lines: true,
        bom: true,
      }),
    };
  } catch (error) {
    if (optional && error?.code === "ENOENT") return { present: false, rows: [] };
    throw error;
  }
}

async function readBaseState() {
  try {
    const state = JSON.parse(await fs.readFile(path.resolve("data/config/base_state.json"), "utf8"));
    return String(state.state || "").trim();
  } catch {
    return "";
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const strict = isTrue(readArg("strict", "false"));
  const outputDir = path.resolve(readArg("output-dir", "data/clean"));
  const reportFile = path.join(outputDir, "publication_validation.json");
  const boundaryFile = path.join(outputDir, "public_ranking_boundary_audit.csv");
  const cleanDir = path.resolve("data/clean");

  const [
    players,
    snapshot,
    ledger,
    liveRanking,
    publicRanking,
    candidates,
    candidateLedger,
    universe,
    weekTournaments,
    weekMatches,
    weekPlayerResults,
    weekResultsErrors,
  ] = await Promise.all([
    readCsv(path.join(cleanDir, "players.csv")),
    readCsv(path.join(cleanDir, "rankings_snapshot.csv")),
    readCsv(path.join(cleanDir, "points_ledger.csv")),
    readCsv(path.join(cleanDir, "live_ranking_with_drops.csv")),
    readCsv(path.join(cleanDir, "live_ranking_with_drops_public.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "external_candidates.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "external_candidate_ledger.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "rankings_universe.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "week_tournaments.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "week_matches.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "week_player_results.csv"), { optional: true }),
    readCsv(path.join(cleanDir, "week_results_errors.csv"), { optional: true }),
  ]);

  const result = validatePublicationData({
    strict,
    baseState: await readBaseState(),
    playersRows: players.rows,
    snapshotRows: snapshot.rows,
    pointsLedgerRows: ledger.rows,
    liveRankingRows: liveRanking.rows,
    publicRankingRows: publicRanking.rows,
    candidateRows: candidates.rows,
    candidateLedgerRows: candidateLedger.rows,
    universeRows: universe.rows,
    weekTournamentsRows: weekTournaments.rows,
    weekMatchesRows: weekMatches.rows,
    weekPlayerResultsRows: weekPlayerResults.rows,
    weekResultsErrorRows: weekResultsErrors.rows,
    presence: {
      publicRanking: publicRanking.present,
      candidates: candidates.present,
      universe: universe.present,
      weekTournaments: weekTournaments.present,
      weekMatches: weekMatches.present,
      weekPlayerResults: weekPlayerResults.present,
      weekResultsErrors: weekResultsErrors.present,
    },
  });

  try {
    const coverage = certifyUniverse(universe.rows, snapshot.rows);
    result.coverage = coverage;
    if (candidates.rows.some(row => row.official_points_status === 'BOUNDED' &&
        (!Number.isFinite(Number(row.official_points_upper_bound)) ||
          Number(row.official_points_upper_bound) < coverage.unlisted_points_upper_bound ||
          row.ranking_date !== coverage.ranking_date))) {
      result.errors.push('Candidato usa teto de pontos sem cobertura oficial suficiente.');
    }
  } catch (error) {
    result.errors.push(error.message);
  }
  result.valid = result.errors.length === 0;
  const report = {
    ...result,
    boundaryRows: undefined,
    generated_at: new Date().toISOString(),
  };
  await writeJson(reportFile, report);
  await fs.mkdir(path.dirname(boundaryFile), { recursive: true });
  await fs.writeFile(
    boundaryFile,
    stringify(result.boundaryRows, {
      header: true,
      columns: PUBLIC_BOUNDARY_AUDIT_COLUMNS,
    }),
    "utf8"
  );

  console.log(`Validacao publica Top ${result.public_limit_per_gender}`);
  console.log(`Modo estrito: ${strict ? "sim" : "nao"}`);
  console.log(`Valida: ${result.valid ? "sim" : "nao"}`);
  console.log(
    `Publico: M=${result.counts.public_by_gender.M}, F=${result.counts.public_by_gender.F}`
  );
  console.log(`Candidatos pendentes: ${result.counts.unresolved_candidates}`);
  console.log(`Relatorio: ${path.relative(process.cwd(), reportFile)}`);
  console.log(`Auditoria: ${path.relative(process.cwd(), boundaryFile)}`);

  if (result.warnings.length > 0) {
    console.log("Avisos:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
  if (!result.valid) {
    console.error("Erros:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}

await main();
