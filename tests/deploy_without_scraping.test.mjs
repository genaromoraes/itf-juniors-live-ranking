import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy-pages.yml',import.meta.url),'utf8');
const step=workflow.split('- name: Prepare last complete weekly fallback')[1].split('- name: Install dependencies')[0];
const script=step.split("node <<'NODE'\n")[1].split('\n          NODE')[0].replace(/^          /gm,'');
for(const valid of [true,false])test(valid?'no-scrape deploy reuses matching cached week':'no-scrape deploy blocks missing data instead of collecting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'no-scrape-deploy-'));
 try {
  const clean=path.join(dir,'data/clean');fs.mkdirSync(clean,{recursive:true});
  fs.writeFileSync(path.join(clean,'rankings_snapshot.csv'),'ranking_date\n2026-09-21\n');
  fs.writeFileSync(path.join(clean,'week_tournaments.csv'),'week_start\n');
  if(valid){const cached=path.join(dir,'.previous-run/data/clean');fs.mkdirSync(cached,{recursive:true});for(const file of ['week_tournaments.csv','week_matches.csv','week_player_results.csv'])fs.writeFileSync(path.join(cached,file),'week_start\n2026-09-21\n');}
  const result=spawnSync(process.execPath,['-e',script],{cwd:dir,encoding:'utf8',env:{...process.env,REUSE_CACHED_WEEKLY_PACKAGE:'true',REQUIRE_COMPLETE_PACKAGE:'true'}});
  if(valid){assert.equal(result.status,0,result.stderr);assert.match(fs.readFileSync(path.join(clean,'week_tournaments.csv'),'utf8'),/2026-09-21/);}else {assert.notEqual(result.status,0);assert.match(result.stderr,/Publicacao sem coleta bloqueada/);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
