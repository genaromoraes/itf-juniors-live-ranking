import path from "node:path";
import {
  BASE_STATE_FILE,
  BASE_STATE_LEGACY_500,
} from "./lib/ranking_limits.mjs";
import {
  loadStaging,
  readCsv,
  readJson,
  resolveTop1000Paths,
  sha256File,
  summarizeStaging,
  writeJsonAtomic,
} from "./lib/top1000_migration.mjs";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function countByGender(rows) {
  return rows.reduce((acc, row) => {
    const gender = cleanText(row.gender);
    acc[gender] = (acc[gender] || 0) + 1;
    return acc;
  }, {});
}

async function productionStatus(paths) {
  const [playersRows, snapshotRows] = await Promise.all([
    readCsv(paths.clean.players),
    readCsv(paths.clean.snapshot),
  ]);
  const state = await readJson(path.resolve(BASE_STATE_FILE), { optional: true });
  return {
    state: cleanText(state?.state) || BASE_STATE_LEGACY_500,
    players: playersRows.length,
    playersByGender: countByGender(playersRows),
    snapshot: snapshotRows.length,
    hashes: {
      players: await sha256File(paths.clean.players),
      rankings_snapshot: await sha256File(paths.clean.snapshot),
      points_ledger: await sha256File(paths.clean.ledger),
    },
  };
}

async function universeStatus() {
  return await readJson("data/raw/rankings_universe/collection_manifest.json", {
    optional: true,
  });
}

function printUniverse(manifest) {
  console.log("");
  console.log("COLETA DO UNIVERSO");
  if (!manifest) {
    console.log("Status: NOT_STARTED");
    console.log("Universo 501-1000: 0/500 M e 0/500 F");
    return;
  }
  console.log(`Status: ${manifest.status}`);
  console.log(`ranking_date: ${manifest.ranking_date || ""}`);
  console.log(
    `Masculino coletado: ${manifest.boys?.rows_collected || 0}/500`
  );
  console.log(
    `Feminino coletado: ${manifest.girls?.rows_collected || 0}/500`
  );
  console.log(
    `Paginas M concluidas: ${(manifest.boys?.completed_pages || []).join(", ") || "(nenhuma)"}`
  );
  console.log(
    `Paginas F concluidas: ${(manifest.girls?.completed_pages || []).join(", ") || "(nenhuma)"}`
  );
  console.log(`Proxima pagina M: ${manifest.boys?.next_skip ?? 500}`);
  console.log(`Proxima pagina F: ${manifest.girls?.next_skip ?? 500}`);
  console.log(`Bloqueio atual: ${manifest.blocked_gender ? `${manifest.blocked_gender} skip=${manifest.blocked_skip}` : "nao"}`);
  console.log(`Ultimo erro: ${manifest.last_error || "(nenhum)"}`);
}

function printProduction(status) {
  console.log("ESTADO DE PRODUCAO");
  console.log(`Estado: ${status.state}`);
  console.log(
    `Jogadores: ${status.players} (M=${status.playersByGender.M || 0}, F=${status.playersByGender.F || 0})`
  );
  console.log(`Snapshot: ${status.snapshot}`);
  console.log(`Hash players.csv: ${status.hashes.players}`);
  console.log(`Hash rankings_snapshot.csv: ${status.hashes.rankings_snapshot}`);
  console.log(`Hash points_ledger.csv: ${status.hashes.points_ledger}`);
}

async function printStaging(loaded, manifest) {
  console.log("");
  console.log("STAGING FINAL");
  const finalExists = loaded.playersRows.length > 0 && loaded.snapshotRows.length > 0;
  if (!finalExists) {
    console.log("Staging final: ainda nao gerado");
    console.log(
      `Universo 501-1000: ${manifest?.boys?.rows_collected || 0}/500 M e ${manifest?.girls?.rows_collected || 0}/500 F`
    );
    console.log("Breakdowns: aguardando conclusao do universo");
    return;
  }
  const status = summarizeStaging(loaded);
  await writeJsonAtomic(loaded.paths.staging.status, status);
  const playersByGender = countByGender(loaded.playersRows);
  console.log(
    `Jogadores: ${loaded.playersRows.length} (M=${playersByGender.M || 0}, F=${playersByGender.F || 0})`
  );
  console.log(`Breakdowns disponiveis: ${status.breakdowns_available}`);
  console.log(`Breakdowns faltantes: ${status.breakdowns_missing}`);
  console.log(`Erros: ${status.errors}`);
  console.log(`Percentual concluido: ${status.percent_complete}%`);
  console.log(`Pronta para promocao: ${status.ready_for_promotion ? "sim" : "nao"}`);
}

async function main() {
  const loaded = await loadStaging();
  const prod = await productionStatus(loaded.paths);
  const manifest = await universeStatus();

  printProduction(prod);
  printUniverse(manifest);
  await printStaging(loaded, manifest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
