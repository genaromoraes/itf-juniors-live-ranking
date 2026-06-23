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

  test("ignores stale future placements after an event final is completed", () => {
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
                  playStatusDesc: "Played and completed",
                  teams: [
                    { ...team("800000001", "Ana", "Winner"), isWinner: true },
                    team("800000002", "Bella", "Loser"),
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
                    team("800000001", "Ana", "Winner"),
                    team("800000003", "Clara", "Other"),
                  ],
                },
                {
                  matchId: "sf-2",
                  playStatusCode: "PC",
                  playStatusDesc: "Played and completed",
                  teams: [
                    { ...team("800000004", "Duda", "Finalist"), isWinner: true },
                    team("800000005", "Eva", "Semifinalist"),
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
                  playStatusCode: "PC",
                  playStatusDesc: "Played and completed",
                  teams: [
                    { ...team("800000004", "Duda", "Finalist"), isWinner: true },
                    team("800000006", "Fernanda", "Runnerup"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const matches = extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament);
    const playerResults = buildPlayerResultsFromMatches(matches);
    const ana = playerResults.find((row) => row.player_id === "800000001");
    const duda = playerResults.find((row) => row.player_id === "800000004");

    assert.equal(ana.highest_round_name, "Quarter-finals");
    assert.equal(ana.status, "eliminated");
    assert.equal(duda.highest_round_name, "Final");
    assert.equal(duda.status, "champion");
  });

  test("extracts round-robin groups as participation without awarding live points", () => {
    const drawsheet = {
      eventId: "event-girls-round-robin",
      rrGroups: [
        {
          groupName: "Group E",
          teams: [
            {
              ...team("800700001", "Kauany", "Rodrigues"),
              matches: [
                {
                  matchId: "rr-1",
                  playStatusCode: "TP",
                  playStatusDesc: "To be played",
                  teams: [
                    team("800700001", "Kauany", "Rodrigues"),
                    team("800700002", "Luisa", "Fusil", "SLO"),
                  ],
                },
              ],
            },
            team("800700002", "Luisa", "Fusil", "SLO"),
          ],
        },
      ],
    };

    const matches = extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament);
    const rrMatch = matches.find((row) => row.match_id === "rr-1");

    assert.equal(matches.length, 1);
    assert.equal(rrMatch.drawsheet_structure_code, "RR");
    assert.equal(rrMatch.drawsheet_structure_desc, "Round-robin");
    assert.equal(rrMatch.round_name, "Round-robin");
    assert.equal(rrMatch.group_name, "Group E");

    const playerResults = buildPlayerResultsFromMatches(matches);
    const kauany = playerResults.find((row) => row.player_id === "800700001");

    assert.ok(kauany);
    assert.equal(kauany.highest_round_name, "Round-robin");
    assert.equal(kauany.status, "round_robin");

    const livePoints = buildLivePointRows(playerResults, matches, new Map()).find(
      (row) => row.player_id === "800700001"
    );

    assert.equal(livePoints.calculated_round_label, "RR");
    assert.equal(livePoints.live_points_raw, 0);
  });

  test("creates round-robin participation from group teams when matches are absent", () => {
    const drawsheet = {
      eventId: "event-girls-round-robin",
      rrGroups: [
        {
          groupName: "Group E",
          teams: [
            team("800700001", "Kauany", "Rodrigues"),
            team("800700002", "Luisa", "Fusil", "SLO"),
          ],
        },
      ],
    };

    const matches = extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament);
    const playerResults = buildPlayerResultsFromMatches(matches);
    const playerIds = new Set(playerResults.map((row) => row.player_id));

    assert.equal(matches.length, 2);
    assert.ok(playerIds.has("800700001"));
    assert.ok(playerIds.has("800700002"));
    assert.equal(
      playerResults.find((row) => row.player_id === "800700001").status,
      "round_robin"
    );
  });
});
