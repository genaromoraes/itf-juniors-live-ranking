export const LEDGER_COLUMNS = [
  "player_id",
  "player_name",
  "gender",
  "country",
  "country_name",
  "birth_year",
  "event_type",
  "countable_status",
  "tournament_name",
  "category",
  "draw_type",
  "host_nation",
  "host_nation_code",
  "surface",
  "surface_code",
  "start_date",
  "drop_date_calculated",
  "round",
  "points",
  "tournament_link",
  "is_countable_at_collection",
  "is_live",
  "status",
  "source_url",
  "collected_at",
  "raw_json",
];

export const REQUIRED_SOURCE_FILES = [
  "week_tournaments.csv",
  "week_live_ledger_rows.csv",
  "week_player_results.csv",
  "week_matches.csv",
];

export const EXPECTED_REJECTION_REASON = "player_not_tracked";
export const EXPECTED_REJECTION_SEVERITY = "expected";
export const FATAL_REJECTION_SEVERITY = "fatal";

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function normalizeKeyPart(value) {
  return cleanText(value).toLowerCase();
}

export function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

export function todayIso(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(dateText, days) {
  if (!isIsoDate(dateText)) return "";

  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function calculateDropDate(startDate) {
  return addDaysIso(startDate, 364);
}

export function buildResultKey(row) {
  return [
    row.player_id,
    row.event_type,
    row.tournament_name,
    row.category,
    row.draw_type,
    row.start_date,
  ]
    .map(normalizeKeyPart)
    .join("|");
}

export function sortRowsForComparison(rows) {
  return [...rows].sort((a, b) => {
    const keyDiff = buildResultKey(a).localeCompare(buildResultKey(b));

    if (keyDiff !== 0) return keyDiff;

    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
}

export function rowsHaveSameContent(a, b) {
  return (
    JSON.stringify(sortRowsForComparison(a)) ===
    JSON.stringify(sortRowsForComparison(b))
  );
}

export function parseRawJson(value) {
  const text = cleanText(value);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isExpectedRejectionReason(reason) {
  return cleanText(reason) === EXPECTED_REJECTION_REASON;
}

export function getRejectionSeverity(reason) {
  return isExpectedRejectionReason(reason)
    ? EXPECTED_REJECTION_SEVERITY
    : FATAL_REJECTION_SEVERITY;
}

function buildRejectedRow(row, rejectionReason) {
  return {
    ...row,
    rejection_reason: rejectionReason,
    rejection_severity: getRejectionSeverity(rejectionReason),
  };
}

export function buildPlayersMap(playersRows) {
  return new Map(
    playersRows
      .filter((row) => cleanText(row.player_id))
      .map((row) => [cleanText(row.player_id), row])
  );
}

export function tournamentLookupKeys(row) {
  const raw = parseRawJson(row.raw_json) || {};
  const tournamentKey = cleanText(row.tournament_key || raw.tournamentKey);
  const name = cleanText(row.tournament_name || row.name);
  const category = cleanText(row.category);
  const startDate = cleanText(row.start_date);

  return [
    tournamentKey ? `key|${normalizeKeyPart(tournamentKey)}` : "",
    `name|${normalizeKeyPart(name)}|${normalizeKeyPart(category)}|${normalizeKeyPart(startDate)}`,
    `name|${normalizeKeyPart(name)}|${normalizeKeyPart(category)}`,
  ].filter(Boolean);
}

export function buildTournamentsMap(tournamentRows) {
  const map = new Map();

  for (const row of tournamentRows) {
    for (const key of tournamentLookupKeys(row)) {
      if (!map.has(key)) {
        map.set(key, row);
      }
    }
  }

  return map;
}

export function findTournamentForLiveRow(row, tournamentsMap) {
  const raw = parseRawJson(row.raw_json) || {};
  const candidates = [
    raw.tournament_key ? `key|${normalizeKeyPart(raw.tournament_key)}` : "",
    raw.tournamentKey ? `key|${normalizeKeyPart(raw.tournamentKey)}` : "",
    `name|${normalizeKeyPart(row.tournament_name)}|${normalizeKeyPart(row.category)}|${normalizeKeyPart(row.start_date)}`,
    `name|${normalizeKeyPart(row.tournament_name)}|${normalizeKeyPart(row.category)}`,
  ].filter(Boolean);

  for (const key of candidates) {
    const tournament = tournamentsMap.get(key);
    if (tournament) return tournament;
  }

  return {};
}

export function validateWeekWindow({
  tournamentRows,
  weekStart,
  weekEnd,
  currentDate = todayIso(),
}) {
  const errors = [];

  if (!isIsoDate(weekStart)) {
    errors.push("week-start invalido. Use YYYY-MM-DD.");
  }

  if (!isIsoDate(weekEnd)) {
    errors.push("week-end invalido. Use YYYY-MM-DD.");
  }

  if (isIsoDate(weekStart) && isIsoDate(weekEnd) && weekStart > weekEnd) {
    errors.push("week-start nao pode ser maior que week-end.");
  }

  if (isIsoDate(weekEnd) && weekEnd >= currentDate) {
    errors.push(
      `Semana ainda em andamento: week_end ${weekEnd} deve ser menor que a data atual ${currentDate}.`
    );
  }

  const mismatchedRows = tournamentRows.filter(
    (row) =>
      cleanText(row.week_start) !== weekStart || cleanText(row.week_end) !== weekEnd
  );

  if (mismatchedRows.length > 0) {
    errors.push(
      `week_tournaments.csv contem ${mismatchedRows.length} linhas fora da janela informada.`
    );
  }

  const openTournaments = tournamentRows.filter((row) => {
    const endDate = cleanText(row.end_date);
    return !isIsoDate(endDate) || endDate > weekEnd;
  });

  if (openTournaments.length > 0) {
    errors.push(
      `Existem ${openTournaments.length} torneios com end_date ausente ou posterior ao week_end.`
    );
  }

  return errors;
}

export function transformLiveRows({
  liveRows,
  playersRows,
  tournamentRows,
  now = new Date().toISOString(),
}) {
  const playersMap = buildPlayersMap(playersRows);
  const tournamentsMap = buildTournamentsMap(tournamentRows);
  const acceptedByKey = new Map();
  const rejectedRows = [];

  for (const row of liveRows) {
    const points = toNumber(row.points);
    const playerId = cleanText(row.player_id);
    const eventType = cleanText(row.event_type);
    const startDate = cleanText(row.start_date);
    const tournamentName = cleanText(row.tournament_name);
    const category = cleanText(row.category);
    const drawType = cleanText(row.draw_type);

    if (!playerId) {
      rejectedRows.push(buildRejectedRow(row, "missing_player_id"));
      continue;
    }

    if (!eventType || !["singles", "doubles"].includes(normalizeKeyPart(eventType))) {
      rejectedRows.push(buildRejectedRow(row, "invalid_event_type"));
      continue;
    }

    if (!tournamentName || !category || !drawType || !cleanText(row.player_name)) {
      rejectedRows.push(
        buildRejectedRow(row, "invalid_or_empty_required_field")
      );
      continue;
    }

    if (!isIsoDate(startDate)) {
      rejectedRows.push(buildRejectedRow(row, "invalid_start_date"));
      continue;
    }

    if (points === null || points <= 0) {
      rejectedRows.push(buildRejectedRow(row, "invalid_points"));
      continue;
    }

    const player = playersMap.get(playerId);

    if (!player) {
      rejectedRows.push(buildRejectedRow(row, EXPECTED_REJECTION_REASON));
      continue;
    }

    const tournament = findTournamentForLiveRow(row, tournamentsMap);

    const transformed = {
      player_id: playerId,
      player_name: cleanText(row.player_name || player.player_name),
      gender: cleanText(row.gender || player.gender),
      country: cleanText(row.country || player.country),
      country_name: cleanText(row.country_name || player.country_name),
      birth_year: cleanText(row.birth_year || player.birth_year),
      event_type: eventType,
      countable_status: "confirmed_incremental",
      tournament_name: cleanText(row.tournament_name),
      category: cleanText(row.category),
      draw_type: cleanText(row.draw_type),
      host_nation: cleanText(row.host_nation || tournament.host_nation),
      host_nation_code: cleanText(
        row.host_nation_code || tournament.host_nation_code
      ),
      surface: cleanText(row.surface || tournament.surface),
      surface_code: cleanText(row.surface_code || tournament.surface_code),
      start_date: startDate,
      drop_date_calculated: calculateDropDate(startDate),
      round: cleanText(row.round),
      points: String(points),
      tournament_link: cleanText(row.tournament_link || tournament.tournament_link),
      is_countable_at_collection: "false",
      is_live: "false",
      status: "confirmed_from_week_close",
      source_url: cleanText(row.source_url),
      collected_at: cleanText(row.collected_at || now),
      raw_json: cleanText(row.raw_json),
    };

    if (!isIsoDate(transformed.drop_date_calculated)) {
      rejectedRows.push(buildRejectedRow(row, "invalid_drop_date"));
      continue;
    }

    acceptedByKey.set(buildResultKey(transformed), transformed);
  }

  return {
    rows: [...acceptedByKey.values()],
    rejectedRows,
  };
}

export function mergeWeekRowsIntoLedger(baseRows, weekRows, weekEnd) {
  const weekKeys = new Set(weekRows.map(buildResultKey));
  const preservedRows = [];
  const replacedRows = [];

  for (const row of baseRows) {
    if (weekKeys.has(buildResultKey(row))) {
      replacedRows.push(row);
    } else {
      preservedRows.push(row);
    }
  }

  const replacedKeys = new Set(replacedRows.map(buildResultKey));
  const addedRows = weekRows.filter((row) => !replacedKeys.has(buildResultKey(row)));
  const nextRows = [...preservedRows, ...weekRows];
  const expiredRowsCount = baseRows.filter((row) => {
    const dropDate = cleanText(row.drop_date_calculated);
    return isIsoDate(dropDate) && dropDate <= weekEnd;
  }).length;

  return {
    nextRows,
    addedRows,
    replacedRows,
    preservedRows,
    expiredRowsCount,
  };
}

export function validateNextLedger({
  baseRows,
  nextRows,
  weekRows,
  preservedRows,
  playersRows,
}) {
  const errors = [];
  const playerIds = new Set(playersRows.map((row) => cleanText(row.player_id)));
  const seen = new Set();

  for (const row of weekRows) {
    if (cleanText(row.is_live).toLowerCase() === "true") {
      errors.push(`Linha nova com is_live=true: ${buildResultKey(row)}`);
    }

    if (!cleanText(row.player_id)) {
      errors.push("Linha nova sem player_id.");
    }

    if (!playerIds.has(cleanText(row.player_id))) {
      errors.push(`Jogador nao existe em players.csv: ${cleanText(row.player_id)}`);
    }

    if (toNumber(row.points) === null) {
      errors.push(`Linha nova com points invalido: ${buildResultKey(row)}`);
    }

    if (!cleanText(row.drop_date_calculated)) {
      errors.push(`Linha nova sem drop_date_calculated: ${buildResultKey(row)}`);
    }
  }

  for (const row of nextRows) {
    const key = buildResultKey(row);

    if (seen.has(key)) {
      errors.push(`Duplicata pela chave de identidade: ${key}`);
    }

    seen.add(key);
  }

  const expectedCount = preservedRows.length + weekRows.length;

  if (nextRows.length !== expectedCount) {
    errors.push(
      `Quantidade final incoerente: esperado ${expectedCount}, obtido ${nextRows.length}.`
    );
  }

  const nextKeys = new Set(nextRows.map(buildResultKey));
  const missingPreserved = preservedRows.filter((row) => !nextKeys.has(buildResultKey(row)));

  if (missingPreserved.length > 0) {
    errors.push(
      `${missingPreserved.length} linhas originais nao substituidas deixaram de ser preservadas.`
    );
  }

  if (baseRows.length === 0 && nextRows.length === 0) {
    errors.push("Ledger final vazio.");
  }

  return {
    validationPassed: errors.length === 0,
    errors,
  };
}

export function buildCloseWeekPlan({
  baseRows,
  playersRows,
  tournamentRows,
  liveRows,
  weekStart,
  weekEnd,
  currentDate = todayIso(),
  weekErrorRows = [],
  now = new Date().toISOString(),
}) {
  const safetyErrors = validateWeekWindow({
    tournamentRows,
    weekStart,
    weekEnd,
    currentDate,
  });

  if (weekErrorRows.length > 0) {
    safetyErrors.push(
      `Existem ${weekErrorRows.length} erros registrados para a semana.`
    );
  }

  if (liveRows.length === 0) {
    safetyErrors.push("week_live_ledger_rows.csv esta vazio.");
  }

  const transformed = transformLiveRows({
    liveRows,
    playersRows,
    tournamentRows,
    now,
  });

  const positiveLiveRows = liveRows.filter((row) => {
    const points = toNumber(row.points);
    return points !== null && points > 0;
  });
  const expectedRejectedRows = transformed.rejectedRows.filter(
    (row) => row.rejection_severity === EXPECTED_REJECTION_SEVERITY
  );
  const fatalRejectedRows = transformed.rejectedRows.filter(
    (row) => row.rejection_severity === FATAL_REJECTION_SEVERITY
  );
  const untrackedPlayerIds = new Set(
    expectedRejectedRows.map((row) => cleanText(row.player_id)).filter(Boolean)
  );
  const warnings = [];

  if (fatalRejectedRows.length > 0) {
    safetyErrors.push(
      `Existem ${fatalRejectedRows.length} linhas live com rejeicoes fatais.`
    );
  }

  if (expectedRejectedRows.length > 0) {
    warnings.push(
      `${expectedRejectedRows.length} linhas de ${untrackedPlayerIds.size} jogadores nao acompanhados foram ignoradas.`
    );
  }

  if (transformed.rows.length === 0) {
    safetyErrors.push(
      "Nao existem linhas elegiveis de jogadores acompanhados para promover ao ledger."
    );
  }

  const merged = mergeWeekRowsIntoLedger(baseRows, transformed.rows, weekEnd);
  const validation = validateNextLedger({
    baseRows,
    nextRows: merged.nextRows,
    weekRows: transformed.rows,
    preservedRows: merged.preservedRows,
    playersRows,
  });

  const idempotence = mergeWeekRowsIntoLedger(
    merged.nextRows,
    transformed.rows,
    weekEnd
  );

  const idempotent = rowsHaveSameContent(idempotence.nextRows, merged.nextRows);

  if (!idempotent) {
    validation.errors.push("Execucao repetida nao produziu o mesmo conjunto.");
  }

  const affectedPlayers = [
    ...new Map(
      transformed.rows.map((row) => [
        cleanText(row.player_id),
        {
          player_id: cleanText(row.player_id),
          player_name: cleanText(row.player_name),
          gender: cleanText(row.gender),
          rows_added_or_replaced: transformed.rows.filter(
            (candidate) => candidate.player_id === row.player_id
          ).length,
        },
      ])
    ).values(),
  ];

  const report = {
    week_start: weekStart,
    week_end: weekEnd,
    generated_at: now,
    base_rows_before: baseRows.length,
    live_rows_received: liveRows.length,
    live_rows_positive_points: positiveLiveRows.length,
    tracked_rows_eligible: transformed.rows.length,
    untracked_rows_rejected: expectedRejectedRows.length,
    untracked_players_rejected: untrackedPlayerIds.size,
    fatal_rows_rejected: fatalRejectedRows.length,
    expected_rows_rejected: expectedRejectedRows.length,
    rows_added: merged.addedRows.length,
    rows_replaced: merged.replacedRows.length,
    rows_preserved: merged.preservedRows.length,
    rows_rejected: transformed.rejectedRows.length,
    players_affected: affectedPlayers.length,
    expired_rows_through_week_end: merged.expiredRowsCount,
    total_final: merged.nextRows.length,
    validation_passed:
      safetyErrors.length === 0 &&
      validation.errors.length === 0 &&
      idempotent,
    mode_safe_for_apply:
      safetyErrors.length === 0 &&
      validation.errors.length === 0 &&
      idempotent &&
      fatalRejectedRows.length === 0 &&
      transformed.rows.length > 0,
    warnings,
    safety_errors: safetyErrors,
    validation_errors: validation.errors,
  };

  return {
    report,
    nextRows: merged.nextRows,
    addedRows: merged.addedRows,
    replacedRows: merged.replacedRows,
    preservedRows: merged.preservedRows,
    rejectedRows: transformed.rejectedRows,
    affectedPlayers,
  };
}
