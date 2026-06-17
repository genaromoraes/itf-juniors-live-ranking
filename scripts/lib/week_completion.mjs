function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function buildEventFallbackKey(row) {
  return [
    cleanText(row.tournament_key),
    cleanText(row.player_type_code),
    cleanText(row.match_type_code),
    cleanText(row.event_classification_code),
  ].join("|");
}

export function buildEventKey(row) {
  const tournamentKey = cleanText(row.tournament_key);
  const eventId = cleanText(row.event_id);
  if (tournamentKey && eventId) return `${tournamentKey}|${eventId}`;
  return buildEventFallbackKey(row);
}

export function isFinalRound(value) {
  const text = normalizeText(value);
  if (!text) return false;

  if (
    text.includes("SEMIFINAL") ||
    text.includes("SEMI FINAL") ||
    text.includes("QUARTERFINAL") ||
    text.includes("QUARTER FINAL") ||
    text.includes("PLAYOFF")
  ) {
    return false;
  }

  return (
    text === "F" ||
    text === "FINAL" ||
    text === "FINALS" ||
    text === "FINAL ROUND"
  );
}

function hasWinner(matchRow) {
  return Boolean(cleanText(matchRow.winner_side) || cleanText(matchRow.winner_names));
}

function isFutureMatch(matchRow) {
  const playStatusCode = normalizeText(matchRow.play_status_code);
  const playStatusDesc = normalizeText(matchRow.play_status_desc);
  const resultStatusCode = normalizeText(matchRow.result_status_code);
  const resultStatusDesc = normalizeText(matchRow.result_status_desc);
  const haystack = [
    playStatusCode,
    playStatusDesc,
    resultStatusCode,
    resultStatusDesc,
  ].join(" ");

  return (
    haystack.includes("TO BE PLAYED") ||
    haystack.includes("SCHEDULED") ||
    haystack.includes("NOT PLAYED") ||
    haystack.includes("NOT STARTED") ||
    playStatusCode === "TP" ||
    playStatusCode === "NP"
  );
}

function isCancelledLike(matchRow) {
  const haystack = [
    normalizeText(matchRow.play_status_code),
    normalizeText(matchRow.play_status_desc),
    normalizeText(matchRow.result_status_code),
    normalizeText(matchRow.result_status_desc),
  ].join(" ");

  return (
    haystack.includes("CANCELLED") ||
    haystack.includes("CANCELED") ||
    haystack.includes("ABANDONED") ||
    haystack.includes("SUSPENDED")
  );
}

function isTerminalSpecialResult(matchRow) {
  const haystack = [
    normalizeText(matchRow.play_status_code),
    normalizeText(matchRow.play_status_desc),
    normalizeText(matchRow.result_status_code),
    normalizeText(matchRow.result_status_desc),
    normalizeText(matchRow.score),
  ].join(" ");

  return (
    haystack.includes("BYE") ||
    haystack.includes("W O") ||
    haystack.includes("WALKOVER") ||
    haystack.includes("RET") ||
    haystack.includes("RETIRED") ||
    haystack.includes("DEFAULT") ||
    haystack.includes("CANCELLED")
  );
}

function reasonForMatchPending(matchRow) {
  if (isFutureMatch(matchRow) && !isTerminalSpecialResult(matchRow)) {
    return "match_pending";
  }

  return "";
}

function winnerToken(matchRow) {
  return normalizeText(matchRow.winner_names || matchRow.winner_side);
}

function eventIdentity(row) {
  return {
    event_id: cleanText(row.event_id) || "",
    player_type_code: cleanText(row.player_type_code),
    player_type_desc: cleanText(row.player_type_desc),
    match_type_code: cleanText(row.match_type_code),
    match_type_desc: cleanText(row.match_type_desc),
    event_classification_code: cleanText(row.event_classification_code),
    tournament_key: cleanText(row.tournament_key),
    tournament_name: cleanText(row.tournament_name),
  };
}

