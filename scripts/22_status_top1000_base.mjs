import { loadStaging, summarizeStaging, writeJsonAtomic } from "./lib/top1000_migration.mjs";

async function main() {
  const loaded = await loadStaging();
  const status = summarizeStaging(loaded);
  await writeJsonAtomic(loaded.paths.staging.status, status);

  console.log("Status da migracao Top 1000");
  console.log(`Estado: ${status.state} (migration pending)`);
  console.log(`Total esperado: ${status.expected_total}`);
  console.log(`Masculino esperado: ${status.expected_male}`);
  console.log(`Feminino esperado: ${status.expected_female}`);
  console.log(`Breakdowns disponiveis: ${status.breakdowns_available}`);
  console.log(`Breakdowns faltantes: ${status.breakdowns_missing}`);
  console.log(`Erros: ${status.errors}`);
  console.log(`Ultimo atleta processado: ${status.last_player_id || "(nenhum)"}`);
  console.log(`Ultimo ranking processado: ${status.last_rank || "(nenhum)"}`);
  console.log(`Percentual concluido: ${status.percent_complete}%`);
  console.log(`Pronta para promocao: ${status.ready_for_promotion ? "sim" : "nao"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
