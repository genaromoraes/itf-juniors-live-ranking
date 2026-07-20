import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  NETWORK_MODE_AUTO,
  NETWORK_MODE_BROWSER,
  NETWORK_MODE_DIRECT,
  buildBaselineValidation,
  buildRankingPagePlan,
  buildOutputPaths,
  collectOfficialRanking,
  createDefaultNetworkReport,
  isClosedWeekLedgerRow,
  writeNetworkArtifacts,
} from "../scripts/18_validate_staged_ledger_against_official.mjs";
import { BASELINE_POLICY } from "../scripts/lib/official_ledger_validation.mjs";

function makeArgs(outputDir, networkMode) {
  return {
    rankingDate: "2026-06-15",
    outputDir,
    networkMode,
  };
}

function makePagePlan() {
  return [
    {
      genderInfo: { label: "male", gender: "M", itfCode: "B" },
      skip: 0,
      url: "https://www.itftennis.com/tennis/api/PlayerRankApi/GetPlayerRankings?playerTypeCode=B&skip=0&take=100",
    },
  ];
}

function makePayload(genderInfo, skip, rankDate = "2026-06-15") {
  return {
    rankDate,
    items: Array.from({ length: 100 }, (_, index) => {
      const rank = skip + index + 1;
      return {
        playerId: `${genderInfo.gender}${rank}`,
        fullName: `${genderInfo.gender} Player ${rank}`,
        playerGivenName: genderInfo.gender,
        playerFamilyName: `Player ${rank}`,
        playerNationalityCode: "BRA",
        playerNationality: "Brazil",
        rank,
        points: 1000 - rank,
      };
    }),
  };
}

function ledgerRow(overrides = {}) {
  return {
    player_id: "p1",
    player_name: "Player One",
    gender: "M",
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    event_type: "singles",
    countable_status: "countable",
    tournament_name: "Old Tournament",
    category: "J100",
    draw_type: "main_draw",
    host_nation: "Brazil",
    host_nation_code: "BRA",
    surface: "Clay",
    surface_code: "C",
    start_date: "2026-01-01",
    drop_date_calculated: "2026-12-31",
    round: "W",
    points: "100",
    tournament_link: "",
    is_countable_at_collection: "true",
    is_live: "false",
    status: "confirmed_official_reconciliation",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
    raw_json: "{}",
    ...overrides,
  };
}

function snapshotRow(overrides = {}) {
  return {
    ranking_date: "2026-06-15",
    gender: "M",
    rank: "1",
    player_id: "p1",
    player_name: "Player One",
    country: "BRA",
    country_name: "Brazil",
    birth_year: "2009",
    official_points: "100",
    source_url: "",
    collected_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

async function createTempOutputDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "official-network-test-"));
}

