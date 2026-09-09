import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { readCsv, calculateLedgerPoints, compareCalculatedAgainstSnapshot } from './lib/official_ledger_validation.mjs';

const input = path.resolve(process.argv.find(v => v.startsWith('--input-dir='))?.slice(12) || 'data/staging/radar_2026-09-07/inventory');
const [inventory, recovered, baseLedger, snapshot] = await Promise.all([
  readCsv(path.join(input, 'inventory.csv')),
  readCsv(path.join(input, 'recovered_ledger.csv')),
  readCsv('data/clean/points_ledger.csv'),
  readCsv('data/clean/rankings_snapshot.csv'),
]);
const dates = [...new Set(snapshot.map(r => r.ranking_date))];
if (dates.length !== 1 || inventory.some(r => r.ranking_date !== dates[0])) throw new Error('Mixed official dates.');
const cutoff = new Date(Date.parse(dates[0] + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
const staged = { policy: 'drop_cutoff', dropCutoff: cutoff };
const base = compareCalculatedAgainstSnapshot(calculateLedgerPoints(baseLedger, staged), snapshot);
const historical = new Map(calculateLedgerPoints(recovered, staged).map(r => [r.player_id, r]));
const rebuilt = new Map(calculateLedgerPoints(recovered, { policy: 'as_collected', applyDropCutoff: true, dropCutoff: cutoff }).map(r => [r.player_id, r]));
const audit = inventory.map(row => {
  const calculated = historical.get(row.player_id)?.calculated_total;
  const rebuiltPoints = rebuilt.get(row.player_id)?.calculated_total;
  const exact = calculated !== undefined && Math.abs(calculated - Number(row.official_points)) < 0.01;
  return {
    ...row,
    drop_cutoff: cutoff,
    staged_points: calculated ?? '',
    rebuilt_best_six_points: rebuiltPoints ?? '',
    point_difference: calculated === undefined ? '' : Number((calculated - Number(row.official_points)).toFixed(2)),
    audit_status: calculated === undefined ? 'NO_LOCAL_LEDGER' : exact ? 'POINTS_MATCH_REQUIRES_HISTORY_REVIEW' : 'POINTS_DIVERGE_REQUIRES_RECONCILIATION',
  };
});
const summary = {
  generated_at: new Date().toISOString(), ranking_date: dates[0], drop_cutoff: cutoff,
  baseline: { exact: base.exact, total: base.total, valid: base.valid, policy: staged.policy },
  additional: {
    total: audit.length,
    available: audit.filter(r => r.audit_status !== 'NO_LOCAL_LEDGER').length,
    points_match: audit.filter(r => r.audit_status === 'POINTS_MATCH_REQUIRES_HISTORY_REVIEW').length,
    points_diverge: audit.filter(r => r.audit_status === 'POINTS_DIVERGE_REQUIRES_RECONCILIATION').length,
    no_local_ledger: audit.filter(r => r.audit_status === 'NO_LOCAL_LEDGER').length,
  },
  promotion_ready: false,
  note: 'Historical countable flags and event coverage may be stale even if totals match. No recovered player is certified for promotion by this audit alone.',
};
await fs.writeFile(path.join(input, 'points_audit.csv'), stringify(audit, { header: true }));
await fs.writeFile(path.join(input, 'points_audit_summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
