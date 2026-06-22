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
