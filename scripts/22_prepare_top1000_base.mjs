import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BASE_STATE_TOP1000_STAGING,
  TOP1000_BASE_LIMIT_PER_GENDER,
} from "./lib/ranking_limits.mjs";
import {
  BREAKDOWN_ERROR_COLUMNS,
  BREAKDOWN_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  PLAYER_COLUMNS,
  SNAPSHOT_COLUMNS,
  copyExistingLedgerForStaging,
  filterTop1000Universe,
  readCsv,
  resolveTop1000Paths,
  universeRowsToPlayers,
  universeRowsToSnapshot,
  writeBaseState,
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

  const universeFile = path.join(paths.stagingDir, "rankings_universe.csv");
  await runNode([
    "scripts/03_fetch_rankings_universe.mjs",
    `--limit-per-gender=${TOP1000_BASE_LIMIT_PER_GENDER}`,
    `--output-file=${universeFile}`,
  ]);
  return universeFile;
}

async function main() {
  const paths = resolveTop1000Paths();
  await fs.mkdir(paths.stagingDir, { recursive: true });

  const universeFile = await ensureUniverse(paths);
  const universeRows = filterTop1000Universe(await readCsv(universeFile));
  const playersRows = universeRowsToPlayers(universeRows);
  const snapshotRows = universeRowsToSnapshot(universeRows);
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
  await writeBaseState(process.cwd(), BASE_STATE_TOP1000_STAGING);
  const status = await writeStagingStatus();
  await writeJsonAtomic(paths.staging.status, status);

  console.log("Preparacao Top 1000 criada em staging.");
  console.log(`Arquivo de universo: ${path.relative(process.cwd(), universeFile)}`);
  console.log(`Jogadores: ${playersRows.length}`);
  console.log(`Breakdowns disponiveis: ${status.breakdowns_available}`);
  console.log(`Breakdowns faltantes: ${status.breakdowns_missing}`);
  console.log(`Estado: migration pending (${BASE_STATE_TOP1000_STAGING})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
