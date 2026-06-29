import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDataForHtml,
  buildTournamentProgress,
  buildWeekParticipationMap,
} from "../scripts/09_generate_live_ranking_html.mjs";

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
  assert.equal(participation.singlesRound, "Q2");
  assert.equal(participation.singlesSummary, "Simples: Qualy Q2");
});

test("last qualifying round is displayed as Qualy Final", () => {
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
        player_type_code: "G",
        event_classification_code: "Q",
        event_classification_desc: "Qualifying",
        highest_round_order: "3",
        highest_round_name: "Final",
        status: "still_alive_or_champion",
      },
    ],
    [],
    [
      {
        tournament_key: "J-J300-GBR-2026-001",
        player_type_code: "G",
        match_type_code: "S",
        event_classification_code: "Q",
        round_order: "3",
      },
    ]
  );

  const participation = map.get("1");

  assert.ok(participation);
  assert.equal(participation.singlesRound, "Q");
  assert.equal(participation.singlesSummary, "Simples: Qualy Final");
});

test("main-draw rows use technical round labels instead of raw round numbers", () => {
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
  assert.equal(participation.singlesRound, "R32");
  assert.equal(participation.singlesSummary, "Simples: R32");
});

test("round-robin rows appear as participation without projection eligibility", () => {
  const map = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J60-NED-2026-001",
        tournament_name: "J60 Hilversum",
        category: "J60",
        end_date: "2026-06-28",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "G",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "1",
        highest_round_name: "Round-robin",
        status: "round_robin",
      },
    ],
    [],
    [
      {
        tournament_key: "J-J60-NED-2026-001",
        player_type_code: "G",
        match_type_code: "S",
        event_classification_code: "M",
        round_order: "1",
      },
    ]
  );

  const participation = map.get("1");

  assert.ok(participation);
  assert.equal(participation.singlesProjectionEligible, false);
  assert.equal(participation.singlesRound, "");
  assert.equal(participation.singlesSummary, "Simples: Round-robin");
});

test("round-robin players can show title projection without next-round projection", () => {
  const participationMap = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J60-NED-2026-001",
        tournament_name: "J60 Hilversum",
        category: "J60",
        end_date: "2026-06-28",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "G",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "1",
        highest_round_name: "Round-robin",
        status: "round_robin",
      },
    ],
    [],
    [],
    "2026-06-28"
  );
  const [row] = buildDataForHtml(
    [
      {
        player_id: "1",
        gender: "F",
        live_points: "100",
      },
    ],
    participationMap
  );

  assert.equal(row.next_round_scenarios.length, 0);
  assert.equal(row.title_scenarios.length, 1);
  assert.equal(row.title_scenarios[0].targetRound, "W");
});

test("completed round-robin non-winners do not show title projections", () => {
  const participationMap = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J60-NED-2026-001",
        tournament_name: "J60 Hilversum",
        category: "J60",
        end_date: "2026-06-28",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "G",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "1",
        highest_round_name: "Round-robin",
        round_robin_position: "2",
        round_robin_group_complete: "true",
        status: "round_robin",
      },
    ],
    [
      {
        player_id: "1",
        tournament_key: "J-J60-NED-2026-001",
        event_type: "singles",
        round: "RR2",
      },
    ],
    []
  );
  const [row] = buildDataForHtml(
    [
      {
        player_id: "1",
        gender: "F",
        live_points: "105",
      },
    ],
    participationMap
  );

  assert.equal(row.next_round_scenarios.length, 0);
  assert.equal(row.title_scenarios.length, 0);
});

test("main-draw summaries normalize runner-up and winner labels", () => {
  const map = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J100-KAZ-2026-003",
        tournament_name: "J100 Almaty",
        category: "J100",
        end_date: "2026-06-28",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "B",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "5",
        highest_round_name: "Final",
        status: "eliminated",
      },
      {
        player_id: "1",
        tournament_key: "J-J100-KAZ-2026-003",
        tournament_name: "J100 Almaty",
        category: "J100",
        end_date: "2026-06-28",
        event_type: "doubles",
        match_type_code: "D",
        player_type_code: "B",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "5",
        highest_round_name: "WR",
        status: "champion",
      },
    ],
    [
      {
        player_id: "1",
        tournament_key: "J-J100-KAZ-2026-003",
        event_type: "singles",
        round: "RU",
      },
      {
        player_id: "1",
        tournament_key: "J-J100-KAZ-2026-003",
        event_type: "doubles",
        round: "WR",
      },
    ],
    []
  );

  const participation = map.get("1");

  assert.ok(participation);
  assert.equal(participation.singlesRound, "F");
  assert.equal(participation.singlesSummary, "Simples: F ❌");
  assert.equal(participation.doublesRound, "W");
  assert.equal(participation.doublesSummary, "Duplas: W");
});

test("title projection remains active on the tournament end date", () => {
  const participationMap = buildWeekParticipationMap(
    [
      {
        player_id: "1",
        tournament_key: "J-J60-ECU-2026-001",
        tournament_name: "J60 Salinas",
        category: "J60",
        end_date: "2026-06-27",
        event_type: "singles",
        match_type_code: "S",
        player_type_code: "G",
        event_classification_code: "M",
        event_classification_desc: "Main Draw",
        highest_round_order: "5",
        highest_round_name: "Final",
        status: "still_alive_or_champion",
      },
    ],
    [
      {
        player_id: "1",
        tournament_key: "J-J60-ECU-2026-001",
        event_type: "singles",
        round: "F",
      },
    ],
    [],
    "2026-06-27"
  );
  const participation = participationMap.get("1");
  const [row] = buildDataForHtml(
    [
      {
        player_id: "1",
        gender: "F",
        live_points: "284.5",
        best_singles_1: "36 pts | LIVE | J60 | F | J60 Salinas | 2026-06-22 | drop",
      },
    ],
    participationMap
  );

  assert.equal(participation.isFinishedByDate, false);
  assert.equal(row.title_scenarios.length, 1);
  assert.equal(row.title_scenarios[0].targetRound, "W");
  assert.equal(row.title_scenarios[0].projectedTotal, 308.5);
});

test("tournament progress ignores a technical empty match placeholder", () => {
  const common = {
    tournament_key: "J-J30-EGY-2026-004",
    tournament_name: "J30 Cairo",
    player_type_code: "G",
    match_type_code: "S",
    event_classification_code: "M",
    event_id: "CAIRO-GIRLS-MAIN",
  };
  const progress = buildTournamentProgress([
    {
      ...common,
      round_name: "Final",
      round_order: "4",
      play_status_code: "PC",
      team1_player_ids: "1",
      team2_player_ids: "2",
      winner_side: "1",
    },
    {
      ...common,
      match_id: "EMPTY-SLOT",
      round_name: "Round-robin",
      round_order: "1",
      play_status_code: "NP",
      play_status_desc: "Not played",
      team1_player_ids: "",
      team1_names: "",
      team2_player_ids: "",
      team2_names: "",
      winner_side: "",
    },
  ]).get("J-J30-EGY-2026-004");

  assert.deepEqual(progress, { completed: 1, total: 1 });
});
