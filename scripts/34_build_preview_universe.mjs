import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const root = process.cwd();
const originalFile = path.resolve('data/staging/radar_2026-09-07/inventory/rankings_universe.csv');
const extensionFile = path.resolve('data/staging/radar_2026-09-07/universe5000/ranking_extension_1601_5000.csv');
const outputFile = path.resolve('data/staging/radar_2026-09-07/preview/data/clean/rankings_universe.csv');
const combinedFile = path.resolve('data/staging/radar_2026-09-07/universe5000/rankings_universe_1_5000.csv');

const read = async file => parse(await fs.readFile(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
const rows = [...await read(originalFile), ...await read(extensionFile)];
const seen = new Set();
const combined = rows.filter(row => {
  const key = `${row.gender}:${row.player_id}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => String(a.gender).localeCompare(String(b.gender)) || Number(a.rank) - Number(b.rank));

const columns = Object.keys(combined[0] || {});
const csv = stringify(combined, { header: true, columns });
await fs.writeFile(outputFile, csv, 'utf8');
await fs.writeFile(combinedFile, csv, 'utf8');
console.log(JSON.stringify({ rows: combined.length, by_gender: Object.fromEntries(['M', 'F'].map(g => [g, combined.filter(row => row.gender === g).length])), outputFile }, null, 2));
