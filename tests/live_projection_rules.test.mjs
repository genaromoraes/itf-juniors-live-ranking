import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWeekParticipationMap } from "../scripts/09_generate_live_ranking_html.mjs";

test("qualifying players stay out of main-draw projection scenarios", () => {
  const map = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J300-GBR-2026-001",
        tournament_name: "J300 Roehampton",
        category: "J300",
        end_date: "2026-07-04",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "B",
        event_classification_code: "Q",
        event_classification_desc: "Qualifying",
        highest_round_order: "2",
        highest_round_name: "2nd Round",
        status: "still_alive_or_champion",
      },
    ],
    [],
    [
      {
        tournament_key: "J-J300-GBR-2026-001",
        player_type_code: "B",
        match_type_code: "S",
        event_classification_code: "Q",
        round_order: "3",
      },
    ]
  );

  const participation = map.get("1");

  assert.ok(participation);
  assert.equal(participation.singlesProjectionEligible, false);
  assert.equal(participation.singlesRound, "");
});

test("main-draw rows remain projection-eligible", () => {
  const map = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J300-GBR-2026-001",
        tournament_name: "J300 Roehampton",
        category: "J300",
        end_date: "2026-07-04",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "B",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "1",
        highest_round_name: "1st Round",
        status: "still_alive_or_champion",
      },
    ],
    [],
    [
      {
        tournament_key: "J-J300-GBR-2026-001",
        player_type_code: "B",
        match_type_code: "S",
        event_classification_code: "M",
        round_order: "5",
      },
    ]
  );

  const participation = map.get("1");

  assert.ok(participation);
  assert.equal(participation.singlesProjectionEligible, true);
  assert.notEqual(participation.singlesRound, "");
});
