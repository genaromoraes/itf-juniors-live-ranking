import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE_STATE_TOP1000_STAGING } from "./lib/ranking_limits.mjs";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  PLAYER_COLUMNS,
  SNAPSHOT_COLUMNS,
  copyExistingLedgerForStaging,
  filterTop1000Universe,
  readJson,
  readCsv,
  resolveTop1000Paths,
  universeRowsToPlayers,
  universeRowsToSnapshot,
  writeCsvAtomic,
  writeJsonAtomic,
  writeStagingStatus,
} from "./lib/top1000_migration.mjs";
import { cleanText } from "./lib/player_breakdown.mjs";

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getForwardedArgs() {
  const names = [
    "max-pages-per-run",
    "gender",
    "page-size",
    "delay-ms",
  ];
  const args = [];
  for (const name of names) {
    const value = getArg(name);
    if (value) args.push(`--${name}=${value}`);
  }
  if (hasFlag("resume")) args.push("--resume");
  if (hasFlag("restart")) args.push("--restart");
  return args;
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Comando falhou com codigo ${code}: ${args.join(" ")}`));
    });
  });
}

async function ensureUniverse(paths) {
  const explicitUniverse = getArg("universe-file");
  if (explicitUniverse) return path.resolve(explicitUniverse);

  const universeFile = path.join(paths.stagingDir, "rankings_universe_501_1000.csv");
  const snapshotRows = await readCsv(paths.clean.snapshot);
  const rankingDate = cleanText(snapshotRows[0]?.ranking_date);
  await runNode([
    "scripts/03_fetch_rankings_universe.mjs",
    "--start-rank=501",
    "--end-rank=1000",
    "--page-size=100",
    `--ranking-date=${rankingDate}`,
    `--output-file=${universeFile}`,
    ...getForwardedArgs(),
  ]);
  return universeFile;
}

export function validateLegacySeed(playersRows, snapshotRows) {
  const errors = [];
  const playerCounts = playersRows.reduce((acc, row) => {
    acc[cleanText(row.gender)] = (acc[cleanText(row.gender)] || 0) + 1;
    return acc;
  }, {});
  const snapshotCounts = snapshotRows.reduce((acc, row) => {
    acc[cleanText(row.gender)] = (acc[cleanText(row.gender)] || 0) + 1;
    return acc;
  }, {});
  const rankingDates = new Set(snapshotRows.map((row) => cleanText(row.ranking_date)));
  if (playersRows.length !== 1000 || playerCounts.M !== 500 || playerCounts.F !== 500) {
    errors.push("players.csv de producao precisa ter exatamente 500 M e 500 F.");
  }
  if (snapshotRows.length !== 1000 || snapshotCounts.M !== 500 || snapshotCounts.F !== 500) {
    errors.push("rankings_snapshot.csv de producao precisa ter exatamente 500 M e 500 F.");
  }
  if (rankingDates.size !== 1 || ![...rankingDates][0]) {
    errors.push("rankings_snapshot.csv precisa ter uma unica ranking_date preenchida.");
  }
  for (const gender of ["M", "F"]) {
    const ranks = snapshotRows
      .filter((row) => cleanText(row.gender) === gender)
      .map((row) => Number(cleanText(row.rank)))
      .sort((a, b) => a - b);
    if (ranks.length !== 500 || ranks.some((rank, index) => rank !== index + 1)) {
      errors.push(`rankings_snapshot.csv de producao nao possui ranks 1-500 para ${gender}.`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function playerFromSnapshot(row) {
  return {
    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    first_name: "",
    last_name: "",
    gender: cleanText(row.gender),
    itf_gender_code: cleanText(row.gender) === "M" ? "B" : "G",
    country: cleanText(row.country),
    country_name: cleanText(row.country_name),
    birth_date: "",
    birth_year: cleanText(row.birth_year),
    junior_last_year: "",
    active_junior: "",
    profile_url: "",
    current_rank: cleanText(row.rank),
    current_points: cleanText(row.official_points),
    first_seen_date: cleanText(row.ranking_date),
    last_seen_date: cleanText(row.ranking_date),
    raw_json: "",
  };
}

export function mergeSeedAndUniverse(seedSnapshotRows, universeRows) {
  const seedRows = seedSnapshotRows.filter((row) => Number(row.rank) <= 500);
  const externalRows = filterTop1000Universe(universeRows).filter(
    (row) => Number(row.rank) >= 501 && Number(row.rank) <= 1000
  );
  const byGender = new Map();
  for (const row of [...seedRows, ...externalRows]) {
    const key = `${cleanText(row.gender)}:${cleanText(row.rank)}`;
    byGender.set(key, row);
  }
  return [...byGender.values()].sort((a, b) => {
    if (cleanText(a.gender) !== cleanText(b.gender)) {
      return cleanText(a.gender).localeCompare(cleanText(b.gender));
    }
    return Number(a.rank) - Number(b.rank);
  });
}

function universeComplete(manifest) {
  return manifest?.status === "COMPLETE" || (manifest?.boys?.complete && manifest?.girls?.complete);
}

async function updatePartialStatus(paths, manifest) {
  await writeJsonAtomic(paths.staging.status, {
    state: BASE_STATE_TOP1000_STAGING,
    universe_status: manifest?.status || "NOT_STARTED",
    universe_ranking_date: manifest?.ranking_date || "",
    universe_male_collected: manifest?.boys?.rows_collected || 0,
    universe_female_collected: manifest?.girls?.rows_collected || 0,
    universe_male_expected: 500,
    universe_female_expected: 500,
    staging_final_generated: false,
    breakdowns_waiting_for_universe: true,
    updated_at: new Date().toISOString(),
  });
}

async function main() {
  const paths = resolveTop1000Paths();
  await fs.mkdir(paths.stagingDir, { recursive: true });
  const productionPlayersRows = await readCsv(paths.clean.players);
  const productionSnapshotRows = await readCsv(paths.clean.snapshot);
  validateLegacySeed(productionPlayersRows, productionSnapshotRows);

  const universeFile = await ensureUniverse(paths);
  const manifest = await readJson(path.resolve("data/raw/rankings_universe/collection_manifest.json"), {
    optional: true,
  });
  if (!universeComplete(manifest)) {
    await updatePartialStatus(paths, manifest);
    console.log("Universo 501-1000 ainda incompleto. Staging final nao foi gerado.");
    console.log(`Status: ${manifest?.status || "NOT_STARTED"}`);
    console.log(`M: ${manifest?.boys?.rows_collected || 0}/500`);
    console.log(`F: ${manifest?.girls?.rows_collected || 0}/500`);
    console.log(`Proxima pagina M: ${manifest?.boys?.next_skip ?? 500}`);
    console.log(`Proxima pagina F: ${manifest?.girls?.next_skip ?? 500}`);
    return;
  }

  const universeRows = await readCsv(universeFile);
  const mergedSnapshotRows = mergeSeedAndUniverse(productionSnapshotRows, universeRows);
  const playersRows = mergedSnapshotRows.map(playerFromSnapshot);
  const snapshotRows = universeRowsToSnapshot(mergedSnapshotRows);
  if (playersRows.length !== 2000) {
    throw new Error(`Staging final exigia 2000 jogadores, recebeu ${playersRows.length}.`);
  }
  const stagingIds = new Set(playersRows.map((row) => cleanText(row.player_id)));
  const productionLedgerRows = await readCsv(paths.clean.ledger);
  const ledgerRows = copyExistingLedgerForStaging(productionLedgerRows, stagingIds);
  const ledgerIds = new Set(ledgerRows.map((row) => cleanText(row.player_id)));
  const summaryRows = playersRows
    .filter((row) => ledgerIds.has(cleanText(row.player_id)))
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      gender: row.gender,
      rank: row.current_rank,
      ranking_date: row.last_seen_date,
      status: "fetched",
      ledger_rows: ledgerRows.filter((item) => cleanText(item.player_id) === cleanText(row.player_id)).length,
      updated_at: new Date().toISOString(),
    }));

  await writeCsvAtomic(paths.staging.players, playersRows, PLAYER_COLUMNS);
  await writeCsvAtomic(paths.staging.snapshot, snapshotRows, SNAPSHOT_COLUMNS);
  await writeCsvAtomic(paths.staging.ledger, ledgerRows, LEDGER_COLUMNS);
  await writeCsvAtomic(paths.staging.summary, summaryRows, BREAKDOWN_SUMMARY_COLUMNS);
  await writeCsvAtomic(paths.staging.errors, [], BREAKDOWN_ERROR_COLUMNS);
  const status = await writeStagingStatus();
  await writeJsonAtomic(paths.staging.status, status);

  console.log("Preparacao Top 1000 criada em staging.");
  console.log(`Arquivo de universo: ${path.relative(process.cwd(), universeFile)}`);
  console.log(`Jogadores: ${playersRows.length}`);
  console.log(`Breakdowns disponiveis: ${status.breakdowns_available}`);
  console.log(`Breakdowns faltantes: ${status.breakdowns_missing}`);
  console.log(`Estado: migration pending (${BASE_STATE_TOP1000_STAGING})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
