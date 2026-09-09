import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRadarInventory, validateRadarUniverse } from '../scripts/28_inventory_radar.mjs';

test('radar inventory reuses available results without certifying stale history and keeps boundary ties', () => {
  const universe = [
    { player_id: 'tracked', rank: '1' },
    { player_id: 'old', rank: '1001' },
    { player_id: 'cached', rank: '1499' },
    { player_id: 'missing', rank: '1500' },
    { player_id: 'tied', rank: '1500' },
    { player_id: 'outside', rank: '1502' },
  ];
  const historicalLedgers = new Map([
    ['old', { rows: [{ player_id: 'old', points: '20' }], commit: 'abc', snapshotDate: '2026-08-31' }],
  ]);
  const { inventory, recovered } = buildRadarInventory({
    universe, players: [{ player_id: 'tracked' }], historicalLedgers,
    cachedLedger: [{ player_id: 'cached', points: '30' }],
  });
  assert.equal(inventory.length, 4);
  assert.deepEqual(inventory.map(r => r.source), ['GIT_HISTORY', 'EXTERNAL_CACHE', 'MISSING', 'MISSING']);
  assert.equal(inventory[0].validation_status, 'AVAILABLE_REQUIRES_VALIDATION');
  assert.equal(inventory[0].history_snapshot_date, '2026-08-31');
  assert.equal(recovered.length, 2);
  assert.equal(inventory.find(r => r.player_id === 'tied').validation_status, 'FETCH_REQUIRED');
});

test('radar inventory rejects duplicate candidate identities', () => {
  assert.throws(() => buildRadarInventory({
    universe: [{ player_id: 'x', rank: '1001' }, { player_id: 'x', rank: '1002' }],
    players: [], historicalLedgers: new Map(), cachedLedger: [],
  }), /Duplicate/);
});

test('radar coverage requires contiguous competition ranks and evidence past boundary ties', () => {
  const rows = ['M','F'].flatMap(gender => [1,2,2,4].map((rank,i) => ({
    player_id: `${gender}${i}`, gender, rank, ranking_date: '2026-09-07',
  })));
  assert.doesNotThrow(() => validateRadarUniverse(rows, '2026-09-07', 2));
  assert.throws(() => validateRadarUniverse(rows.filter(r => r.player_id !== 'M1'), '2026-09-07', 2), /gap/);
  assert.throws(() => validateRadarUniverse(rows, '2026-09-07', 4), /extend past/);
  assert.throws(() => validateRadarUniverse(rows, '2026-08-31', 2), /dates/);
});
