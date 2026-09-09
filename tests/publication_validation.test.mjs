import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPublicBoundaryAudit,
  validatePublicationData,
} from "../scripts/lib/publication_validation.mjs";
import { STATUS_FETCH_REQUIRED, STATUS_INCLUDED } from "../scripts/lib/external_candidates.mjs";

const RANKING_DATE = "2026-08-31";

function buildFixture() {
  const playersRows = [];
  const snapshotRows = [];
  const pointsLedgerRows = [];
  const liveRankingRows = [];
  const universeRows = [];

  for (const gender of ["M", "F"]) {
    for (let rank = 1; rank <= 1050; rank += 1) {
      const playerId = `${gender.toLowerCase()}-${rank}`;
      universeRows.push({
        player_id: playerId,
        player_name: `${gender} Player ${rank}`,
        gender,
        rank: String(rank),
        official_points: String(2000 - rank),
        ranking_date: RANKING_DATE,
      });
      if (rank <= 1000) {
        playersRows.push({
          player_id: playerId,
          player_name: `${gender} Player ${rank}`,
          gender,
        });
        snapshotRows.push({
          player_id: playerId,
          player_name: `${gender} Player ${rank}`,
          gender,
          rank: String(rank),
          official_points: String(2000 - rank),
          ranking_date: RANKING_DATE,
        });
        pointsLedgerRows.push({ player_id: playerId, points: "1" });
        liveRankingRows.push({
          player_id: playerId,
          player_name: `${gender} Player ${rank}`,
          gender,
          official_rank: String(rank),
          live_rank: String(rank),
          live_points: String(2000 - rank),
          ranking_date: RANKING_DATE,
          calculated_at: "2026-09-01T00:00:00.000Z",
        });
      }
    }
  }

  return {
    strict: true,
    baseState: "TOP1000_ACTIVE",
    playersRows,
    snapshotRows,
    pointsLedgerRows,
    liveRankingRows,
    publicRankingRows: liveRankingRows,
    candidateRows: [],
    candidateLedgerRows: [],
    universeRows,
    weekTournamentsRows: [{ tournament_key: "J-J100-TEST" }],
    weekMatchesRows: [{ match_id: "1" }],
    weekPlayerResultsRows: [{ player_id: "m-1" }],
    weekResultsErrorRows: [],
    presence: {
      candidates: true,
      universe: true,
      weekTournaments: true,
      weekMatches: true,
      weekPlayerResults: true,
      weekResultsErrors: true,
    },
  };
}

describe("public Top 1000 publication validation", () => {
  test("rejects an outsider crossing the cutoff even if the detector omitted them", () => {
    const fixture = buildFixture();
    fixture.universeRows.find(row => row.player_id === "m-1050").official_points = "1000";
    assert.match(validatePublicationData(fixture).errors.join("\n"), /sem auditoria de candidatura/);
  });

  test("rejects weekly outsiders absent from the candidate audit", () => {
    const fixture = buildFixture();
    fixture.weekPlayerResultsRows.push({ player_id: "unknown", gender: "F" });
    assert.match(validatePublicationData(fixture).errors.join("\n"), /sem auditoria de candidatura/);
  });

  test("rejects processed candidate evidence from another week", () => {
    const fixture = buildFixture();
    fixture.candidateRows.push({ player_id: "old", candidate_status: STATUS_INCLUDED,
      breakdown_fetched: "true", ranking_date: "2026-08-24" });
    fixture.candidateLedgerRows.push({ player_id: "old", points: "1" });
    assert.match(validatePublicationData(fixture).errors.join("\n"), /semana desatualizada/);
  });

  test("accepts a complete 1000 per gender package", () => {
    const result = validatePublicationData(buildFixture());

    assert.equal(result.valid, true);
    assert.deepEqual(result.counts.public_by_gender, { M: 1000, F: 1000 });
    assert.equal(result.counts.unresolved_candidates, 0);
    assert.equal(result.counts.boundary_audit, 202);
  });

  test("rejects duplicate player identities", () => {
    const fixture = buildFixture();
    fixture.playersRows[1].player_id = fixture.playersRows[0].player_id;
    const result = validatePublicationData(fixture);

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /duplicado/);
  });

  test("rejects a public artifact that diverges from the calculated Top 1000", () => {
    const fixture = buildFixture();
    fixture.publicRankingRows = fixture.publicRankingRows.slice(1);
    const result = validatePublicationData(fixture);

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /Arquivo publico diverge/);
  });

  test("rejects an unresolved candidate that can enter the public ranking", () => {
    const fixture = buildFixture();
    fixture.candidateRows.push({
      player_id: "external-1",
      player_name: "External One",
      gender: "M",
      guaranteed_upper_bound: "1100",
      public_cutoff_points: "1000",
      candidate_status: STATUS_FETCH_REQUIRED,
      breakdown_fetched: "false",
    });
    const result = validatePublicationData(fixture);

    assert.equal(result.valid, false);
    assert.equal(result.counts.unresolved_candidates, 1);
  });

  test("preserves all athletes tied at the public cutoff and audits external origin", () => {
    const fixture = buildFixture();
    fixture.liveRankingRows.push({
      player_id: "external-tie",
      player_name: "External Tie",
      gender: "M",
      official_rank: "1001",
      live_rank: "1000",
      live_points: "1000",
      ranking_date: RANKING_DATE,
      calculated_at: "2026-09-01T00:00:00.000Z",
    });
    fixture.candidateRows.push({
      player_id: "external-tie",
      player_name: "External Tie",
      gender: "M",
      guaranteed_upper_bound: "1000",
      public_cutoff_points: "1000",
      candidate_status: STATUS_INCLUDED,
      breakdown_fetched: "true",
      ranking_date: RANKING_DATE,
    });
    fixture.candidateLedgerRows.push({ player_id: "external-tie", points: "1000" });

    const result = validatePublicationData(fixture);
    const audit = buildPublicBoundaryAudit(fixture);

    assert.equal(result.valid, true);
    assert.equal(result.counts.public_by_gender.M, 1001);
    assert.equal(
      audit.find((row) => row.player_id === "external-tie")?.origin,
      "external_candidate"
    );
  });

  test("strict mode rejects missing universe and candidate audit files", () => {
    const fixture = buildFixture();
    fixture.universeRows = [];
    fixture.presence.universe = false;
    fixture.presence.candidates = false;
    const result = validatePublicationData(fixture);

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /rankings_universe\.csv/);
    assert.match(result.errors.join("\n"), /external_candidates\.csv/);
  });
});
