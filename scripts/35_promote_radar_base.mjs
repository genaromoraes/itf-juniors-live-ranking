import { promoteRadar1500Base } from "./lib/radar_promotion.mjs";

const confirm = process.argv.includes("--confirm=true");
const baseArg = process.argv.find((value) => value.startsWith("--base-dir="));
const baseDir = baseArg ? baseArg.slice("--base-dir=".length) : undefined;

try {
  const result = await promoteRadar1500Base({ confirm, baseDir });
  if (!confirm) {
    console.log("Dry-run da promoção RADAR1500.");
    console.log(`Staging válido: ${result.valid ? "sim" : "não"}`);
    console.log(`Estado atual: ${result.current_state}`);
    console.log(`Estado alvo: ${result.target_state}`);
    for (const error of result.errors) console.log(`- ${error}`);
    console.log("Nenhum arquivo de produção foi modificado.");
    console.log("Para promover, execute: npm run base:radar:promote -- --confirm=true");
  } else if (result.already_active) {
    console.log("RADAR1500 já está ativo e os arquivos são idênticos ao staging.");
  } else {
    console.log("Base RADAR1500 promovida com sucesso.");
    console.log(`Backup: ${result.backup_dir}`);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
