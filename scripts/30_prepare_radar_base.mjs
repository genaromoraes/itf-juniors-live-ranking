import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'csv-stringify/sync';
import { readCsv } from './lib/official_ledger_validation.mjs';
import { LEDGER_COLUMNS } from './lib/player_breakdown.mjs';
import { RADAR_LIMIT_PER_GENDER } from './lib/ranking_limits.mjs';
import { validateRadarUniverse } from './28_inventory_radar.mjs';
import { buildRadarStaging } from './lib/radar_base.mjs';

const input = path.resolve(process.argv.find(v => v.startsWith('--input-dir='))?.slice(12) || 'data/staging/radar_2026-09-07/inventory');
const output = path.join(path.dirname(input), 'base');
const manifestFile = path.join(output, 'manifest.json');
const files = ['data/clean/players.csv', 'data/clean/rankings_snapshot.csv', 'data/clean/points_ledger.csv',
  path.join(input,'rankings_universe.csv'), path.join(input,'points_audit.csv'), path.join(input,'recovered_ledger.csv')];
const buffers = await Promise.all(files.map(file => fs.readFile(file)));
const hash = createHash('sha256');
for (const buffer of buffers) hash.update(buffer);
const fingerprint = hash.digest('hex');
let previous;
try { previous = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
catch(e) { if(e.code !== 'ENOENT') throw e; }
if (previous) {
  if (previous.input_fingerprint !== fingerprint) throw new Error('Staging inputs changed; use a new isolated inventory directory. Existing progress was preserved.');
  console.log('Matching staging already exists; preserving the queue and downloaded results.');
} else {
  const [basePlayers,baseSnapshot,baseLedger,universe,inventory,recoveredLedger] = await Promise.all(files.map(readCsv));
  validateRadarUniverse(universe,baseSnapshot[0]?.ranking_date,RADAR_LIMIT_PER_GENDER);
  const prepared = buildRadarStaging({basePlayers,baseSnapshot,baseLedger,universe,inventory,recoveredLedger});
  await fs.mkdir(output, {recursive:true});
  const write = async (name,rows,columns) => fs.writeFile(path.join(output,name), stringify(rows,{header:true,columns}));
  await write('players.csv',prepared.players,[...new Set(prepared.players.flatMap(Object.keys))]);
  await write('rankings_snapshot.csv',prepared.snapshot);
  await write('points_ledger.csv',prepared.ledger,LEDGER_COLUMNS);
  await write('queue.csv',prepared.queue);
  const manifest={schema_version:1,ranking_date:prepared.rankingDate,input_fingerprint:fingerprint,
    public_limit_per_gender:1000,radar_limit_per_gender:RADAR_LIMIT_PER_GENDER,
    counts:Object.fromEntries(['M','F'].map(g=>[g,prepared.players.filter(r=>r.gender===g).length])),
    existing_base_validation:prepared.baseline,additional_players:prepared.queue.length,
    status:'STAGING_INCOMPLETE',promotion_ready:false,created_at:new Date().toISOString()};
  await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
}
