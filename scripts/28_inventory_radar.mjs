import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createHash } from 'node:crypto';
import { extractLedgerRowsFromRankingPoints } from './lib/player_breakdown.mjs';

const parseCsv = text => parse(text, { columns: true, skip_empty_lines: true, bom: true });
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const groupById = rows => {
  const map = new Map();
  for (const row of rows) {
    if (!row.player_id) continue;
    if (!map.has(row.player_id)) map.set(row.player_id, []);
    map.get(row.player_id).push(row);
  }
  return map;
};

export function validateRadarUniverse(universe, rankingDate, targetRank) {
  if (universe.some(r => !r.player_id || r.ranking_date !== rankingDate || !['M','F'].includes(r.gender))) {
    throw new Error('Universe has invalid identities, dates or genders.');
  }
  if (new Set(universe.map(r => r.player_id)).size !== universe.length) throw new Error('Duplicate universe IDs.');
  for (const gender of ['M','F']) {
    const rows = universe.filter(r => r.gender === gender).sort((a,b) => Number(a.rank) - Number(b.rank));
    for (let i = 0; i < rows.length; i++) {
      const rank = Number(rows[i].rank);
      if (!Number.isInteger(rank) || rank < 1 || (rank !== i + 1 && !(i > 0 && rank === Number(rows[i-1].rank)))) {
        throw new Error(`Universe rank gap or invalid rank for ${gender}: ${rows[i].rank}`);
      }
    }
    if (!rows.some(r => Number(r.rank) > targetRank)) throw new Error(`Universe must extend past ${targetRank} for ${gender} to close boundary ties.`);
  }
}

export function buildRadarInventory({ universe, players, historicalLedgers, cachedLedger, targetRank = 1500 }) {
  const tracked = new Set(players.map(r => r.player_id));
  const cache = groupById(cachedLedger);
  const target = universe.filter(r => Number(r.rank) <= targetRank && Number(r.rank) > 0 && !tracked.has(r.player_id));
  const seen = new Set();
  const recovered = [];
  const inventory = target.map(row => {
    if (seen.has(row.player_id)) throw new Error(`Duplicate universe ID: ${row.player_id}`);
    seen.add(row.player_id);
    const historic = historicalLedgers.get(row.player_id);
    const cached = cache.get(row.player_id) || [];
    // Presence is evidence to investigate, never certification of current points.
    const source = cached.length ? 'EXTERNAL_CACHE' : historic?.artifact ? 'LOCAL_ARTIFACT' : historic ? 'GIT_HISTORY' : 'MISSING';
    const results = cached.length ? cached : historic?.rows || [];
    recovered.push(...results);
    return {
      ranking_date: row.ranking_date, gender: row.gender, rank: row.rank,
      player_id: row.player_id, player_name: row.player_name, official_points: row.official_points,
      source, history_commit: historic?.commit || '', history_snapshot_date: historic?.snapshotDate || '',
      artifact_path: historic?.artifact || '',
      historical_rows: historic?.rows.length || 0, external_cache_rows: cached.length,
      selected_rows: results.length,
      last_collected_at: results.map(r => r.collected_at || '').sort().at(-1) || '',
      validation_status: results.length ? 'AVAILABLE_REQUIRES_VALIDATION' : 'FETCH_REQUIRED',
    };
  });
  return { inventory, recovered };
}

