import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { stringify } from 'csv-stringify/sync';
import { readCsv } from './lib/official_ledger_validation.mjs';
import { LEDGER_COLUMNS, buildRankingPointsUrl, fetchJsonInsideBrowser, detectBlockedHtml } from './lib/player_breakdown.mjs';
import { validateRadarBreakdown } from './lib/radar_base.mjs';

const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const base=path.resolve(arg('base-dir','data/staging/radar_2026-09-07/base'));
const cacheRoot=path.resolve(arg('cache-root',process.cwd()));
const rawDir=path.join(base,'raw');
const limit=Number(arg('limit','25'));
const delay=Number(arg('delay-ms','5000'));
if(!Number.isInteger(limit)||limit<1||!Number.isFinite(delay)||delay<1000)throw new Error('Invalid batch size or delay.');
const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
if(manifest.status!=='STAGING_INCOMPLETE')throw new Error('Only incomplete staging can be updated.');
const [players,queue]=await Promise.all([readCsv(path.join(base,'players.csv')),readCsv(path.join(base,'queue.csv'))]);
let ledger=await readCsv(path.join(base,'points_ledger.csv'));
const playerMap=new Map(players.map(r=>[r.player_id,r]));
const rankingDate=manifest.ranking_date;
if(queue.some(r=>r.ranking_date!==rankingDate))throw new Error('Queue dates differ from staging.');
await fs.mkdir(rawDir,{recursive:true});
const atomic=async(file,text)=>{await fs.writeFile(file+'.tmp',text);await fs.rename(file+'.tmp',file);};
const persist=async()=>{
  await atomic(path.join(base,'points_ledger.csv'),stringify(ledger,{header:true,columns:LEDGER_COLUMNS}));
  await atomic(path.join(base,'queue.csv'),stringify(queue,{header:true}));
  manifest.queue_counts=Object.fromEntries([...new Set(queue.map(r=>r.status))].map(s=>[s,queue.filter(r=>r.status===s).length]));
  manifest.updated_at=new Date().toISOString();
  manifest.promotion_ready=false;
  await atomic(path.join(base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
};
const accept=(row,raw,file)=>{
  const player=playerMap.get(row.player_id);
  if(raw.player?.player_id!==row.player_id)throw new Error('Cached breakdown identity mismatch.');
  const rows=validateRadarBreakdown({json:raw.json,player,sourceUrl:raw.source_url,rankingDate,collectedAt:raw.collected_at||''});
  ledger=ledger.filter(r=>r.player_id!==row.player_id);
  ledger.push(...rows);
  Object.assign(row,{status:'BREAKDOWN_VALIDATED',error:'',raw_file:file,updated_at:new Date().toISOString()});
};
const sharedDir=path.join(cacheRoot,'data/raw/external_candidate_breakdowns');
let sharedFiles=[];
try{sharedFiles=await fs.readdir(sharedDir);}catch(e){if(e.code!=='ENOENT')throw e;}
let reused=0;
for(const row of queue.filter(r=>r.status!=='BREAKDOWN_VALIDATED')){
  const candidates=[path.join(rawDir,`${rankingDate}_${row.player_id}.json`),
    ...sharedFiles.filter(name=>name.startsWith(rankingDate+'_')&&name.endsWith('_'+row.player_id+'.json')).map(name=>path.join(sharedDir,name))];
  for(const file of candidates){
    try{
      const raw=JSON.parse(await fs.readFile(file,'utf8'));
      if(raw.ranking_date&&raw.ranking_date!==rankingDate)continue;
      accept(row,raw,file);reused++;break;
    }catch(e){if(e.code!=='ENOENT')row.error=`Cache requires review: ${e.message}`;}
  }
}
await persist();
console.log(`Validated from cache: ${reused}. Remaining: ${queue.filter(r=>r.status!=='BREAKDOWN_VALIDATED').length}`);
const selected=queue.filter(r=>['FETCH_REQUIRED','FETCH_ERROR','BLOCKED'].includes(r.status)||
  (process.argv.includes('--include-history-review')&&r.status==='HISTORY_REVIEW_REQUIRED'))
  .sort((a,b)=>Number(a.rank)-Number(b.rank)||a.gender.localeCompare(b.gender)).slice(0,limit);
if(!process.argv.includes('--cache-only')&&selected.length){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({locale:'en-US'});
    await page.goto('https://www.itftennis.com/en/rankings/world-tennis-tour-junior-rankings/',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(3000);
    for(const row of selected){
      const sourceUrl=buildRankingPointsUrl(row.player_id);
      try{
        const result=await fetchJsonInsideBrowser(page,sourceUrl,30000);
        if(!result.ok||!result.json){
          const e=new Error(`HTTP ${result.status}; ${result.contentType}`);e.isBlocked=detectBlockedHtml(result);throw e;
        }
        const raw={ranking_date:rankingDate,player:playerMap.get(row.player_id),source_url:sourceUrl,collected_at:new Date().toISOString(),json:result.json};
        const file=path.join(rawDir,`${rankingDate}_${row.player_id}.json`);
        await atomic(file,JSON.stringify(raw,null,2)+'\n');
        accept(row,raw,file);
        console.log(`Validated ${row.gender} #${row.rank} ${row.player_name}`);
      }catch(e){
        Object.assign(row,{status:e.isBlocked?'BLOCKED':'FETCH_ERROR',error:e.message,updated_at:new Date().toISOString()});
        console.log(`${row.status}: ${row.player_name}: ${row.error}`);
        if(e.isBlocked){await persist();break;}
      }
      await persist();
      await page.waitForTimeout(delay);
    }
  }finally{await browser.close();}
}
await persist();
console.log(JSON.stringify(manifest.queue_counts,null,2));
