import fs from "node:fs/promises";
import path from "node:path";

export const LEDGER_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "country",
  "country_name",
  "birth_year",
  "event_type",
  "countable_status",
  "tournament_name",
  "category",
  "draw_type",
  "host_nation",
  "host_nation_code",
  "surface",
  "surface_code",
  "start_date",
  "drop_date_calculated",
  "round",
  "points",
  "tournament_link",
  "is_countable_at_collection",
  "is_live",
  "status",
  "source_url",
  "collected_at",
  "raw_json",
];

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : "";
}

export function normalizeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `https://www.itftennis.com${raw}`;
  return raw;
}

export function parseItfDate(value) {
  const text = cleanText(value);
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

export function calculateDropDate(startDateRaw) {
  const normalized = parseItfDate(startDateRaw);
  if (!normalized.match(/^\d{4}-\d{2}-\d{2}$/)) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 364);
  return date.toISOString().slice(0, 10);
}

export function buildRankingPointsUrl(playerId, matchTypeCode = "S") {
  const params = new URLSearchParams({
    circuitCode: "JT",
    matchTypeCode,
    playerId: String(playerId),
  });

  return `https://www.itftennis.com/tennis/api/PlayerRankApi/GetRankingPoints?${params.toString()}`;
}

export function detectBlockedHtml(result) {
  const contentType = String(result?.contentType || "").toLowerCase();
  const textStart = String(result?.textStart || "").toLowerCase();
  return (
    contentType.includes("text/html") ||
    textStart.includes("_incapsula_resource") ||
    textStart.includes("incapsula") ||
    textStart.includes("imperva") ||
    textStart.includes("<html")
  );
}

export async function fetchJsonInsideBrowser(page, url, timeoutMs = 30000) {
  return await page.evaluate(
    async ({ url, timeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
          headers: { accept: "application/json, text/plain, */*" },
        });
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();

        try {
          return {
            ok: response.ok,
            status: response.status,
            contentType,
            textStart: "",
            json: JSON.parse(text),
            timedOut: false,
          };
        } catch {
          return {
            ok: response.ok,
            status: response.status,
            contentType,
            textStart: text.slice(0, 500),
            json: null,
            timedOut: false,
          };
        }
      } catch (err) {
        const timedOut = err?.name === "AbortError";
        return {
          ok: false,
          status: 0,
          contentType: "",
          textStart: timedOut
            ? `Request timeout after ${timeoutMs}ms`
            : String(err?.message || err),
          json: null,
          timedOut,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { url, timeoutMs }
  );
}

export function normalizeBreakdownRow({
  player,
  sectionTitle,
  countableStatus,
  item,
  sourceUrl,
  status = "confirmed_from_breakdown",
}) {
  const eventType = String(sectionTitle || "").toLowerCase().includes("double")
    ? "doubles"
    : "singles";
  const startDate = parseItfDate(item.startDate);

  return {
    player_id: cleanText(player.player_id),
    player_name: cleanText(player.player_name),
    gender: cleanText(player.gender),
    country: cleanText(player.country),
    country_name: cleanText(player.country_name),
    birth_year: cleanText(player.birth_year),
    event_type: eventType,
    countable_status: countableStatus,
    tournament_name: cleanText(item.tournamentName),
    category: cleanText(item.category),
    draw_type: cleanText(item.drawType),
    host_nation: cleanText(item.hostNation),
    host_nation_code: cleanText(item.hostNationCode),
    surface: cleanText(item.surfaceDesc),
    surface_code: cleanText(item.surfaceCode),
    start_date: startDate,
    drop_date_calculated: calculateDropDate(item.startDate),
    round: cleanText(item.round),
    points: toNumber(item.points),
    tournament_link: normalizeUrl(item.tournamentLink),
    is_countable_at_collection: countableStatus === "countable" ? "true" : "false",
    is_live: "false",
    status,
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
    raw_json: JSON.stringify(item),
  };
}

export function extractLedgerRowsFromRankingPoints(json, player, sourceUrl, options = {}) {
  const rows = [];
  const sections = json?.countable || [];

  for (const section of sections) {
    const sectionTitle = section.title || "";
    const countableBreakdown = section?.countablePoints?.pointsBreakdown || [];
    const nonCountableBreakdown =
      section?.nonCountablePoints?.pointsBreakdown || [];

    for (const item of countableBreakdown) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "countable",
          item,
          sourceUrl,
          status: options.status,
        })
      );
    }

    for (const item of nonCountableBreakdown) {
      rows.push(
        normalizeBreakdownRow({
          player,
          sectionTitle,
          countableStatus: "non_countable",
          item,
          sourceUrl,
          status: options.status,
        })
      );
    }
  }

  return rows;
}

export function getRawBreakdownPath({ rawDir, rankingDate, player }) {
  return path.join(
    rawDir,
    `${cleanText(rankingDate) || "unknown"}_${cleanText(player.gender)}_${cleanText(player.current_rank || player.rank || player.official_rank)}_${cleanText(player.player_id)}.json`
  );
}

export async function readCachedBreakdown({ rawDir, rankingDate, player }) {
  const rawFile = getRawBreakdownPath({ rawDir, rankingDate, player });

  try {
    const parsed = JSON.parse(await fs.readFile(rawFile, "utf8"));
    if (parsed?.json) return { rawFile, sourceUrl: parsed.source_url, json: parsed.json };
  } catch {
    return null;
  }

  return null;
}

export async function saveRawBreakdown({ rawDir, rankingDate, player, sourceUrl, json }) {
  const rawFile = getRawBreakdownPath({ rawDir, rankingDate, player });
  await fs.mkdir(path.dirname(rawFile), { recursive: true });
  await fs.writeFile(
    rawFile,
    `${JSON.stringify({ player, source_url: sourceUrl, json }, null, 2)}\n`,
    "utf8"
  );
  return rawFile;
}