async function readOptionalCsv(file) {
  try { return parseCsv(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

async function main() {
  const repo = path.resolve(arg('repo-dir', '.'));
  const cacheRoot = path.resolve(arg('cache-root', repo));
  const output = path.resolve(arg('output-dir', 'data/staging/radar_inventory'));
  const clean = path.join(repo, 'data', 'clean');
  const relative = path.relative(clean, output);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Inventory output must be outside data/clean.');
  }
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const ref = arg('ref', 'HEAD');
  const commit = git(['rev-parse', ref]).trim();
  const players = parseCsv(git(['show', `${commit}:data/clean/players.csv`]));
  const snapshot = parseCsv(git(['show', `${commit}:data/clean/rankings_snapshot.csv`]));
  const baseDate = [...new Set(snapshot.map(r => r.ranking_date))];
  if (baseDate.length !== 1) throw new Error('Mixed official base dates.');
  const extensionFile = arg('extension', '');
  const universe = extensionFile
    ? [...snapshot, ...parseCsv(await fs.readFile(path.resolve(extensionFile), 'utf8'))]
    : parseCsv(await fs.readFile(path.resolve(arg('universe', 'data/clean/rankings_universe.csv')), 'utf8'));
  if (new Set(universe.map(r => r.player_id)).size !== universe.length) throw new Error('Duplicate universe IDs.');
  if (universe.some(r => r.ranking_date !== baseDate[0])) throw new Error('Universe and base dates differ.');
  const targetRank = Number(arg('target-rank', '1500'));
  if (!Number.isInteger(targetRank) || targetRank < 1000) throw new Error('Invalid target rank.');
  validateRadarUniverse(universe, baseDate[0], targetRank);
  const tracked = new Set(players.map(r => r.player_id));
  const wanted = new Set(universe.filter(r => Number(r.rank) <= targetRank && !tracked.has(r.player_id)).map(r => r.player_id));
  const historicalLedgers = new Map();
  const commits = git(['log', commit, '--format=%H', '--', 'data/clean/points_ledger.csv']).trim().split(/\r?\n/).filter(Boolean);
  let examined = 0;
  for (const historyCommit of commits) {
    const pending = new Set([...wanted].filter(id => !historicalLedgers.has(id)));
    if (!pending.size) break;
    const rows = parseCsv(git(['show', `${historyCommit}:data/clean/points_ledger.csv`]));
    const matches = groupById(rows.filter(r => pending.has(r.player_id)));
    if (matches.size) {
      const historicalSnapshot = parseCsv(git(['show', `${historyCommit}:data/clean/rankings_snapshot.csv`]));
      const snapshotDate = historicalSnapshot[0]?.ranking_date || '';
      for (const [id, ledger] of matches) historicalLedgers.set(id, { rows: ledger, commit: historyCommit, snapshotDate });
    }
    examined++;
    console.log(`History ${examined}/${commits.length}: recovered ${historicalLedgers.size}/${wanted.size} IDs`);
  }
  const cachedLedger = await readOptionalCsv(path.join(cacheRoot, 'data/clean/external_candidate_ledger.csv'));
  const cachedIds = new Set(cachedLedger.map(r => r.player_id));
  const artifactErrors = [];
  let artifactsExamined = 0;
  if (process.argv.includes('--scan-local')) {
    const files = execFileSync('rg', ['--files', '--hidden', '--no-ignore', cacheRoot,
      '-g', 'points_ledger*.csv', '-g', 'removed_players_ledger_archive.csv',
      '-g', 'external_candidate_ledger.csv', '-g', '*.json',
      '-g', '!**/node_modules/**', '-g', '!**/.git/**'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .trim().split(/\r?\n/).filter(Boolean);
    const hashes = new Set();
    for (const file of files) {
      if (file.startsWith(repo + path.sep)) continue;
      const rawId = path.basename(file).match(/(?:^|_)(\d{9})\.json$/)?.[1];
      if (file.endsWith('.json') && (!rawId || !wanted.has(rawId) || historicalLedgers.has(rawId) || cachedIds.has(rawId))) continue;
      try {
        const text = await fs.readFile(file, 'utf8');
        const hash = createHash('sha256').update(text).digest('hex');
        if (hashes.has(hash)) continue;
        hashes.add(hash);
        let rows;
        if (file.endsWith('.json')) {
          const raw = JSON.parse(text);
          if (raw.player?.player_id !== rawId || !raw.json) continue;
          rows = extractLedgerRowsFromRankingPoints(raw.json, raw.player, raw.source_url)
            .map(r => ({ ...r, collected_at: raw.collected_at || '' }));
        } else {
          rows = parseCsv(text);
        }
        artifactsExamined++;
        const found = groupById(rows.filter(r => wanted.has(r.player_id) && !historicalLedgers.has(r.player_id) && !cachedIds.has(r.player_id) && ['singles','doubles'].includes(r.event_type)));
        for (const [id, results] of found) historicalLedgers.set(id, { rows: results, artifact: file });
      } catch (e) { artifactErrors.push({ file, error: e.message }); }
    }
  }
  const { inventory, recovered } = buildRadarInventory({ universe, players, historicalLedgers, cachedLedger, targetRank });
  const summary = {
    generated_at: new Date().toISOString(), reference_commit: commit, ranking_date: baseDate[0], target_rank: targetRank,
    universe_by_gender: Object.fromEntries(['M','F'].map(g => {
      const rows = universe.filter(r => r.gender === g);
      return [g, { rows: rows.length, max_rank: Math.max(0, ...rows.map(r => Number(r.rank))) }];
    })),
    target_outside_base: inventory.length,
    source_counts: Object.fromEntries(['EXTERNAL_CACHE','GIT_HISTORY','LOCAL_ARTIFACT','MISSING'].map(source => [source, inventory.filter(r => r.source === source).length])),
    local_artifacts_examined: artifactsExamined, artifact_errors: artifactErrors,
    historical_versions_examined: examined, recovered_rows: recovered.length,
    caveat: 'Presence is not validation. Check provenance, expiry, composition and current points before promotion. Universe coverage may be partial.',
  };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'rankings_universe.csv'), stringify(universe, { header: true }));
  await fs.writeFile(path.join(output, 'inventory.csv'), stringify(inventory, { header: true }));
  await fs.writeFile(path.join(output, 'recovered_ledger.csv'), stringify(recovered, { header: true }));
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
