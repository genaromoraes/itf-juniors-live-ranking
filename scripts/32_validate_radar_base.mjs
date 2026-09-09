import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readCsv, calculateLedgerPoints, compareCalculatedAgainstSnapshot, validateLedgerRows } from './lib/official_ledger_validation.mjs';
import { officialCutoff } from './lib/radar_base.mjs';
import { validateCompetitionRanks, RADAR_LIMIT_PER_GENDER } from './lib/ranking_limits.mjs';

const base=path.resolve(process.argv.find(v=>v.startsWith('--base-dir='))?.slice(11)||'data/staging/radar_2026-09-07/base');
const [players,snapshot,ledger,queue]=await Promise.all(['players.csv','rankings_snapshot.csv','points_ledger.csv','queue.csv'].map(f=>readCsv(path.join(base,f))));
const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
const errors=[];
const byId=rows=>new Set(rows.map(r=>r.player_id).filter(Boolean));
const ids=byId(players),snapshotIds=byId(snapshot),ledgerIds=byId(ledger);
if(ids.size!==players.length||snapshotIds.size!==snapshot.length)errors.push('Duplicate or blank roster IDs.');
if(ids.size!==snapshotIds.size||[...ids].some(id=>!snapshotIds.has(id)))errors.push('Roster and snapshot identities differ.');
if([...ledgerIds].some(id=>!ids.has(id)))errors.push('Ledger contains a player outside the radar roster.');
if([...ids].some(id=>!ledgerIds.has(id)))errors.push('Radar roster has players without a ledger.');
if(players.some(r=>!['M','F'].includes(r.gender))||snapshot.some(r=>!['M','F'].includes(r.gender)))errors.push('Invalid roster gender.');
const playerGender=new Map(players.map(r=>[r.player_id,r.gender]));
if(snapshot.some(r=>playerGender.get(r.player_id)!==r.gender))errors.push('Roster and snapshot genders differ.');
const queueIds=byId(queue);
if(queue.length!==manifest.additional_players||queueIds.size!==queue.length||[...queueIds].some(id=>!ids.has(id)))errors.push('Incomplete or invalid additional-player audit queue.');
if(queue.some(r=>r.ranking_date!==manifest.ranking_date))errors.push('Mixed queue dates.');
if(snapshot.some(r=>r.ranking_date!==manifest.ranking_date))errors.push('Mixed ranking dates.');
for(const gender of ['M','F']){
  const rows=snapshot.filter(r=>r.gender===gender);
  const sequence=validateCompetitionRanks(rows.map(r=>r.rank),rows.length);
  if(rows.length<RADAR_LIMIT_PER_GENDER||rows.some(r=>Number(r.rank)>RADAR_LIMIT_PER_GENDER)||!sequence.valid)errors.push(`Invalid radar boundary for ${gender}.`);
}
const pending=queue.filter(r=>r.status!=='BREAKDOWN_VALIDATED');
if(pending.length)errors.push(`${pending.length} additional players remain unvalidated.`);
const structure=validateLedgerRows(ledger);
if(!structure.valid)errors.push(...structure.errors.slice(0,10));
const totals=compareCalculatedAgainstSnapshot(calculateLedgerPoints(ledger,{policy:'drop_cutoff',dropCutoff:officialCutoff(manifest.ranking_date)}),snapshot);
if(!totals.valid)errors.push(`Official totals differ: ${totals.exact}/${totals.total} exact.`);
const fileHashes={};
for(const f of ['players.csv','rankings_snapshot.csv','points_ledger.csv','queue.csv'])fileHashes[f]=createHash('sha256').update(await fs.readFile(path.join(base,f))).digest('hex');
const report={generated_at:new Date().toISOString(),ranking_date:manifest.ranking_date,valid:errors.length===0,
  public_limit_per_gender:1000,radar_limit_per_gender:RADAR_LIMIT_PER_GENDER,players:players.length,
  ledger_players:ledgerIds.size,exact:totals.exact,total:totals.total,validated_additional:queue.length-pending.length,
  pending_additional:pending.length,hashes:fileHashes,errors};
await fs.writeFile(path.join(base,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=1;
