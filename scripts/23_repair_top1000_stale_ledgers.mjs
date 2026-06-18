import { pathToFileURL } from "node:url";
import { runTop1000StaleRepair } from "./lib/top1000_stale_repair.mjs";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    manifest: "",
    confirm: false,
  };

  for (const arg of argv) {
    if (arg === "--force" || arg.startsWith("--force=")) {
      throw new Error("--force nao e aceito por este reparo.");
    }
    if (arg.startsWith("--manifest=")) {
      args.manifest = cleanText(arg.slice("--manifest=".length).replace(/^"|"$/g, ""));
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      args.confirm = cleanText(arg.slice("--confirm=".length)).toLowerCase() === "true";
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return args;
}

async function main() {
  const args = parseArgs();
  const { report } = await runTop1000StaleRepair({
    manifestPath: args.manifest,
    confirm: args.confirm,
  });

  console.log("");
  console.log("Reparo Top 1000 de ledgers defasados");
  console.log(`Modo: ${report.mode}`);
  console.log(`Manifesto: ${report.manifest_path}`);
  console.log(`Manifesto hash: ${report.manifest_sha256}`);
  console.log(`Ledger origem: ${report.source_ledger_rows} linhas`);
  console.log(`Ledger candidato: ${report.candidate_ledger_rows} linhas`);
  console.log(`Reparados: ${report.repaired_players}`);
  console.log(`Preservados: ${report.preserved_players}`);
  console.log(
    `Reconciliacao antes: ${report.reconciliation_before}/${report.reconciliation_before_total}`
  );
  console.log(
    `Reconciliacao depois: ${report.reconciliation_after}/${report.reconciliation_after_total}`
  );
  console.log(`Hash candidato: ${report.candidate_ledger_sha256}`);
  if (report.backup_path) {
    console.log(`Backup: ${report.backup_path}`);
  }
  console.log(`Relatorio: ${report.report_path}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
