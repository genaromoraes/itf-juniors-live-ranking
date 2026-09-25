import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekJourneys } from '../scripts/lib/week_journeys.mjs';
const match = {tournament_key:'T', tournament_name:'Test', event_id:'S', match_id:'1', match_type_code:'S', round_name:'Quarter-final', round_order:'3', team1_player_ids:'1',team2_player_ids:'2',team1_names:'Alice',team2_names:'Bob',winner_side:'2',score:'3-6 6-7(5)',raw_json:JSON.stringify({teams:[{scores:[{score:3},{score:6,losingScore:5}]},{scores:[{score:6},{score:7}]}]})};
test('scores and result follow selected athlete and duplicates are ignored',()=>{
 const data=buildWeekJourneys([match,match]);
 assert.equal(data.get('2').length,1);
 assert.equal(data.get('2')[0].score,'6–3 7–6(5)');
 assert.equal(data.get('2')[0].opponent,'Alice');
 assert.equal(data.get('2')[0].result,'win');
 assert.equal(data.get('1')[0].result,'loss');
});
test('doubles partners get same match, pending games have no result, qualifying sorts first',()=>{
 const data=buildWeekJourneys([{...match,match_id:'2',match_type_code:'D',team1_player_ids:'1|3',winner_side:'',score:'',raw_json:''},{...match,match_id:'3',event_classification_code:'Q',round_order:'4'}]);
 assert.equal(data.get('3')[0].event,'doubles'); assert.equal(data.get('3')[0].result,'');
 assert.equal(data.get('1')[0].qualifying,true);
});
test('both doubles teams preserve identities, nationalities and individual official ranks', () => {
 const data = buildWeekJourneys([{...match,match_type_code:'D',team1_player_ids:'1|3',team2_player_ids:'2|4',raw_json:JSON.stringify({teams:[{players:[{playerId:1,givenName:'Alice',familyName:'A',nationality:'BRA'},{playerId:3,givenName:'Carol',familyName:'C',nationality:'ARG'}]},{players:[{playerId:2,givenName:'Bob',familyName:'B',nationality:'USA'},{playerId:4,givenName:'Dan',familyName:'D',nationality:'CAN'}]}]})}], [{player_id:'1',official_rank:12},{player_id:'2',official_rank:30}]);
 const game = data.get('2')[0];
 assert.deepEqual(game.team.map(p => [p.name,p.country,p.rank]), [['Bob B','USA',30],['Dan D','CAN',null]]);
 assert.deepEqual(game.opponents.map(p => p.name), ['Alice A','Carol C']);
 assert.equal(game.opponents[0].rank,12);
 assert.equal('updated' in game,false);
});
