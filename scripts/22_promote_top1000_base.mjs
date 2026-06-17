import { promoteTop1000Base } from "./lib/top1000_migration.mjs";

function hasConfirm() {
  return process.argv.includes("--confirm=true");
}

async function main() {
  const result = await promoteTop1000Base({ confirm: hasConfirm() });

  if (!hasConfirm()) {
    console.log("Dry-run da promocao Top 1000.");
    console.log("Nenhum arquivo de producao foi modificado.");
    console.log(`Staging valido: ${result.valid ? "sim" : "nao"}`);
    if (result.errors.length) {
      console.log("Erros:");
      for (const error of result.errors) console.log(`- ${error}`);
    }
    console.log("Para promover, execute: npm run base:top1000:promote -- --confirm=true");
    return;
  }

  console.log("Base Top 1000 promovida com sucesso.");
  console.log(`Backup: ${result.backup_dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
