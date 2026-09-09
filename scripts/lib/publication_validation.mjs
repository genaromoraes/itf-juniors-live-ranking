import { PUBLIC_RANK_LIMIT_PER_GENDER, TRACKED_BASE_LIMIT_PER_GENDER } from "./ranking_limits.mjs";
import {
  STATUS_FETCHED,
  STATUS_INCLUDED,
  cleanText,
  collectExternalParticipants,
  getUnresolvedPublicCandidates,
  toNumber,
} from "./external_candidates.mjs";

export const PUBLIC_BOUNDARY_AUDIT_COLUMNS = [
  "boundary_rank",
  "player_id",
  "player_name",
  "gender",
  "official_rank",
  "official_points",
  "live_rank",
  "live_points",
  "origin",
  "candidate_status",
  "breakdown_fetched",
  "entered_public_ranking",
  "ranking_date",
  "calculated_at",
];

export const PUBLIC_BOUNDARY_START_RANK = 950;
export const PUBLIC_BOUNDARY_END_RANK = 1050;

function normalizeGender(value) {
  const gender = cleanText(value).toUpperCase();
  if (["M", "B", "BOYS"].includes(gender)) return "M";
  if (["F", "G", "GIRLS"].includes(gender)) return "F";
  return gender;
}

function countByGender(rows) {
  const counts = { M: 0, F: 0 };
  for (const row of rows) {
    const gender = normalizeGender(row.gender);
    if (gender === "M" || gender === "F") counts[gender] += 1;
  }
  return counts;
}

function duplicateValues(rows, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = cleanText(row[key]);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => cleanText(row[key])).filter(Boolean))].sort();
}

function ids(rows) {
  return new Set(rows.map((row) => cleanText(row.player_id)).filter(Boolean));
}

function addPresenceIssue({ strict, present, label, errors, warnings }) {
  if (present) return;
  const message = `${label} nao foi encontrado.`;
  if (strict) errors.push(message);
  else warnings.push(message);
}

export function buildPublicBoundaryAudit({
  liveRankingRows = [],
  playersRows = [],
  candidateRows = [],
  universeRows = [],
  startRank = PUBLIC_BOUNDARY_START_RANK,
  endRank = PUBLIC_BOUNDARY_END_RANK,
} = {}) {
  const trackedIds = ids(playersRows);
  const candidatesById = new Map(
    candidateRows.map((row) => [cleanText(row.player_id), row])
  );
  const liveById = new Map(
    liveRankingRows.map((row) => [cleanText(row.player_id), row])
  );
  const universeById = new Map(
    universeRows.map((row) => [cleanText(row.player_id), row])
  );
  const boundaryIds = new Set();

  for (const row of liveRankingRows) {
    const rank = toNumber(row.live_rank);
    if (rank >= startRank && rank <= endRank) boundaryIds.add(cleanText(row.player_id));
  }
  for (const row of universeRows) {
    const rank = toNumber(row.rank || row.official_rank);
    if (rank >= startRank && rank <= endRank) boundaryIds.add(cleanText(row.player_id));
  }

  return [...boundaryIds]
    .filter(Boolean)
    .map((playerId) => {
      const row = liveById.get(playerId) || {};
      const official = universeById.get(playerId) || {};
      const candidate = candidatesById.get(playerId) || {};
      const liveRank = cleanText(row.live_rank);
      const officialRank = cleanText(row.official_rank || official.rank || official.official_rank);
      const boundaryRank = liveRank || officialRank;
      const isCandidate = candidatesById.has(playerId);
      return {
        boundary_rank: boundaryRank,
        player_id: playerId,
        player_name: cleanText(row.player_name || official.player_name || candidate.player_name),
        gender: normalizeGender(row.gender || official.gender || candidate.gender),
        official_rank: officialRank,
        official_points: cleanText(
          official.official_points ||
            candidate.official_points ||
            row.official_points_for_comparison ||
            row.official_points
        ),
        live_rank: liveRank,
        live_points: cleanText(row.live_points),
        origin: trackedIds.has(playerId)
          ? "tracked_base"
          : isCandidate
            ? "external_candidate"
            : "official_universe",
        candidate_status: cleanText(candidate.candidate_status),
        breakdown_fetched: cleanText(candidate.breakdown_fetched),
        entered_public_ranking:
          liveRank && toNumber(liveRank) <= PUBLIC_RANK_LIMIT_PER_GENDER ? "true" : "false",
        ranking_date: cleanText(row.ranking_date || official.ranking_date),
        calculated_at: cleanText(row.calculated_at),
      };
    })
    .sort((a, b) => {
      if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
      const rankDifference = toNumber(a.boundary_rank) - toNumber(b.boundary_rank);
      if (rankDifference !== 0) return rankDifference;
      return a.player_id.localeCompare(b.player_id);
    });
}

