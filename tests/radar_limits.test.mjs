import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promoteTop1000Base } from '../scripts/lib/top1000_migration.mjs';

test('radar activation expands collectors and validators to 1500 while keeping the public limit at 1000', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-limits-'));
  await fs.mkdir(path.join(cwd, 'data/config'), {recursive:true});
  await fs.writeFile(path.join(cwd, 'data/config/base_state.json'), JSON.stringify({state:'RADAR1500_ACTIVE'}));
  const moduleUrl = pathToFileURL(path.resolve('scripts/lib/ranking_limits.mjs')).href;
  const validationUrl = pathToFileURL(path.resolve('scripts/08_calculate_live_ranking_with_drops.mjs')).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as limits from ${JSON.stringify(moduleUrl)};
    import {validatePlayersBase} from ${JSON.stringify(validationUrl)};
    const players=['M','F'].flatMap(gender=>Array.from({length:1500},(_,i)=>({player_id:gender+i,gender})));
    console.log(JSON.stringify({public:limits.PUBLIC_RANK_LIMIT_PER_GENDER,tracked:limits.TRACKED_BASE_TOTAL,
      active:limits.getActiveBaseTotal(),valid:validatePlayersBase(players).isValid,
      truncated:validatePlayersBase(players.slice(0,2000)).isValid}));
  `], {cwd,encoding:'utf8'});
  assert.deepEqual(JSON.parse(output), {public:1000,tracked:3000,active:3000,valid:true,truncated:false});
  await assert.rejects(promoteTop1000Base({cwd,confirm:true}), /cannot replace/);
});
