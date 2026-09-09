import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certifyUniverse } from '../scripts/lib/universe_coverage.mjs';

function fixture() {
  const universe = ['M','F'].flatMap(gender => Array.from({length:1600}, (_,i) => ({
    player_id: `${gender}${i+1}`, gender, rank: i+1,
    official_points: 2000-i, ranking_date:'2026-09-07',
  })));
  return { universe, snapshot: universe.filter(row => row.rank <=1500).map(row=>({...row})) };
}
test('certifies a conservative bound without assuming absent players have zero points', () => {
  const {universe,snapshot} = fixture();
  assert.equal(certifyUniverse(universe,snapshot).unlisted_points_upper_bound,401);
});
test('a missing tail player raises the bound to the last complete prefix', () => {
  const {universe,snapshot} = fixture();
  assert.equal(certifyUniverse(universe.filter(row=>row.player_id!=='M1550'),snapshot).unlisted_points_upper_bound,452);
});
test('rejects a different official week, changed points and missing tracked athletes', () => {
  const {universe,snapshot} = fixture();
  assert.throws(()=>certifyUniverse(universe.map(row=>({...row,ranking_date:'2026-09-09'})),snapshot),/datas/);
  assert.throws(()=>certifyUniverse(universe.slice(1),snapshot),/diverge/);
  universe[0].official_points++;
  assert.throws(()=>certifyUniverse(universe,snapshot),/diverge/);
});
test('accepts complete competition-ranking ties and bounds an incomplete final tie', () => {
  const {universe,snapshot} = fixture();
  for (const row of universe) if(row.rank>=1599) { row.rank=1599; row.official_points=402; }
  assert.equal(certifyUniverse(universe,snapshot).unlisted_points_upper_bound,402);
});