export function validatePublicationData({
  strict = false,
  baseState = "",
  playersRows = [],
  snapshotRows = [],
  pointsLedgerRows = [],
  liveRankingRows = [],
  publicRankingRows = [],
  candidateRows = [],
  candidateLedgerRows = [],
  universeRows = [],
  weekTournamentsRows = [],
  weekMatchesRows = [],
  weekPlayerResultsRows = [],
  weekResultsErrorRows = [],
  presence = {},
} = {}) {
  const errors = [];
  const warnings = [];
  const playersByGender = countByGender(playersRows);
  const snapshotByGender = countByGender(snapshotRows);
  const liveByGender = countByGender(liveRankingRows);
  const expectedPublicRows = liveRankingRows.filter(
    (row) => toNumber(row.live_rank) > 0 && toNumber(row.live_rank) <= PUBLIC_RANK_LIMIT_PER_GENDER
  );
  const publicByGender = countByGender(publicRankingRows);

  if (!["TOP1000_ACTIVE", "RADAR1500_ACTIVE"].includes(cleanText(baseState))) {
    errors.push(`Estado da base deve estar ativo, recebido ${cleanText(baseState) || "vazio"}.`);
  }

  for (const gender of ["M", "F"]) {
    if (playersByGender[gender] !== TRACKED_BASE_LIMIT_PER_GENDER) {
      errors.push(
        `players.csv precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} atletas ${gender}; recebeu ${playersByGender[gender]}.`
      );
    }
    if (snapshotByGender[gender] !== TRACKED_BASE_LIMIT_PER_GENDER) {
      errors.push(
        `rankings_snapshot.csv precisa ter ${TRACKED_BASE_LIMIT_PER_GENDER} atletas ${gender}; recebeu ${snapshotByGender[gender]}.`
      );
    }
    if (liveByGender[gender] < PUBLIC_RANK_LIMIT_PER_GENDER) {
      errors.push(
        `Ranking live precisa ter ao menos ${PUBLIC_RANK_LIMIT_PER_GENDER} atletas ${gender}; recebeu ${liveByGender[gender]}.`
      );
    }
    if (publicByGender[gender] < PUBLIC_RANK_LIMIT_PER_GENDER) {
      errors.push(
        `Faixa publica precisa ter ao menos ${PUBLIC_RANK_LIMIT_PER_GENDER} atletas ${gender}; recebeu ${publicByGender[gender]}.`
      );
    }
  }

  if (presence.publicRanking === false) {
    errors.push("live_ranking_with_drops_public.csv nao foi encontrado.");
  }
  const invalidPublicRanks = publicRankingRows.filter((row) => {
    const rank = toNumber(row.live_rank);
    return rank < 1 || rank > PUBLIC_RANK_LIMIT_PER_GENDER;
  });
  if (invalidPublicRanks.length > 0) {
    errors.push(
      `Arquivo publico contem ${invalidPublicRanks.length} atleta(s) fora do limite Top ${PUBLIC_RANK_LIMIT_PER_GENDER}.`
    );
  }
  const expectedPublicKeys = expectedPublicRows
    .map((row) => `${normalizeGender(row.gender)}:${cleanText(row.player_id)}:${cleanText(row.live_rank)}`)
    .sort();
  const actualPublicKeys = publicRankingRows
    .map((row) => `${normalizeGender(row.gender)}:${cleanText(row.player_id)}:${cleanText(row.live_rank)}`)
    .sort();
  if (
    expectedPublicKeys.length !== actualPublicKeys.length ||
    expectedPublicKeys.some((key, index) => key !== actualPublicKeys[index])
  ) {
    errors.push("Arquivo publico diverge da faixa Top 1000 calculada no ranking completo.");
  }

  for (const [label, rows] of [
    ["players.csv", playersRows],
    ["rankings_snapshot.csv", snapshotRows],
    ["live_ranking_with_drops.csv", liveRankingRows],
    ["live_ranking_with_drops_public.csv", publicRankingRows],
  ]) {
    const duplicates = duplicateValues(rows, "player_id");
    if (duplicates.length > 0) {
      errors.push(`${label} contem player_id duplicado: ${duplicates.slice(0, 5).join(", ")}.`);
    }
    if (rows.some((row) => !cleanText(row.player_id))) {
      errors.push(`${label} contem player_id vazio.`);
    }
  }

  const playerIds = ids(playersRows);
  const snapshotIds = ids(snapshotRows);
  const missingFromSnapshot = [...playerIds].filter((playerId) => !snapshotIds.has(playerId));
  const extraInSnapshot = [...snapshotIds].filter((playerId) => !playerIds.has(playerId));
  if (missingFromSnapshot.length || extraInSnapshot.length) {
    errors.push(
      `players.csv e rankings_snapshot.csv divergem em IDs (faltando=${missingFromSnapshot.length}, extras=${extraInSnapshot.length}).`
    );
  }

  const snapshotDates = uniqueValues(snapshotRows, "ranking_date");
  const liveDates = uniqueValues(liveRankingRows, "ranking_date");
  if (snapshotDates.length !== 1) {
    errors.push(`rankings_snapshot.csv precisa ter uma data unica; recebeu ${snapshotDates.join(", ") || "nenhuma"}.`);
  }
  if (liveDates.length !== 1) {
    errors.push(`ranking live precisa ter uma data unica; recebeu ${liveDates.join(", ") || "nenhuma"}.`);
  }
  if (snapshotDates.length === 1 && liveDates.length === 1 && snapshotDates[0] !== liveDates[0]) {
    errors.push(`Data do ranking live ${liveDates[0]} diverge do snapshot ${snapshotDates[0]}.`);
  }

  for (const row of publicRankingRows) {
    if (!cleanText(row.player_name)) {
      errors.push(`Atleta publico ${cleanText(row.player_id)} esta sem nome.`);
      break;
    }
    if (!["M", "F"].includes(normalizeGender(row.gender))) {
      errors.push(`Atleta publico ${cleanText(row.player_id)} tem genero invalido.`);
      break;
    }
    if (!Number.isFinite(Number(row.live_points))) {
      errors.push(`Atleta publico ${cleanText(row.player_id)} tem pontos live invalidos.`);
      break;
    }
  }

  const ledgerIds = new Set([...ids(pointsLedgerRows), ...ids(candidateLedgerRows)]);
  const publicWithoutLedger = publicRankingRows.filter((row) => !ledgerIds.has(cleanText(row.player_id)));
  if (publicWithoutLedger.length > 0) {
    errors.push(
      `${publicWithoutLedger.length} atleta(s) publico(s) nao possuem breakdown no ledger: ${publicWithoutLedger
        .slice(0, 5)
        .map((row) => cleanText(row.player_id))
        .join(", ")}.`
    );
  }

  addPresenceIssue({
    strict,
    present: presence.candidates !== false,
    label: "external_candidates.csv",
    errors,
    warnings,
  });
  const unresolvedCandidates = getUnresolvedPublicCandidates(candidateRows);
  const candidateIds = ids(candidateRows);
  const weeklyOutsiders = collectExternalParticipants({
    playersRows, weekMatchesRows, weekPlayerResultsRows,
  });
  const publicCutoffs = new Map(["M", "F"].map(gender => [gender,
    Math.min(...publicRankingRows.filter(row => normalizeGender(row.gender) === gender)
      .map(row => Number(row.live_points))),
  ]));
  const unexamined = new Set(weeklyOutsiders.filter(row => !candidateIds.has(row.player_id)).map(row => row.player_id));
  for (const row of universeRows) {
    const id = cleanText(row.player_id);
    if (!playerIds.has(id) && !candidateIds.has(id) &&
        (cleanText(row.official_points) === "" || !Number.isFinite(Number(row.official_points)) ||
          Number(row.official_points) >= publicCutoffs.get(normalizeGender(row.gender)))) unexamined.add(id);
  }
  if (unexamined.size) errors.push(`${unexamined.size} atleta(s) externo(s) sem auditoria de candidatura.`);
  const processedCandidates = candidateRows.filter(row =>
    [STATUS_FETCHED, STATUS_INCLUDED].includes(cleanText(row.candidate_status)));
  const candidateLedgerIds = ids(candidateLedgerRows);
  if (processedCandidates.some(row => !candidateLedgerIds.has(cleanText(row.player_id)) ||
      cleanText(row.ranking_date) !== snapshotDates[0] || row.official_points_status === "UNKNOWN")) {
    errors.push("Candidato processado sem ledger, com semana desatualizada ou pontuacao oficial desconhecida.");
  }
  if (unresolvedCandidates.length > 0) {
    errors.push(
      `${unresolvedCandidates.length} candidato(s) capaz(es) de entrar no ranking publico continuam pendentes.`
    );
  }
  const fetchedWithoutBreakdown = candidateRows.filter(
    (row) =>
      [STATUS_FETCHED, STATUS_INCLUDED].includes(cleanText(row.candidate_status)) &&
      cleanText(row.breakdown_fetched) !== "true"
  );
  if (fetchedWithoutBreakdown.length > 0) {
    errors.push(`${fetchedWithoutBreakdown.length} candidato(s) marcados como processados estao sem breakdown.`);
  }

  addPresenceIssue({
    strict,
    present: presence.universe !== false,
    label: "rankings_universe.csv",
    errors,
    warnings,
  });
  if (universeRows.length > 0) {
    const universeDates = uniqueValues(universeRows, "ranking_date");
    const universeByGender = countByGender(universeRows);
    if (universeDates.length !== 1) {
      errors.push(`Universo oficial precisa ter uma data unica; recebeu ${universeDates.join(", ") || "nenhuma"}.`);
    } else if (snapshotDates.length === 1 && universeDates[0] !== snapshotDates[0]) {
      errors.push(`Data do universo ${universeDates[0]} diverge do snapshot ${snapshotDates[0]}.`);
    }
    for (const gender of ["M", "F"]) {
      if (universeByGender[gender] < PUBLIC_BOUNDARY_END_RANK) {
        const message = `Universo oficial precisa chegar ao rank ${PUBLIC_BOUNDARY_END_RANK} de ${gender} para auditar a fronteira publica; recebeu ${universeByGender[gender]} atletas.`;
        if (strict) errors.push(message);
        else warnings.push(message);
      }
    }
  } else if (strict) {
    errors.push("Universo oficial esta vazio.");
  } else {
    warnings.push("Universo oficial esta vazio; validacao local nao confirma candidatos externos.");
  }

  for (const [key, label] of [
    ["weekTournaments", "week_tournaments.csv"],
    ["weekMatches", "week_matches.csv"],
    ["weekPlayerResults", "week_player_results.csv"],
    ["weekResultsErrors", "week_results_errors.csv"],
  ]) {
    addPresenceIssue({ strict, present: presence[key] !== false, label, errors, warnings });
  }
  if (weekResultsErrorRows.length > 0) {
    errors.push(`Coleta semanal possui ${weekResultsErrorRows.length} erro(s).`);
  }
  if (strict && weekTournamentsRows.length === 0) {
    errors.push("Nenhum torneio semanal foi coletado.");
  }
  if (weekTournamentsRows.length > 0 && weekMatchesRows.length === 0) {
    warnings.push("Ainda nao ha partidas semanais coletadas.");
  }
  if (weekTournamentsRows.length > 0 && weekPlayerResultsRows.length === 0) {
    warnings.push("Ainda nao ha resultados semanais coletados.");
  }

  const externalPublicRows = publicRankingRows.filter((row) => !playerIds.has(cleanText(row.player_id)));
  const boundaryRows = buildPublicBoundaryAudit({
    liveRankingRows,
    playersRows,
    candidateRows,
    universeRows,
  });

  return {
    valid: errors.length === 0,
    strict,
    public_limit_per_gender: PUBLIC_RANK_LIMIT_PER_GENDER,
    ranking_date: snapshotDates.length === 1 ? snapshotDates[0] : "",
    counts: {
      players: playersRows.length,
      players_by_gender: playersByGender,
      snapshot: snapshotRows.length,
      snapshot_by_gender: snapshotByGender,
      live: liveRankingRows.length,
      live_by_gender: liveByGender,
      public: publicRankingRows.length,
      public_by_gender: publicByGender,
      public_external: externalPublicRows.length,
      candidates: candidateRows.length,
      unresolved_candidates: unresolvedCandidates.length,
      boundary_audit: boundaryRows.length,
      week_tournaments: weekTournamentsRows.length,
      week_matches: weekMatchesRows.length,
      week_player_results: weekPlayerResultsRows.length,
      week_result_errors: weekResultsErrorRows.length,
    },
    errors,
    warnings,
    boundaryRows,
  };
}
