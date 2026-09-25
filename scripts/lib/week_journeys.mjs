export function buildWeekJourneys(matches, rankings = []) {
  const ranks = new Map(rankings.map(player => [String(player.player_id), player]));
  function team(match, side) {
    let rawPlayers = [];
    try { rawPlayers = JSON.parse(match.raw_json).teams?.[side - 1]?.players?.filter(Boolean) || []; } catch {}
    const ids = String(match['team' + side + '_player_ids'] || '').split('|');
    const names = String(match['team' + side + '_names'] || '').split('/');
    const countries = String(match['team' + side + '_nationalities'] || '').split('|');
    return (rawPlayers.length ? rawPlayers : names.map((name, i) => ({playerId: ids[i]?.trim(), name: name.trim(), nationality: countries[i]?.trim()})))
      .map(player => {
        const id = String(player.playerId || '');
        const known = ranks.get(id);
        return { id, name: player.name || [player.givenName, player.familyName].filter(Boolean).join(' ') || known?.player_name || '', country: player.nationality || known?.country || '', rank: Number(known?.official_rank) > 0 ? Number(known.official_rank) : null };
      }).filter(player => player.name);
  }
  const players = new Map();
  const seen = new Set();
  for (const m of matches) {
    const key = [m.tournament_key, m.event_id, m.match_id].join('|');
    if (m.match_id && seen.has(key)) continue;
    seen.add(key);
    for (const side of [1, 2]) {
      const ids = String(m[`team${side}_player_ids`] || '').split('|').map(x => x.trim()).filter(Boolean);
      let score = m.score || '';
      try {
        const teams = JSON.parse(m.raw_json).teams;
        score = (teams[side - 1].scores || []).flatMap((a, i) => {
          const b = teams[2 - side].scores?.[i];
          if (a?.score == null || b?.score == null) return [];
          const tie = a.losingScore ?? b.losingScore;
          return [a.score + '–' + b.score + (tie == null ? '' : '(' + tie + ')')];
        }).join(' ');
      } catch {
        if (side === 2) score = score.replace(/(\d+)-(\d+)/g, '$2-$1');
      }
      for (const id of ids) {
        if (!players.has(id)) players.set(id, []);
        players.get(id).push({
          event: m.match_type_code === 'D' ? 'doubles' : 'singles',
          tournament: m.tournament_name, round: m.round_name,
          order: Number(m.round_order || 0), qualifying: m.event_classification_code === 'Q',
          opponent: m[`team${3 - side}_names`] || '', score,
          team: team(m, side), opponents: team(m, 3 - side),
          result: Number(m.winner_side) ? (Number(m.winner_side) === side ? 'win' : 'loss') : '',
          status: m.result_status_code || '',
        });
      }
    }
  }
  for (const games of players.values()) games.sort((a, b) => a.tournament.localeCompare(b.tournament) || Number(b.qualifying) - Number(a.qualifying) || a.order - b.order);
  return players;
}
