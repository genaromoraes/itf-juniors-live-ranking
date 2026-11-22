import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarUrl } from "../scripts/04_fetch_week_tournaments.mjs";
import { buildEventFiltersUrl } from "../scripts/05_fetch_week_results.mjs";
import { buildRankingUrl } from "../scripts/lib/official_ledger_validation.mjs";
import { buildRankingPointsUrl } from "../scripts/lib/player_breakdown.mjs";

test("weekly and official requests start on the current World Tennis origin", () => {
  for (const url of [
    buildCalendarUrl({ skip: 0, take: 100, dateFrom: "2026-11-16", dateTo: "2026-11-22" }),
    buildEventFiltersUrl("j-j100-nor-2026-002"),
    buildRankingUrl({ itfCode: "G" }, 0),
    buildRankingPointsUrl("123456"),
  ]) {
    assert.equal(new URL(url).origin, "https://www.world.tennis");
  }
});
