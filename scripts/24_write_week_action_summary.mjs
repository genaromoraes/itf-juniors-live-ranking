import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { summarizeWeekCompletion } from "./lib/week_completion.mjs";

const CLEAN_DIR = path.resolve("data/clean");

async function readCsvIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parse(text, {
      columns: true,
      skip_empty_lines: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekEnd(tournaments) {
  return tournaments
    .map((row) => cleanText(row.end_date))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function escapeMarkdownCell(value) {
  return cleanText(value).replaceAll("|", "\\|") || "-";
}

function statusLabel(status) {
  if (status === "completed") return "concluido";
  if (status === "pending") return "pendente";
  if (status === "review_required") return "revisar";
  return cleanText(status) || "-";
}

function buildSummaryMarkdown({ completion, scrapedWithFreshData }) {
  const tournaments = completion.tournaments || [];
  const pendingTournaments = tournaments
    .filter((item) => toNumber(item.pending_matches) > 0 || item.status !== "completed")
    .sort((a, b) =>
      toNumber(b.pending_matches) - toNumber(a.pending_matches) ||
      cleanText(a.tournament_name).localeCompare(cleanText(b.tournament_name), "pt-BR")
    );
  const rows = pendingTournaments.length ? pendingTournaments : tournaments;

  const lines = [
    "## Resumo da raspagem semanal",
    "",
    `- Fonte dos dados: ${scrapedWithFreshData ? "raspagem ITF fresca" : "cache/local"}`,
    `- Torneios: ${completion.tournaments_completed}/${completion.tournaments_total} concluidos`,
    `- Eventos: ${completion.events_completed}/${completion.events_total} concluidos`,
    `- Partidas pendentes: ${completion.pending_matches}`,
    `- Eventos ausentes: ${completion.missing_events}`,
    `- Erros de coleta: ${completion.results_errors}`,
    "",
    "### Partidas pendentes por torneio",
    "",
  ];

  if (!rows.length) {
    lines.push("Nenhum torneio encontrado nos artefatos da semana.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Torneio | Categoria | Status | Eventos | Partidas | Pendentes | Ausentes | Erros |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |");

  for (const tournament of rows) {
    lines.push([
      escapeMarkdownCell(tournament.tournament_name),
      escapeMarkdownCell(tournament.category),
      escapeMarkdownCell(statusLabel(tournament.status)),
      `${toNumber(tournament.events_completed)}/${toNumber(tournament.events_total)}`,
      String(toNumber(tournament.matches_found)),
      String(toNumber(tournament.pending_matches)),
      String(toNumber(tournament.missing_events)),
      String(toNumber(tournament.results_errors)),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  if (!pendingTournaments.length) {
    lines.push("");
    lines.push("Todos os torneios encontrados aparecem sem partidas pendentes.");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [
    weekTournamentRows,
    weekMatchesRows,
    weekResultsSummaryRows,
    weekResultsErrorsRows,
  ] = await Promise.all([
    readCsvIfExists(path.join(CLEAN_DIR, "week_tournaments.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_matches.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_results_summary.csv")),
    readCsvIfExists(path.join(CLEAN_DIR, "week_results_errors.csv")),
  ]);

  const completion = summarizeWeekCompletion({
    weekTournamentRows,
    weekMatchesRows,
    weekResultsSummaryRows,
    weekResultsErrorsRows,
    currentDate: todayIsoDate(),
    weekEnd: getWeekEnd(weekTournamentRows),
  });
  const markdown = buildSummaryMarkdown({
    completion,
    scrapedWithFreshData: process.env.ITF_SCRAPE_FRESH === "true",
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