export function classifyEventCompletion(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const first = rows[0] || {};
  const identity = eventIdentity(first);
  const finalMatches = rows.filter((row) => isFinalRound(row.round_name));
  const finalWinners = [
    ...new Set(
      finalMatches
        .filter((row) => hasWinner(row))
        .map((row) => winnerToken(row))
        .filter(Boolean)
    ),
  ];
  const pendingMatchRows = rows.filter(
    (row) => reasonForMatchPending(row) && !isFinalRound(row.round_name)
  );

  if (finalWinners.length > 1) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: pendingMatchRows.length,
      reason: "multiple_final_winners",
    };
  }

  if (finalMatches.some((row) => isCancelledLike(row)) && finalWinners.length === 0) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: pendingMatchRows.length,
      reason: "final_cancelled_without_champion",
    };
  }

  if (rows.some((row) => isCancelledLike(row)) && finalWinners.length === 0) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: pendingMatchRows.length,
      reason: "cancelled_or_suspended_without_champion",
    };
  }

  if (finalMatches.length === 0) {
    return {
      ...identity,
      status: "pending",
      champion_found: false,
      pending_matches: pendingMatchRows.length,
      reason: "final_not_found",
    };
  }

  const completedFinal = finalMatches.find(
    (row) =>
      hasWinner(row) &&
      (!isFutureMatch(row) || isTerminalSpecialResult(row)) &&
      !isCancelledLike(row)
  );

  if (completedFinal) {
    if (pendingMatchRows.length > 0) {
      return {
        ...identity,
        status: "pending",
        champion_found: true,
        pending_matches: pendingMatchRows.length,
        reason: "pending_match_in_event",
      };
    }

    return {
      ...identity,
      status: "completed",
      champion_found: true,
      pending_matches: 0,
      reason: "final_completed",
    };
  }

  if (finalMatches.some((row) => isFutureMatch(row) && !isTerminalSpecialResult(row))) {
    return {
      ...identity,
      status: "pending",
      champion_found: false,
      pending_matches: pendingMatchRows.length + 1,
      reason: "final_pending",
    };
  }

  if (finalMatches.some((row) => !hasWinner(row))) {
    return {
      ...identity,
      status: "pending",
      champion_found: false,
      pending_matches: pendingMatchRows.length,
      reason: "final_without_winner",
    };
  }

  return {
    ...identity,
    status: "review_required",
    champion_found: false,
    pending_matches: pendingMatchRows.length,
    reason: "contradictory_event_data",
  };
}

function buildPendingItem(base, reason) {
  return {
    tournament_name: cleanText(base.tournament_name),
    event_id: cleanText(base.event_id),
    player_type_desc: cleanText(base.player_type_desc),
    match_type_desc: cleanText(base.match_type_desc),
    reason,
  };
}

