import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPointDetailsMap } from "../scripts/09_generate_live_ranking_html.mjs";

test("point details hide drops already absorbed by the official ranking date", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "100",
        tournament_name: "J200 Gladbeck 2025",
        category: "J200",
        event_type: "singles",
        points: "140",
        countable_status: "countable",
        is_countable_at_collection: "true",
        drop_date_calculated: "2026-06-16",
      },
      {
        player_id: "100",
        tournament_name: "J200 Future Event",
        category: "J200",
        event_type: "singles",
        points: "140",
        countable_status: "countable",
        is_countable_at_collection: "true",
        drop_date_calculated: "2026-06-29",
      },
    ],
    [{ player_id: "100", ranking_date: "2026-06-22" }]
  );

  const details = map.get("100");

  assert.ok(details);
  assert.equal(details.drops.length, 1);
  assert.equal(details.drops[0].tournament, "J200 Future Event");
});

test("point details still show drops when there is no official ranking date yet", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "100",
        tournament_name: "J200 Gladbeck 2025",
        category: "J200",
        event_type: "singles",
        points: "140",
        countable_status: "countable",
        is_countable_at_collection: "true",
        drop_date_calculated: "2026-06-16",
      },
    ],
    [{ player_id: "100", ranking_date: "" }]
  );

  const details = map.get("100");

  assert.ok(details);
  assert.equal(details.drops.length, 1);
  assert.equal(details.drops[0].tournament, "J200 Gladbeck 2025");
});

test("point details explain negative drop balances even when dropped rows are marked non-countable", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "200",
        tournament_name: "J100 Veracruz",
        category: "J100",
        event_type: "doubles",
        points: "60",
        countable_status: "non_countable",
        is_countable_at_collection: "false",
        drop_date_calculated: "2026-06-22",
      },
    ],
    [
      {
        player_id: "200",
        ranking_date: "2026-06-22",
        points_change_vs_official: "-15",
        has_dropped_result: "true",
      },
    ],
    [{ week_start: "2026-06-22", week_end: "2026-06-28" }]
  );

  const details = map.get("200");

  assert.ok(details);
  assert.equal(details.drops.length, 1);
  assert.equal(details.drops[0].tournament, "J100 Veracruz");
  assert.equal(details.drops[0].impact_points, 15);
});

test("point details show current-week drops when the live balance is still negative", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "250",
        tournament_name: "J100 Almaty",
        category: "J100",
        event_type: "singles",
        points: "100",
        countable_status: "countable",
        is_countable_at_collection: "true",
        drop_date_calculated: "2026-06-22",
      },
    ],
    [
      {
        player_id: "250",
        ranking_date: "2026-06-22",
        points_change_vs_official: "-40",
        has_dropped_result: "true",
      },
    ],
    [{ week_start: "2026-06-22", week_end: "2026-06-28" }]
  );

  const details = map.get("250");

  assert.ok(details);
  assert.equal(details.drops.length, 1);
  assert.equal(details.drops[0].tournament, "J100 Almaty");
  assert.equal(details.drops[0].impact_points, 100);
});

test("point details hide old-week drops even when the live balance is still negative", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "275",
        tournament_name: "J100 Pazardzhik",
        category: "J100",
        event_type: "singles",
        points: "100",
        countable_status: "countable",
        is_countable_at_collection: "true",
        drop_date_calculated: "2026-06-15",
      },
    ],
    [
      {
        player_id: "275",
        ranking_date: "2026-06-22",
        points_change_vs_official: "-40",
        has_dropped_result: "true",
      },
    ],
    [{ week_start: "2026-06-22", week_end: "2026-06-28" }]
  );

  const details = map.get("275");

  assert.ok(details);
  assert.equal(details.drops.length, 0);
});

test("point details keep non-countable future drops hidden when there is no negative drop balance", () => {
  const map = buildPointDetailsMap(
    [],
    [
      {
        player_id: "300",
        tournament_name: "J100 Veracruz",
        category: "J100",
        event_type: "doubles",
        points: "60",
        countable_status: "non_countable",
        is_countable_at_collection: "false",
        drop_date_calculated: "2026-06-29",
      },
    ],
    [
      {
        player_id: "300",
        ranking_date: "2026-06-22",
        points_change_vs_official: "0",
        has_dropped_result: "false",
      },
    ]
  );

  const details = map.get("300");

  assert.ok(details);
  assert.equal(details.drops.length, 0);
});

test("point details hide counting live results when the net ranking change is zero", () => {
  const map = buildPointDetailsMap(
    [],
    [],
    [
      {
        player_id: "400",
        ranking_date: "2026-06-22",
        points_change_vs_official: "0",
        best_doubles_1: "27 pts | LIVE | J100 | SF | J100 Almaty | 2026-06-22 | drop",
      },
    ]
  );

  const details = map.get("400");

  assert.ok(details);
  assert.equal(details.live.length, 0);
  assert.equal(details.drops.length, 0);
});
