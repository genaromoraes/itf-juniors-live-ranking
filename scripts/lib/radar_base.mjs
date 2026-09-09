import { RADAR_LIMIT_PER_GENDER } from './ranking_limits.mjs';
import { calculateLedgerPoints, compareCalculatedAgainstSnapshot, validateLedgerRows } from './official_ledger_validation.mjs';
import { extractLedgerRowsFromRankingPoints } from './official_breakdown_reconciliation.mjs';

export function officialCutoff(rankingDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rankingDate)) throw new Error('Invalid ranking date.');
  return new Date(Date.parse(rankingDate + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
}

export function validateRadarBreakdown({ json, player, sourceUrl, rankingDate, collectedAt }) {
  if (!Array.isArray(json?.countable)) throw new Error('Breakdown is missing countable sections.');
  const rows = extractLedgerRowsFromRankingPoints({ json, player, sourceUrl, rankingDate, collectedAt });
  if (!rows.length) throw new Error('Breakdown has no recognized results.');
  const structure = validateLedgerRows(rows);
  if (!structure.valid) throw new Error(structure.errors.slice(0,3).join('; '));
  const result = compareCalculatedAgainstSnapshot(calculateLedgerPoints(rows, {
    policy: 'drop_cutoff', dropCutoff: officialCutoff(rankingDate),
  }), [{ ...player, official_points: player.official_points ?? player.current_points }]);
  if (!result.valid) throw new Error(`Official points mismatch: ${result.rows[0]?.calculated_points} vs ${player.official_points ?? player.current_points}`);
  return rows;
}

export function buildRadarStaging({ universe, basePlayers, baseSnapshot, baseLedger, inventory, recoveredLedger, limit = RADAR_LIMIT_PER_GENDER }) {
  const dates = [...new Set(baseSnapshot.map(r => r.ranking_date))];
  if (dates.length !== 1 || universe.some(r => r.ranking_date !== dates[0])) throw new Error('Radar and official dates differ.');
  const rankingDate = dates[0];
  const baseline = compareCalculatedAgainstSnapshot(calculateLedgerPoints(baseLedger, {
    policy: 'drop_cutoff', dropCutoff: officialCutoff(rankingDate),
  }), baseSnapshot);
  if (!baseline.valid) throw new Error(`Existing official base does not reconcile: ${baseline.exact}/${baseline.total}`);
  const target = universe.filter(r => Number(r.rank) > 0 && Number(r.rank) <= limit);
  if (new Set(target.map(r => r.player_id)).size !== target.length) throw new Error('Duplicate radar IDs.');
  const baseMap = new Map(basePlayers.map(r => [r.player_id, r]));
  if (basePlayers.some(r => !target.some(t => t.player_id === r.player_id))) throw new Error('Radar omits an existing official player.');
  const inventoryMap = new Map(inventory.map(r => [r.player_id, r]));
  const players = target.map(r => ({
    ...(baseMap.get(r.player_id) || {}),
    player_id: r.player_id, player_name: r.player_name, gender: r.gender,
    country: r.country, country_name: r.country_name, birth_year: r.birth_year,
    profile_url: r.profile_url || baseMap.get(r.player_id)?.profile_url || '',
    current_rank: r.rank, current_points: r.official_points, ranking_date: rankingDate,
  }));
  const queue = target.filter(r => !baseMap.has(r.player_id)).map(r => {
    const old = inventoryMap.get(r.player_id) || {};
    return {
      player_id: r.player_id, player_name: r.player_name, gender: r.gender,
      rank: r.rank, ranking_date: rankingDate, official_points: r.official_points,
      source: old.source || 'MISSING',
      status: old.audit_status === 'POINTS_MATCH_REQUIRES_HISTORY_REVIEW' && old.source !== 'EXTERNAL_CACHE'
        ? 'HISTORY_REVIEW_REQUIRED' : 'FETCH_REQUIRED',
      error: '', raw_file: '', updated_at: '',
    };
  });
  const targetIds = new Set(target.map(r => r.player_id));
  const ledger = [...baseLedger, ...recoveredLedger.filter(r => targetIds.has(r.player_id) && !baseMap.has(r.player_id))];
  return { rankingDate, players, snapshot: target, ledger, queue, baseline: { exact: baseline.exact, total: baseline.total } };
}
