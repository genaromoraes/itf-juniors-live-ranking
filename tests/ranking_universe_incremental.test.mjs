import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "csv-parse/sync";
import {
  collectRankingUniverseIncremental,
} from "../scripts/03_fetch_rankings_universe.mjs";
import {
  mergeSeedAndUniverse,
  validateLegacySeed,
} from "../scripts/22_prepare_top1000_base.mjs";
import {
  universeRowsToPlayers,
  universeRowsToSnapshot,
} from "../scripts/lib/top1000_migration.mjs";

function rawPlayer({ rank, idPrefix = "m", points = 100 }) {
  return {
    rank,
    playerId: `${idPrefix}${rank}`,
    playerName: `Player ${idPrefix}${rank}`,
    nationCode: "BRA",
    points,
  };
}

function rawPage({ startRank, count, idPrefix = "m", rankingDate = "2026-06-15" }) {
  return {
    json: { rankingDate, rows: Array.from({ length: count }, (_, i) => rawPlayer({ rank: startRank + i, idPrefix })) },
    rows: Array.from({ length: count }, (_, i) => rawPlayer({ rank: startRank + i, idPrefix })),
    url: `https://example.test/rankings?skip=${startRank - 1}`,
  };
}

async function readCsv(filePath) {
  return parse(await fs.readFile(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function makeRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "ranking-universe-"));
}

describe("incremental ranking universe collection", () => {
  test("valid page is persisted before the next request", async () => {
    const root = await makeRoot();
    const calls = [];
    const result = await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 200,
      pageSize: 100,
      startRank: 501,
      endRank: 700,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      maxPagesPerRun: 1,
      wait: async () => {},
      fetchPage: async (gender, take, skip) => {
        calls.push({ gender: gender.gender, take, skip });
        return rawPage({ startRank: skip + 1, count: take, idPrefix: "m" });
      },
    });

    const page = await readJson(path.join(root, "raw/pages/M_skip_0500.json"));
    const partial = await readCsv(path.join(root, "raw/partial_M.csv"));

    assert.equal(result.status, "PARTIAL");
    assert.equal(calls.length, 1);
    assert.equal(page.normalized_rows.length, 100);
    assert.equal(partial.length, 100);
  });

  test("failure on the second page preserves the first and marks BLOCKED", async () => {
    const root = await makeRoot();
    const result = await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 200,
      pageSize: 100,
      startRank: 501,
      endRank: 700,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => {
        if (skip === 600) {
          const err = new Error("Incapsula block");
          err.isBlocked = true;
          throw err;
        }
        return rawPage({ startRank: skip + 1, count: take, idPrefix: "m" });
      },
    });

    assert.equal(result.status, "BLOCKED");
    assert.equal(await exists(path.join(root, "raw/pages/M_skip_0500.json")), true);
    assert.equal(await exists(path.join(root, "raw/pages/M_skip_0600.json")), false);
    assert.equal((await readCsv(path.join(root, "raw/partial_M.csv"))).length, 100);
  });

  test("resume starts on the first missing page and does not refetch completed pages", async () => {
    const root = await makeRoot();
    await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 200,
      pageSize: 100,
      startRank: 501,
      endRank: 700,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      maxPagesPerRun: 1,
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => rawPage({ startRank: skip + 1, count: take, idPrefix: "m" }),
    });
    const calls = [];
    await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 200,
      pageSize: 100,
      startRank: 501,
      endRank: 700,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      maxPagesPerRun: 1,
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => {
        calls.push(skip);
        return rawPage({ startRank: skip + 1, count: take, idPrefix: "m" });
      },
    });

    assert.deepEqual(calls, [600]);
    assert.equal((await readCsv(path.join(root, "raw/partial_M.csv"))).length, 200);
  });

  test("two executions do not duplicate players", async () => {
    const root = await makeRoot();
    const options = {
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 100,
      pageSize: 100,
      startRank: 501,
      endRank: 600,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => rawPage({ startRank: skip + 1, count: take, idPrefix: "m" }),
    };
    await collectRankingUniverseIncremental(options);
    await collectRankingUniverseIncremental(options);

    assert.equal((await readCsv(path.join(root, "raw/partial_M.csv"))).length, 100);
  });

  test("max-pages-per-run=1 exits as PARTIAL without error", async () => {
    const root = await makeRoot();
    const result = await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 200,
      pageSize: 100,
      startRank: 501,
      endRank: 700,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      maxPagesPerRun: 1,
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => rawPage({ startRank: skip + 1, count: take, idPrefix: "m" }),
    });

    assert.equal(result.status, "PARTIAL");
    assert.equal(result.pagesFetched, 1);
  });

  test("restart archives the previous collection", async () => {
    const root = await makeRoot();
    const rawDir = path.join(root, "raw");
    const options = {
      rawDir,
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 100,
      pageSize: 100,
      startRank: 501,
      endRank: 600,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      wait: async () => {},
      fetchPage: async (_gender, take, skip) => rawPage({ startRank: skip + 1, count: take, idPrefix: "m" }),
    };
    await collectRankingUniverseIncremental(options);
    await collectRankingUniverseIncremental({ ...options, restart: true });
    const archiveRoot = path.join(rawDir, "archive");

    assert.equal(await exists(archiveRoot), true);
    assert.ok((await fs.readdir(archiveRoot)).length >= 1);
  });

  test("incompatible ranking_date invalidates the collection", async () => {
    const root = await makeRoot();
    const result = await collectRankingUniverseIncremental({
      rawDir: path.join(root, "raw"),
      outputFile: path.join(root, "out.csv"),
      targetPerGender: 100,
      pageSize: 100,
      startRank: 501,
      endRank: 600,
      genders: [{ label: "boys", gender: "M", itfCode: "B", manifestKey: "boys" }],
      rankingDate: "2026-06-15",
      wait: async () => {},
      fetchPage: async (_gender, take, skip) =>
        rawPage({ startRank: skip + 1, count: take, idPrefix: "m", rankingDate: "2026-06-22" }),
    });

    assert.equal(result.status, "INVALID");
    assert.match(result.manifest.last_error, /ranking_date incompativel/);
  });

  test("prepare helpers reuse production 1-500 and merge only 501-1000", () => {
    const seed = [
      ...Array.from({ length: 500 }, (_, i) => snapshotRow(i + 1, "M")),
      ...Array.from({ length: 500 }, (_, i) => snapshotRow(i + 1, "F")),
    ];
    const productionPlayers = universeRowsToPlayers(seed);
    validateLegacySeed(productionPlayers, seed);
    const universe = [
      ...Array.from({ length: 500 }, (_, i) => snapshotRow(i + 501, "M", "x")),
      ...Array.from({ length: 500 }, (_, i) => snapshotRow(i + 501, "F", "y")),
    ];
    const merged = mergeSeedAndUniverse(seed, universe);

    assert.equal(merged.length, 2000);
    assert.equal(merged.filter((row) => row.gender === "M" && Number(row.rank) <= 500).length, 500);
    assert.equal(merged.filter((row) => row.gender === "M" && Number(row.rank) >= 501).length, 500);
  });
});

function snapshotRow(rank, gender, prefix = gender.toLowerCase()) {
  return {
    ranking_date: "2026-06-15",
    gender,
    rank: String(rank),
    player_id: `${prefix}${rank}`,
    player_name: `Player ${prefix}${rank}`,
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    official_points: "100",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
