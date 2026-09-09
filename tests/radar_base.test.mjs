import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRadarStaging,validateRadarBreakdown,officialCutoff} from '../scripts/lib/radar_base.mjs';

const date='2026-09-07';
const row={player_id:'core',player_name:'Core',gender:'M',event_type:'singles',countable_status:'countable',points:'10',drop_date_calculated:'2027-01-01'};
const snapshot=[{player_id:'core',gender:'M',rank:'1',ranking_date:date,official_points:'10'}];
test('staging preserves the verified core and queues only additional players, including ties',()=>{
 const universe=[...snapshot,{player_id:'extra',gender:'M',rank:'2',ranking_date:date,official_points:'5'},
 {player_id:'tie',gender:'M',rank:'2',ranking_date:date,official_points:'5'}];
 const result=buildRadarStaging({universe,basePlayers:[{player_id:'core'}],baseSnapshot:snapshot,baseLedger:[row],
 inventory:[{player_id:'extra',source:'GIT_HISTORY',audit_status:'POINTS_MATCH_REQUIRES_HISTORY_REVIEW'}],recoveredLedger:[],limit:2});
 assert.equal(result.players.length,3);
 assert.equal(result.queue.length,2);
 assert.equal(result.queue[0].status,'HISTORY_REVIEW_REQUIRED');
 assert.equal(result.queue[1].status,'FETCH_REQUIRED');
 assert.deepEqual(result.ledger,[row]);
 assert.equal(result.baseline.exact,1);
});
test('staging rejects a divergent existing base before preparing an expanded roster',()=>{
 assert.throws(()=>buildRadarStaging({universe:snapshot,basePlayers:[{player_id:'core'}],baseSnapshot:snapshot,
 baseLedger:[{...row,points:'9'}],inventory:[],recoveredLedger:[],limit:2}),/does not reconcile/);
});
test('breakdown validation requires recognized results and exact official totals',()=>{
 const player={player_id:'extra',gender:'M',player_name:'Extra',current_points:'10'};
 const json={countable:[{title:'Singles',countablePoints:{pointsBreakdown:[{tournamentName:'J30 Example',category:'J30',drawType:'M',startDate:'01 Sep 2026',round:'QF',points:10}]}}]};
 assert.equal(validateRadarBreakdown({json,player,sourceUrl:'https://example.test',rankingDate:date}).length,1);
 assert.throws(()=>validateRadarBreakdown({json,player:{...player,current_points:'11'},rankingDate:date}),/points mismatch/);
 assert.throws(()=>validateRadarBreakdown({json:{countable:[]},player,rankingDate:date}),/no recognized/);
 assert.equal(officialCutoff(date),'2026-09-06');
});