describe("official ranking network modes", () => {
  test("official ranking collection plans the full tracked Top 1000 per gender", () => {
    const plan = buildRankingPagePlan();
    const maleSkips = plan
      .filter((page) => page.genderInfo.gender === "M")
      .map((page) => page.skip);
    const femaleSkips = plan
      .filter((page) => page.genderInfo.gender === "F")
      .map((page) => page.skip);

    assert.equal(plan.length, 20);
    assert.deepEqual(maleSkips, [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    assert.deepEqual(femaleSkips, [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  test("detects closed week rows that should be removed only for baseline reconstruction", () => {
    assert.equal(
      isClosedWeekLedgerRow(
        ledgerRow({
          status: "confirmed_from_week_close",
          start_date: "2026-06-15",
        }),
        "2026-06-15",
        "2026-06-21"
      ),
      true
    );
    assert.equal(
      isClosedWeekLedgerRow(
        ledgerRow({
          status: "confirmed_from_week_close",
          start_date: "2026-06-22",
        }),
        "2026-06-15",
        "2026-06-21"
      ),
      false
    );
    assert.equal(
      isClosedWeekLedgerRow(
        ledgerRow({
          status: "confirmed_official_reconciliation",
          start_date: "2026-06-15",
        }),
        "2026-06-15",
        "2026-06-21"
      ),
      false
    );
  });

  test("reconstructs the old baseline when current ledger already includes closed week rows", () => {
    const result = buildBaselineValidation({
      baselineLedgerRows: [
        ledgerRow({ points: "100" }),
        ledgerRow({
          tournament_name: "Week Tournament",
          status: "confirmed_from_week_close",
          start_date: "2026-06-15",
          points: "30",
        }),
      ],
      oldSnapshotRows: [snapshotRow({ official_points: "100" })],
      oldRankingDate: "2026-06-15",
      dropCutoff: "2026-06-21",
    });

    assert.equal(result.reconstructed, true);
    assert.equal(result.removedRows, 1);
    assert.equal(result.baseline.valid, true);
    assert.equal(result.baseline.exact, 1);
    assert.match(result.warnings[0], /Baseline antigo reconstruido/);
  });

  test("reconstructs the old baseline with the old official ranking cutoff", () => {
    const result = buildBaselineValidation({
      baselineLedgerRows: [
        ledgerRow({
          tournament_name: "Expired Tournament",
          drop_date_calculated: "2026-06-14",
          points: "40",
        }),
        ledgerRow({
          tournament_name: "Active Tournament",
          drop_date_calculated: "2026-12-31",
          points: "100",
        }),
      ],
      oldSnapshotRows: [snapshotRow({ official_points: "100" })],
      oldRankingDate: "2026-06-15",
      dropCutoff: "2026-06-21",
    });

    assert.equal(result.reconstructed, true);
    assert.equal(result.baselinePolicy, BASELINE_POLICY);
    assert.equal(result.baselineDropCutoff, "2026-06-14");
    assert.equal(result.baseline.valid, true);
    assert.equal(result.baseline.exact, 1);
    assert.match(result.warnings[0], /corte em 2026-06-14/);
  });

  test("direct returns valid JSON", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_DIRECT);
    const pagePlan = makePagePlan();
    let directCalls = 0;

    const result = await collectOfficialRanking(
      makeArgs(outputDir, NETWORK_MODE_DIRECT),
      outputPaths,
      {
        pagePlan,
        networkReport: report,
        directRequest: async ({ url }) => {
          directCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
            url,
          };
        },
        sleep: async () => {},
      }
    );

    assert.equal(directCalls, 1);
    assert.equal(result.snapshots.length, 100);
    assert.equal(report.direct_attempts, 1);
    assert.equal(report.browser_attempts, 0);
    assert.equal(report.get_ranking_points_calls, 0);
  });

  test("direct HTML and auto calls browser", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_AUTO);
    const pagePlan = makePagePlan();
    let directCalls = 0;
    let browserCalls = 0;

    const result = await collectOfficialRanking(
      makeArgs(outputDir, NETWORK_MODE_AUTO),
      outputPaths,
      {
        pagePlan,
        networkReport: report,
        directRequest: async () => {
          directCalls += 1;
          return {
            status: 200,
            contentType: "text/html",
            text: "<html>Incapsula challenge</html>",
          };
        },
        browserRequest: async () => {
          browserCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
          };
        },
        sleep: async () => {},
      }
    );

    assert.equal(result.snapshots.length, 100);
    assert.equal(directCalls, 2);
    assert.equal(browserCalls, 1);
    assert.equal(report.direct_attempts, 2);
    assert.equal(report.browser_attempts, 1);
    assert.equal(report.html_responses, 2);
  });

  test("direct returns Incapsula and auto calls browser", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_AUTO);
    const pagePlan = makePagePlan();
    let browserCalls = 0;

    await collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_AUTO), outputPaths, {
      pagePlan,
      networkReport: report,
      directRequest: async () => ({
        status: 403,
        contentType: "text/html",
        text: "<html>_Incapsula_Resource blocked</html>",
      }),
      browserRequest: async () => {
        browserCalls += 1;
        return {
          status: 200,
          contentType: "application/json",
          text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
        };
      },
      sleep: async () => {},
    });

    assert.equal(browserCalls, 1);
    assert.equal(report.incapsula_responses >= 1, true);
    assert.equal(report.http_403 >= 1, true);
  });

  test("browser returns valid JSON", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_BROWSER);
    const pagePlan = makePagePlan();
    let browserCalls = 0;

    const result = await collectOfficialRanking(
      makeArgs(outputDir, NETWORK_MODE_BROWSER),
      outputPaths,
      {
        pagePlan,
        networkReport: report,
        browserRequest: async () => {
          browserCalls += 1;
          return {
            status: 200,
            contentType: "application/json",
            text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
          };
        },
        sleep: async () => {},
      }
    );

    assert.equal(browserCalls, 1);
    assert.equal(result.snapshots.length, 100);
    assert.equal(report.browser_attempts, 1);
  });

  test("browser blocked and failure still allows network report to be generated", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_AUTO);
    const pagePlan = makePagePlan();
    const attempts = [];

    await assert.rejects(
      collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_AUTO), outputPaths, {
        pagePlan,
        networkReport: report,
        attempts,
        directRequest: async () => ({
          status: 200,
          contentType: "text/html",
          text: "<html>Incapsula challenge</html>",
        }),
        browserRequest: async () => ({
          status: 200,
          contentType: "text/html",
          text: "<html>captcha required</html>",
        }),
        sleep: async () => {},
      })
    );

    report.finished_at = new Date().toISOString();
    report.failure_reason = "browser blocked";
    await writeNetworkArtifacts(outputPaths, attempts, report);
    const persisted = JSON.parse(
      await fs.readFile(outputPaths.networkReportFile, "utf8")
    );

    assert.equal(persisted.get_ranking_points_calls, 0);
    assert.equal(persisted.browser_attempts, 1);
    assert.equal(persisted.direct_attempts, 2);
  });

  test("valid cache avoids network call", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const pagePlan = makePagePlan();
    const cacheFile = path.join(outputPaths.rawRankingsDir, "M_skip_0.json");
    await fs.mkdir(outputPaths.rawRankingsDir, { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
      "utf8"
    );

    const result = await collectOfficialRanking(
      makeArgs(outputDir, NETWORK_MODE_AUTO),
      outputPaths,
      {
        pagePlan,
        networkReport: createDefaultNetworkReport(NETWORK_MODE_AUTO),
        directRequest: async () => {
          throw new Error("direct should not run");
        },
        browserRequest: async () => {
          throw new Error("browser should not run");
        },
        sleep: async () => {},
      }
    );

    assert.equal(result.snapshots.length, 100);
  });

  test("invalid cache is discarded", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_DIRECT);
    const pagePlan = makePagePlan();
    const cacheFile = path.join(outputPaths.rawRankingsDir, "M_skip_0.json");
    let directCalls = 0;

    await fs.mkdir(outputPaths.rawRankingsDir, { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify(makePayload(pagePlan[0].genderInfo, 0, "2026-06-08")),
      "utf8"
    );

    await collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_DIRECT), outputPaths, {
      pagePlan,
      networkReport: report,
      directRequest: async () => {
        directCalls += 1;
        return {
          status: 200,
          contentType: "application/json",
          text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
        };
      },
      sleep: async () => {},
    });

    assert.equal(directCalls, 1);
  });

  test("resume uses cache for completed pages and fetches only missing pages", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_DIRECT);
    const pagePlan = [
      makePagePlan()[0],
      {
        genderInfo: { label: "female", gender: "F", itfCode: "G" },
        skip: 0,
        url: "https://www.itftennis.com/tennis/api/PlayerRankApi/GetPlayerRankings?playerTypeCode=G&skip=0&take=100",
      },
    ];
    let directCalls = 0;

    await fs.mkdir(outputPaths.rawRankingsDir, { recursive: true });
    await fs.writeFile(
      path.join(outputPaths.rawRankingsDir, "M_skip_0.json"),
      JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
      "utf8"
    );

    const result = await collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_DIRECT), outputPaths, {
      pagePlan,
      networkReport: report,
      directRequest: async ({ url }) => {
        directCalls += 1;
        const targetPage = pagePlan.find((page) => page.url === url);
        return {
          status: 200,
          contentType: "application/json",
          text: JSON.stringify(makePayload(targetPage.genderInfo, targetPage.skip)),
        };
      },
      sleep: async () => {},
    });

    assert.equal(result.snapshots.length, 200);
    assert.equal(report.cached_pages, 1);
    assert.equal(directCalls, 1);
  });

  test("wrong rankDate blocks collection", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const pagePlan = makePagePlan();

    await assert.rejects(
      collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_DIRECT), outputPaths, {
        pagePlan,
        networkReport: createDefaultNetworkReport(NETWORK_MODE_DIRECT),
        directRequest: async () => ({
          status: 200,
          contentType: "application/json",
          text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0, "2026-06-08")),
        }),
        sleep: async () => {},
      }),
      /rankDate/
    );
  });

  test("network report never counts GetRankingPoints", async () => {
    const outputDir = await createTempOutputDir();
    const outputPaths = buildOutputPaths(outputDir);
    const report = createDefaultNetworkReport(NETWORK_MODE_DIRECT);
    const pagePlan = makePagePlan();

    await collectOfficialRanking(makeArgs(outputDir, NETWORK_MODE_DIRECT), outputPaths, {
      pagePlan,
      networkReport: report,
      directRequest: async () => ({
        status: 200,
        contentType: "application/json",
        text: JSON.stringify(makePayload(pagePlan[0].genderInfo, 0)),
      }),
      sleep: async () => {},
    });

    assert.equal(report.get_ranking_points_calls, 0);
    assert.equal(report.get_rankings_calls, 1);
  });
});
