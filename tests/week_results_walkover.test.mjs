import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPlayerResultsFromMatches,
  extractMatchesFromDrawsheet,
  mergeFallbackMatches,
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

test("preserves only blocked draws from the previous package", () => {
  const currentMatches = [
    {
      tournament_key: tournament.tournament_key,
      player_type_code: "G",
      match_type_code: "S",
      event_classification_code: "M",
      match_id: "fresh-main",
      round_order: 1,
      team1_player_ids: "1",
      team2_player_ids: "2",
    },
  ];
  const errors = [
    {
      tournament_key: tournament.tournament_key,
      player_type_code: "G",
      match_type_code: "S",
      event_classification_code: "Q",
    },
  ];
  const fallbackMatches = [
    { ...currentMatches[0] },
    {
      tournament_key: tournament.tournament_key,
      player_type_code: "G",
      match_type_code: "S",
      event_classification_code: "Q",
      match_id: "previous-qualy",
      round_order: 1,
      team1_player_ids: "3",
      team2_player_ids: "4",
    },
    {
      tournament_key: tournament.tournament_key,
      player_type_code: "G",
      match_type_code: "S",
      event_classification_code: "M",
      match_id: "previous-main",
      round_order: 1,
      team1_player_ids: "5",
      team2_player_ids: "6",
    },
  ];

  const merged = mergeFallbackMatches(
    currentMatches,
    errors,
    fallbackMatches
  );

  assert.equal(merged.recovered.length, 1);
  assert.equal(merged.matches.length, 2);
  assert.equal(merged.recovered[0].match_id, "previous-qualy");
});

function team(playerId, givenName, familyName, nationality = "BRA") {
  return {
    players: [{ playerId, givenName, familyName, nationality }],
  };
}

describe("week results walkover advancement", () => {
  test("counts a not-played walkover as a win and an elimination", () => {
    const matches = [
      {
        tournament_key: tournament.tournament_key,
        tournament_name: tournament.tournament_name,
        category: tournament.category,
        start_date: tournament.start_date,
        end_date: tournament.end_date,
        player_type_code: "G",
        player_type_desc: "Girls",
        match_type_code: "S",
        match_type_desc: "Singles",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        drawsheet_structure_code: "KO",
        drawsheet_structure_desc: "Knock-out",
        round_name: "Quarter-finals",
        round_order: 1,
        match_id: "qf-wo",
        play_status_code: "NP",
        play_status_desc: "Not played",
        result_status_code: "WO",
        result_status_desc: "Walkover",
        team1_player_ids: "800000001",
        team1_names: "Ana Winner",
        team1_nationalities: "BRA",
        team2_player_ids: "800000002",
        team2_names: "Bella Walkover",
        team2_nationalities: "BRA",
        winner_side: 1,
      },
    ];

    const playerResults = buildPlayerResultsFromMatches(matches);
    const winner = playerResults.find((row) => row.player_id === "800000001");
    const loser = playerResults.find((row) => row.player_id === "800000002");

    assert.equal(winner.matches_played, 1);
    assert.equal(winner.wins, 1);
    assert.equal(winner.losses, 0);
    assert.equal(winner.status, "champion");
    assert.equal(loser.matches_played, 1);
    assert.equal(loser.wins, 0);
    assert.equal(loser.losses, 1);
    assert.equal(loser.status, "eliminated");
  });

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
          groupStandings: [
            {
              matches: 1,
              players: [
                {
                  playerId: 800700001,
                  nationality: "BRA",
                  givenName: "Kauany",
                  familyName: "Rodrigues",
                },
              ],
            },
            {
              matches: 0,
              players: [
                {
                  playerId: 800700002,
                  nationality: "SLO",
                  givenName: "Luisa",
                  familyName: "Fusil",
                },
              ],
            },
          ],
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
    assert.equal(rrMatch.rr_team1_position, 1);
    assert.equal(rrMatch.rr_team1_wins, 1);
    assert.equal(rrMatch.rr_group_size, 2);
    assert.equal(rrMatch.rr_group_complete, "false");

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

  test("counts only real players when a round-robin standing contains an empty slot", () => {
    const player1 = team("800700001", "Lee", "Dube", "RSA");
    const player2 = team("800700002", "Yulu", "Ulendo", "ZAM");
    const player3 = team("800700003", "Sophie", "Van Der Merwe", "ZIM");
    const completedMatch = (matchId, first, second, winnerSide) => ({
      matchId,
      playStatusCode: "PC",
      playStatusDesc: "Played and completed",
      teams: [
        { ...first, isWinner: winnerSide === 1 },
        { ...second, isWinner: winnerSide === 2 },
      ],
    });
    const drawsheet = {
      eventId: "event-girls-round-robin",
      rrGroups: [
        {
          groupName: "Group A",
          groupStandings: [
            { ...player1, matches: 2 },
            { ...player2, matches: 1 },
            {},
            { ...player3, matches: 0 },
          ],
          teams: [
            {
              ...player1,
              matches: [
                completedMatch("rr-1", player1, player2, 1),
                completedMatch("rr-2", player1, player3, 1),
              ],
            },
            {
              ...player2,
              matches: [completedMatch("rr-3", player2, player3, 1)],
            },
            player3,
          ],
        },
      ],
    };

    const matches = extractMatchesFromDrawsheet(drawsheet, eventInfo, tournament);

    assert.equal(matches.length, 3);
    assert.equal(matches[0].rr_group_size, 3);
    assert.equal(matches[0].rr_group_complete, "true");
  });

  test("keeps elimination-stage status and round-robin standing metadata", () => {
    const common = {
      tournament_key: "J-J60-NED-2026-001",
      tournament_name: "J60 Hilversum",
      category: "J60",
      player_type_code: "G",
      player_type_desc: "Girls",
      match_type_code: "S",
      match_type_desc: "Singles",
      event_classification_code: "M",
      event_classification_desc: "Main Draw",
    };
    const matches = [
      {
        ...common,
        drawsheet_structure_code: "KO",
        drawsheet_structure_desc: "Knock-out",
        round_name: "Quarter-finals",
        round_order: "1",
        match_id: "qf-1",
        play_status_code: "PC",
        play_status_desc: "Played and completed",
        team1_player_ids: "800700001",
        team1_names: "Kauany Rodrigues",
        team2_player_ids: "800700010",
        team2_names: "Opponent",
        winner_side: "2",
      },
      {
        ...common,
        drawsheet_structure_code: "RR",
        drawsheet_structure_desc: "Round-robin",
        group_name: "Group A",
        rr_group_size: "4",
        rr_group_complete: "true",
        rr_team1_position: "1",
        rr_team1_wins: "2",
        rr_team2_position: "3",
        rr_team2_wins: "1",
        round_name: "Round-robin",
        round_order: "1",
        match_id: "rr-1",
        play_status_code: "PC",
        play_status_desc: "Played and completed",
        team1_player_ids: "800700001",
        team1_names: "Kauany Rodrigues",
        team2_player_ids: "800700002",
        team2_names: "Luisa Fusil",
        winner_side: "1",
      },
    ];

    const playerResults = buildPlayerResultsFromMatches(matches);
    const kauany = playerResults.find((row) => row.player_id === "800700001");

    assert.ok(kauany);
    assert.equal(kauany.status, "eliminated");
    assert.equal(kauany.highest_round_name, "Quarter-finals");
    assert.equal(kauany.round_robin_position, "1");
    assert.equal(kauany.round_robin_group_complete, "true");
    assert.equal(kauany.round_robin_wins, 2);
    assert.equal(kauany.elimination_matches_seen, 1);
  });
});
