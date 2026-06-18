import { validateAndWriteTop1000Report } from "./lib/top1000_migration.mjs";

async function main() {
  const report = await validateAndWriteTop1000Report();
  console.log("Validacao da base Top 1000 em staging");
  console.log(`Valida: ${report.valid ? "sim" : "nao"}`);
  console.log(`Jogadores: ${report.players_total}`);
  console.log(`Snapshot: ${report.snapshot_total}`);
  console.log(`Ledger jogadores unicos: ${report.unique_ledger_players}`);
  console.log(`Reconciliacao: ${report.reconciliation_exact}/${report.reconciliation_total}`);
  if (report.errors.length) {
    console.log("");
    console.log("Erros:");
    for (const error of report.errors) console.log(`- ${error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
