import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPlayerResultsFromMatches,
  extractMatchesFromDrawsheet,
} from "../scripts/05_fetch_week_results.mjs";
import {
  buildPointsMap,
  buildLivePointRows,
} from "../scripts/06_calculate_week_live_points.mjs";

const eventInfo = {
  tournamentId: "1100209999",
  playerTypeCode: "G",
  playerTypeDesc: "Girls",
  matchTypeCode: "S",
  matchTypeDesc: "Singles",
  eventClassificationCode: "M",
  eventClassificationDesc: "Main Draw",
  drawsheetStructureCode: "KO",
  drawsheetStructureDesc: "Knock-out",
};

const tournament = {
  tournament_key: "J-J30-GBR-2026-001",
  tournament_name: "J30 Manchester",
  category: "J30",
  start_date: "2026-06-15",
  end_date: "2026-06-21",
};

function team(playerId, givenName, familyName, nationality = "BRA") {
  return {
    players: [{ playerId, givenName, familyName, nationality }],
  };
}

describe("week results walkover advancement", () => {
  test("infers a walkover winner from later KO round placement", () => {
    const drawsheet = {
      eventId: "event-girls-singles",
      koGroups: [
        {
          groupName: "Main Draw",
          rounds: [
            {
              roundName: "Quarter-finals",
              roundNumber: 1,
              matches: [
                {
                  matchId: "qf-1",
                  playStatusCode: "PC",
                  playStatusDesc: "Walkover",
                  teams: [
                    team("800756804", "Eduarda", "Gomes"),
                    team("900000001", "Mila", "Angrave", "GBR"),
                  ],
                },
              ],
            },
            {
              roundName: "Semi-finals",
              roundNumber: 2,
              matches: [
                {
                  matchId: "sf-1",
                  playStatusCode: "TP",
                  playStatusDesc: "To be played",
                  teams: [
                    team("800756804", "Eduarda", "Gomes"),
                    {},
                  ],
                },
              ],
            },
            {
              roundName: "Final",
              roundNumber: 3,
              matches: [
                {
                  matchId: "f-1",
                  playStatusCode: "TP",
                  playStatusDesc: "To be played",
                  teams: [{}, {}],
                },
              ],
            },
          ],
        },
      ],
    };

    const matches = extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament);
    const qf = matches.find((row) => row.match_id === "qf-1");

    assert.equal(qf.winner_side, 1);
    assert.equal(qf.winner_names, "Eduarda Gomes");

    const playerResults = buildPlayerResultsFromMatches(matches);
    const duda = playerResults.find((row) => row.player_id === "800756804");

    assert.equal(duda.wins, 1);
    assert.equal(duda.losses, 0);
    assert.equal(duda.highest_round_name, "Semi-finals");
    assert.equal(duda.status, "still_alive_or_champion");

    const pointsMap = buildPointsMap([
      {
        category: "J30",
        event_type: "singles",
        event_classification: "main_draw",
        round_label: "SF",
        points: "9",
      },
    ]);
    const [livePoints] = buildLivePointRows(playerResults, matches, pointsMap);

    assert.equal(livePoints.calculated_round_label, "SF");
    assert.equal(livePoints.live_points_raw, 9);
  });
});
