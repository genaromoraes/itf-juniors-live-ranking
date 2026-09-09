import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { LEDGER_COLUMNS } from './lib/player_breakdown.mjs';
import { EXTERNAL_CANDIDATE_COLUMNS } from './lib/external_candidates.mjs';

const root = process.cwd();
const base = path.resolve('data/staging/radar_2026-09-07/base');
const inventory = path.resolve('data/staging/radar_2026-09-07/inventory');
const preview = path.resolve('data/staging/radar_2026-09-07/preview');
const clean = path.join(preview, 'data', 'clean');

await fs.mkdir(clean, { recursive: true });
await fs.mkdir(path.join(preview, 'data', 'config'), { recursive: true });
await fs.mkdir(path.join(preview, 'assets'), { recursive: true });

const copy = async (source, target) => {
  await fs.copyFile(source, target);
};

for (const entry of await fs.readdir(path.resolve('data/clean'))) {
  const source = path.resolve('data/clean', entry);
  const stat = await fs.stat(source);
  if (stat.isFile() && entry.endsWith('.csv')) await copy(source, path.join(clean, entry));
}

for (const file of ['players.csv', 'rankings_snapshot.csv', 'points_ledger.csv']) {
  await copy(path.join(base, file), path.join(clean, file));
}
await copy(path.join(inventory, 'rankings_universe.csv'), path.join(clean, 'rankings_universe.csv'));
await fs.writeFile(path.join(clean, 'week_live_ledger_rows.csv'), stringify([], { header: true, columns: LEDGER_COLUMNS }));
await fs.writeFile(path.join(clean, 'external_candidates.csv'), stringify([], { header: true, columns: EXTERNAL_CANDIDATE_COLUMNS }));
await fs.writeFile(path.join(clean, 'external_candidate_ledger.csv'), stringify([], { header: true, columns: LEDGER_COLUMNS }));
await copy(path.resolve('assets/favicon.png'), path.join(preview, 'assets/favicon.png'));
await fs.writeFile(path.join(preview, 'data', 'config', 'base_state.json'), JSON.stringify({
  state: 'RADAR1500_ACTIVE',
  ranking_date: '2026-09-07',
  source: 'radar staging preview',
}, null, 2) + '\n');

console.log(JSON.stringify({ preview, clean, ranking_date: '2026-09-07', radar_per_gender: 1500 }, null, 2));
