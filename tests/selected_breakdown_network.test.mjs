import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  MAX_RETRIES,
  NETWORK_MODE_AUTO,
  NETWORK_MODE_BROWSER,
  NETWORK_MODE_DIRECT,
  buildRankingPointsUrl,
  fetchSelectedBreakdowns,
} from "../scripts/lib/official_breakdown_reconciliation.mjs";

function player(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player One",
    gender: "M",
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    classification: "point_difference",
    ...overrides,
  };
}

function rankingPointsPayload(points = 100) {
  return {
    countable: [
      {
        title: "Singles",
        countablePoints: {
          pointsBreakdown: [
            {
              tournamentName: "J100 Test",
              category: "J100",
              drawType: "main_draw",
              startDate: "2026-01-01",
              round: "W",
              points,
              tournamentLink: "/en/tournament/test/",
            },
          ],
        },
        nonCountablePoints: {
          pointsBreakdown: [],
        },
      },
    ],
  };
}

async function createTempOutputDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "selected-breakdown-"));
}

async function writeCachedBreakdown(cacheDir, playerId, payload) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, `${playerId}.json`),
    JSON.stringify({
      player_id: playerId,
      source_url: buildRankingPointsUrl(playerId),
      json: payload,
    }),
    "utf8"
  );
}

describe("selected breakdown network collection", () => {
  test("direct mode fetches only GetRankingPoints for selected players", async () => {
    const outputDir = await createTempOutputDir();
    const selected = [player({ player_id: "p1" }), player({ player_id: "p2" })];
    const urls = [];

    const result = await fetchSelectedBreakdowns({
      players: selected,
      outputDir,
      networkMode: NETWORK_MODE_DIRECT,
      deps: {
        directRequest: async ({ url }) => {
          urls.push(url);
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(rankingPointsPayload()),
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.summaries.length, 2);
    assert.equal(result.networkReport.get_ranking_points_calls, 2);
    assert.equal(result.networkReport.get_rankings_calls, 0);
    assert.equal(urls.every((url) => url.includes("PlayerRankApi/GetRankingPoints")), true);
    assert.equal(urls.some((url) => url.includes("GetPlayerRankings")), false);
  });

  test("valid cache avoids network calls", async () => {
    const outputDir = await createTempOutputDir();
    const cacheFile = path.join(outputDir, "raw", "breakdowns", "p1.json");
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify({
        player_id: "p1",
        source_url: buildRankingPointsUrl("p1"),
        json: rankingPointsPayload(88),
      }),
      "utf8"
    );

    const result = await fetchSelectedBreakdowns({
      players: [player()],
      outputDir,
      networkMode: NETWORK_MODE_AUTO,
      deps: {
        directRequest: async () => {
          throw new Error("direct should not run");
        },
        browserRequest: async () => {
          throw new Error("browser should not run");
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.summaries[0].from_cache, "true");
    assert.equal(result.byPlayerId.get("p1")[0].points, 88);
    assert.equal(result.networkReport.get_ranking_points_calls, 0);
  });

  test("external cache with 57 valid JSONs makes zero network calls", async () => {
    const outputDir = await createTempOutputDir();
    const cacheDir = await createTempOutputDir();
    const selected = Array.from({ length: 57 }, (_, index) =>
      player({ player_id: `p${index + 1}` })
    );

    for (const selectedPlayer of selected) {
      await writeCachedBreakdown(
        cacheDir,
        selectedPlayer.player_id,
        rankingPointsPayload(100)
      );
    }

    const result = await fetchSelectedBreakdowns({
      players: selected,
      outputDir,
      breakdownCacheDir: cacheDir,
      networkMode: NETWORK_MODE_AUTO,
      deps: {
        directRequest: async () => {
          throw new Error("direct should not run");
        },
        browserRequest: async () => {
          throw new Error("browser should not run");
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.networkReport.cached_breakdowns, 57);
    assert.equal(result.networkReport.network_breakdowns, 0);
    assert.equal(result.networkReport.get_ranking_points_calls, 0);
    assert.equal(result.networkReport.breakdown_cache_dir, cacheDir);
    assert.equal(result.summaries.every((row) => row.from_cache === "true"), true);
    assert.ok(await fs.stat(path.join(outputDir, "raw", "breakdowns", "p1.json")));
  });

  test("partial external cache fetches only missing players", async () => {
    const outputDir = await createTempOutputDir();
    const cacheDir = await createTempOutputDir();
    await writeCachedBreakdown(cacheDir, "p1", rankingPointsPayload(100));
    let directCalls = 0;

    const result = await fetchSelectedBreakdowns({
      players: [player({ player_id: "p1" }), player({ player_id: "p2" })],
      outputDir,
      breakdownCacheDir: cacheDir,
      networkMode: NETWORK_MODE_DIRECT,
      deps: {
        directRequest: async ({ url }) => {
          directCalls += 1;
          assert.match(url, /playerId=p2/);
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(rankingPointsPayload(80)),
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(directCalls, 1);
    assert.equal(result.networkReport.cached_breakdowns, 1);
    assert.equal(result.networkReport.network_breakdowns, 1);
    assert.equal(result.networkReport.get_ranking_points_calls, 1);
  });

  test("invalid external cache is rejected and fetched again", async () => {
    const outputDir = await createTempOutputDir();
    const cacheDir = await createTempOutputDir();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "p1.json"), JSON.stringify({ countable: [] }), "utf8");
    let directCalls = 0;

    const result = await fetchSelectedBreakdowns({
      players: [player()],
      outputDir,
      breakdownCacheDir: cacheDir,
      networkMode: NETWORK_MODE_DIRECT,
      deps: {
        directRequest: async () => {
          directCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(rankingPointsPayload(70)),
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(directCalls, 1);
    assert.equal(result.networkReport.cached_breakdowns, 0);
    assert.equal(result.networkReport.network_breakdowns, 1);
    assert.equal(result.summaries[0].from_cache, "false");
  });

  test("invalid cache is ignored and refreshed", async () => {
    const outputDir = await createTempOutputDir();
    const cacheFile = path.join(outputDir, "raw", "breakdowns", "p1.json");
    let directCalls = 0;
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify({ countable: [] }), "utf8");

    const result = await fetchSelectedBreakdowns({
      players: [player()],
      outputDir,
      networkMode: NETWORK_MODE_DIRECT,
      deps: {
        directRequest: async () => {
          directCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(rankingPointsPayload(77)),
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(directCalls, 1);
    assert.equal(result.summaries[0].from_cache, "false");
    assert.equal(result.byPlayerId.get("p1")[0].points, 77);
  });

  test("auto mode tries browser after direct HTML block", async () => {
    const outputDir = await createTempOutputDir();
    let directCalls = 0;
    let browserCalls = 0;

    const result = await fetchSelectedBreakdowns({
      players: [player()],
      outputDir,
      networkMode: NETWORK_MODE_AUTO,
      deps: {
        directRequest: async () => {
          directCalls += 1;
          return {
            status: 403,
            contentType: "text/html",
            text: "<html>_Incapsula_Resource</html>",
          };
        },
        browserRequest: async () => {
          browserCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(rankingPointsPayload(66)),
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(directCalls, MAX_RETRIES);
    assert.equal(browserCalls, 1);
    assert.equal(result.networkReport.http_403, MAX_RETRIES);
    assert.equal(result.networkReport.incapsula_responses, MAX_RETRIES);
    assert.equal(result.byPlayerId.get("p1")[0].points, 66);
  });

  test("browser mode records failure without retrying unselected players", async () => {
    const outputDir = await createTempOutputDir();
    let browserCalls = 0;

    const result = await fetchSelectedBreakdowns({
      players: [player({ player_id: "p1" })],
      outputDir,
      networkMode: NETWORK_MODE_BROWSER,
      deps: {
        browserRequest: async () => {
          browserCalls += 1;
          return {
            status: 200,
            contentType: "text/html",
            text: "<html>Imperva captcha</html>",
          };
        },
        sleep: async () => {},
      },
    });

    assert.equal(browserCalls, MAX_RETRIES);
    assert.equal(result.errors.length, 1);
    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0].player_id, "p1");
    assert.equal(result.networkReport.get_rankings_calls, 0);
    assert.equal(result.networkReport.imperva_responses, MAX_RETRIES);
  });

  test("timeout is recorded in the network report", async () => {
    const outputDir = await createTempOutputDir();

    const result = await fetchSelectedBreakdowns({
      players: [player()],
      outputDir,
      networkMode: NETWORK_MODE_DIRECT,
      deps: {
        directRequest: async () => {
          const error = new Error("Request timeout after 90000ms");
          error.name = "AbortError";
          throw error;
        },
        sleep: async () => {},
      },
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.networkReport.timeouts, MAX_RETRIES);
    assert.match(result.errors[0].error_message, /timeout/i);
  });
});
