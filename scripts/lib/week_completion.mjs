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

function splitTeamTokens(value) {
  return cleanText(value)
    .split("|")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function getSideTokens(matchRow, side) {
  const idTokens = splitTeamTokens(matchRow[`team${side}_player_ids`]);
  if (idTokens.length > 0) return idTokens;

  return cleanText(matchRow[`team${side}_names`])
    .split("/")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function hasAnyTokenInSet(tokens, tokenSet) {
  return tokens.some((token) => tokenSet.has(token));
}

function collectLaterRoundTokens(rows, roundOrder) {
  const laterTokens = new Set();
  for (const row of rows) {
    if (toNumber(row.round_order) <= roundOrder) continue;
    for (const token of getSideTokens(row, 1)) laterTokens.add(token);
    for (const token of getSideTokens(row, 2)) laterTokens.add(token);
  }
  return laterTokens;
}

function isPendingMatchResolvedByLaterDraw(matchRow, rows) {
  if (!reasonForMatchPending(matchRow) || isFinalRound(matchRow.round_name)) return false;

  const roundOrder = toNumber(matchRow.round_order);
  if (!roundOrder) return false;

  const team1Tokens = getSideTokens(matchRow, 1);
  const team2Tokens = getSideTokens(matchRow, 2);
  if (team1Tokens.length === 0 && team2Tokens.length === 0) return false;

  const laterTokens = collectLaterRoundTokens(rows, roundOrder);
  const team1Advanced = hasAnyTokenInSet(team1Tokens, laterTokens);
  const team2Advanced = hasAnyTokenInSet(team2Tokens, laterTokens);

  if (team1Advanced !== team2Advanced) return true;

  return !team1Advanced && !team2Advanced;
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
  const rawPendingMatchRows = rows.filter(
    (row) => reasonForMatchPending(row) && !isFinalRound(row.round_name)
  );

  if (finalWinners.length > 1) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: rawPendingMatchRows.length,
      reason: "multiple_final_winners",
    };
  }

  if (finalMatches.some((row) => isCancelledLike(row)) && finalWinners.length === 0) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: rawPendingMatchRows.length,
      reason: "final_cancelled_without_champion",
    };
  }

  if (rows.some((row) => isCancelledLike(row)) && finalWinners.length === 0) {
    return {
      ...identity,
      status: "review_required",
      champion_found: false,
      pending_matches: rawPendingMatchRows.length,
      reason: "cancelled_or_suspended_without_champion",
    };
  }

  if (finalMatches.length === 0) {
    return {
      ...identity,
      status: "pending",
      champion_found: false,
      pending_matches: rawPendingMatchRows.length,
      reason: "final_not_found",
    };
  }

  const completedFinal = finalMatches.find(
    (row) =>
      hasWinner(row) &&
      (!isFutureMatch(row) || isTerminalSpecialResult(row)) &&
      !isCancelledLike(row)
  );
  const pendingMatchRows = completedFinal
    ? rawPendingMatchRows.filter((row) => !isPendingMatchResolvedByLaterDraw(row, rows))
    : rawPendingMatchRows;

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