export function summarizeWeekCompletion({
  weekTournamentRows = [],
  weekMatchesRows = [],
  weekResultsSummaryRows = [],
  weekResultsErrorsRows = [],
  currentDate = "",
  weekEnd = "",
  liveRankingValid = true,
  officialBaseValid = true,
} = {}) {
  const tournamentMap = new Map();
  for (const row of weekTournamentRows) {
    const key = cleanText(row.tournament_key);
    if (!key) continue;
    if (!tournamentMap.has(key)) {
      tournamentMap.set(key, {
        tournament_key: key,
        tournament_name: cleanText(row.tournament_name),
      });
    }
  }

  const eventsByKey = new Map();
  for (const row of weekMatchesRows) {
    const key = buildEventKey(row);
    if (!eventsByKey.has(key)) eventsByKey.set(key, []);
    eventsByKey.get(key).push(row);
  }

  const eventSummaries = [...eventsByKey.values()].map((rows) =>
    classifyEventCompletion(rows)
  );

  const eventsByTournament = new Map();
  for (const event of eventSummaries) {
    const tournamentKey = cleanText(event.tournament_key);
    if (!eventsByTournament.has(tournamentKey)) {
      eventsByTournament.set(tournamentKey, []);
    }
    eventsByTournament.get(tournamentKey).push(event);
  }

  const summaryByTournament = new Map();
  for (const row of weekResultsSummaryRows) {
    summaryByTournament.set(cleanText(row.tournament_key), row);
  }

  const pendingItems = [];
  let missingEvents = 0;
  let pendingMatches = 0;

  for (const event of eventSummaries) {
    pendingMatches += event.pending_matches;

    if (event.status !== "completed") {
      pendingItems.push(buildPendingItem(event, event.reason));
    }
  }

  for (const [tournamentKey, summaryRow] of summaryByTournament.entries()) {
    const foundEvents = (eventsByTournament.get(tournamentKey) || []).length;
    const expectedEvents = toNumber(summaryRow.events_found);

    if (expectedEvents > foundEvents) {
      const diff = expectedEvents - foundEvents;
      missingEvents += diff;
      pendingItems.push(
        buildPendingItem(
          {
            tournament_name: cleanText(summaryRow.tournament_name),
            event_id: "",
            player_type_desc: "",
            match_type_desc: "",
          },
          `missing_events:${diff}`
        )
      );
    }
  }

  for (const row of weekResultsErrorsRows) {
    pendingItems.push(
      buildPendingItem(
        {
          tournament_name: cleanText(row.tournament_name),
          event_id: "",
          player_type_desc: cleanText(row.player_type_desc),
          match_type_desc: cleanText(row.match_type_desc),
        },
        "results_error"
      )
    );
  }

  const tournaments = new Map();
  for (const [tournamentKey, tournament] of tournamentMap.entries()) {
    const events = eventsByTournament.get(tournamentKey) || [];
    const summaryRow = summaryByTournament.get(tournamentKey);
    const expectedEvents = toNumber(summaryRow?.events_found);
    const tournamentMissingEvents = Math.max(expectedEvents - events.length, 0);
    const hasReview = events.some((event) => event.status === "review_required");
    const hasPending = events.some((event) => event.status === "pending");
    const hasErrors =
      weekResultsErrorsRows.some(
        (row) => cleanText(row.tournament_key) === tournamentKey
      ) || tournamentMissingEvents > 0;

    let status = "completed";
    if (hasErrors || hasReview) status = "review_required";
    else if (hasPending) status = "pending";

    tournaments.set(tournamentKey, {
      ...tournament,
      status,
    });
  }

  const tournamentsTotal = tournamentMap.size;
  const tournamentsCompleted = [...tournaments.values()].filter(
    (item) => item.status === "completed"
  ).length;
  const tournamentsPending = [...tournaments.values()].filter(
    (item) => item.status === "pending"
  ).length;
  const tournamentsReviewRequired = [...tournaments.values()].filter(
    (item) => item.status === "review_required"
  ).length;

  const eventsCompleted = eventSummaries.filter(
    (event) => event.status === "completed"
  ).length;
  const eventsPending = eventSummaries.filter(
    (event) => event.status === "pending"
  ).length;
  const eventsReviewRequired = eventSummaries.filter(
    (event) => event.status === "review_required"
  ).length;
  const championsFound = eventSummaries.filter((event) => event.champion_found).length;
  const resultsErrors = weekResultsErrorsRows.length;
  const allEventsComplete =
    eventSummaries.length > 0 &&
    eventsCompleted === eventSummaries.length &&
    missingEvents === 0 &&
    resultsErrors === 0;

  const safeToClose =
    Boolean(weekEnd && currentDate > weekEnd) &&
    allEventsComplete &&
    eventsPending === 0 &&
    eventsReviewRequired === 0 &&
    missingEvents === 0 &&
    pendingMatches === 0 &&
    resultsErrors === 0 &&
    liveRankingValid &&
    officialBaseValid;

  return {
    tournaments_total: tournamentsTotal,
    tournaments_completed: tournamentsCompleted,
    tournaments_pending: tournamentsPending,
    tournaments_review_required: tournamentsReviewRequired,
    events_total: eventSummaries.length,
    events_completed: eventsCompleted,
    events_pending: eventsPending,
    events_review_required: eventsReviewRequired,
    champions_found: championsFound,
    missing_events: missingEvents,
    pending_matches: pendingMatches,
    results_errors: resultsErrors,
    all_events_complete: allEventsComplete,
    safe_to_close: safeToClose,
    pending_items: pendingItems,
  };
}
