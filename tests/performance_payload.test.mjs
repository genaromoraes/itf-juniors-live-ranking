import assert from "node:assert/strict";
import test from "node:test";

import { buildDeliveryPayload } from "../scripts/09_generate_live_ranking_html.mjs";

test("delivery payload keeps the initial ranking lean and chunks compact player details", () => {
  const data = [
    {
      live_rank: 1,
      official_rank: 2,
      rank_change_vs_official: 1,
      player_id: "player-1",
      player_name: "Atleta Um",
      gender: "F",
      country: "BRA",
      country_iso2: "br",
      country_name: "Brazil",
      birth_year: "2010",
      official_points: 90,
      live_points: 100,
      points_change_vs_official: 10,
      playing_this_week: "",
      point_details: { live: [], drops: [] },
      next_round_scenarios: [],
      title_scenarios: [],
      best_singles: ["campo grande sem uso na tabela"],
      calculated_at: "2026-08-23T00:00:00.000Z",
      point_cartel: {
        singles: [
          {
            eventType: "singles",
            tournament: "J100 Teste",
            category: "J100",
            round: "W",
            date: "2026-08-23",
            points: 100,
            surface: "Clay",
            surfaceCode: "C",
            surfaceKey: "clay",
            source: "BASE",
            counting: true,
          },
        ],
        doubles: [],
      },
    },
  ];

  const { rankingData, detailChunks } = buildDeliveryPayload(data, 100);

  assert.equal(rankingData.length, 1);
  assert.equal(rankingData[0].details_chunk, 0);
  assert.equal("point_cartel" in rankingData[0], false);
  assert.equal("best_singles" in rankingData[0], false);
  assert.equal("calculated_at" in rankingData[0], false);
  assert.deepEqual(detailChunks[0]["player-1"], {
    s: [["J100 Teste", "J100", "W", "2026-08-23", 100, "Clay", "C", "clay", "BASE", 1]],
    d: [],
  });
});