function isToleratedPendingEvent(event) {
  return (
    event.status === "pending" &&
    cleanText(event.reason) === "final_not_found" &&
    toNumber(event.pending_matches) === 0
  );
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
  const missingEventItems = [];
  let missingEvents = 0;
  let pendingMatches = 0;

  for (const event of eventSummaries) {
    pendingMatches += event.pending_matches;

    if (event.status !== "completed" && !isToleratedPendingEvent(event)) {
      pendingItems.push(buildPendingItem(event, event.reason));
    }
  }

  for (const [tournamentKey, summaryRow] of summaryByTournament.entries()) {
    const foundEvents = (eventsByTournament.get(tournamentKey) || []).length;
    const expectedEvents = toNumber(summaryRow.events_found);

    if (expectedEvents > foundEvents) {
      const diff = expectedEvents - foundEvents;
      missingEvents += diff;
      missingEventItems.push(
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
    const tournamentPendingMatches = events.reduce(
      (sum, event) => sum + toNumber(event.pending_matches),
      0
    );
    const tournamentResultsErrors = weekResultsErrorsRows.filter(
      (row) => cleanText(row.tournament_key) === tournamentKey
    ).length;
    const hasReview = events.some((event) => event.status === "review_required");
    const hasPending = events.some(
      (event) => event.status === "pending" && !isToleratedPendingEvent(event)
    );
    const hasOnlyCompletedOrToleratedEvents =
      events.length > 0 &&
      events.every(
        (event) => event.status === "completed" || isToleratedPendingEvent(event)
      );
    const tournamentMissingEventsTolerated =
      tournamentMissingEvents > 0 &&
      hasOnlyCompletedOrToleratedEvents &&
      tournamentPendingMatches === 0 &&
      tournamentResultsErrors === 0;
    const hasErrors =
      tournamentResultsErrors > 0 ||
      (tournamentMissingEvents > 0 && !tournamentMissingEventsTolerated);

    let status = "completed";
    if (hasErrors || hasReview) status = "review_required";
    else if (hasPending) status = "pending";

    tournaments.set(tournamentKey, {
      ...tournament,
      category: cleanText(summaryRow?.category),
      status,
      events_total: events.length,
      events_completed: events.filter((event) => event.status === "completed").length,
      events_pending: events.filter((event) => event.status === "pending").length,
      events_review_required: events.filter((event) => event.status === "review_required").length,
      expected_events: expectedEvents,
      missing_events: tournamentMissingEvents,
      pending_matches: tournamentPendingMatches,
      matches_found: toNumber(summaryRow?.matches_found),
      results_errors: tournamentResultsErrors,
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
  const toleratedPendingEvents = eventSummaries.filter(isToleratedPendingEvent).length;
  const blockingPendingEvents = eventsPending - toleratedPendingEvents;
  const eventsReviewRequired = eventSummaries.filter(
    (event) => event.status === "review_required"
  ).length;
  const championsFound = eventSummaries.filter((event) => event.champion_found).length;
  const resultsErrors = weekResultsErrorsRows.length;
  const materializedEventsComplete =
    eventSummaries.length > 0 &&
    eventsCompleted + toleratedPendingEvents === eventSummaries.length &&
    resultsErrors === 0;
  const missingEventsTolerated =
    missingEvents > 0 &&
    materializedEventsComplete &&
    blockingPendingEvents === 0 &&
    eventsReviewRequired === 0 &&
    pendingMatches === 0 &&
    resultsErrors === 0;
  const blockingMissingEvents = missingEventsTolerated ? 0 : missingEvents;
  const allEventsComplete = materializedEventsComplete && blockingMissingEvents === 0;

  if (!missingEventsTolerated) {
    pendingItems.push(...missingEventItems);
  }

  const safeToClose =
    Boolean(weekEnd && currentDate > weekEnd) &&
    allEventsComplete &&
    blockingPendingEvents === 0 &&
    eventsReviewRequired === 0 &&
    blockingMissingEvents === 0 &&
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
    blocking_pending_events: blockingPendingEvents,
    tolerated_pending_events: toleratedPendingEvents,
    events_review_required: eventsReviewRequired,
    champions_found: championsFound,
    missing_events: missingEvents,
    blocking_missing_events: blockingMissingEvents,
    tolerated_missing_events: missingEventsTolerated ? missingEvents : 0,
    pending_matches: pendingMatches,
    results_errors: resultsErrors,
    all_events_complete: allEventsComplete,
    safe_to_close: safeToClose,
    pending_items: pendingItems,
    tournaments: [...tournaments.values()].sort((a, b) =>
      cleanText(a.tournament_name).localeCompare(cleanText(b.tournament_name), "pt-BR")
    ),
  };
}
