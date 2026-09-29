import fs from 'node:fs/promises';
import path from 'node:path';
const base = 'https://www.juniorsliveranking.com.br/';
const output = path.resolve(process.argv[2] || 'data/exports');
const get = async name => {
  const response = await fetch(new URL(name, base), {headers: {'Cache-Control':'no-cache'}});
  if (!response.ok) throw new Error(`Published file unavailable: ${name} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};
const index = await get('');
const html = index.toString('utf8');
if (!html.includes('const rankingData =') || !html.includes('details_chunk')) throw new Error('Published ranking payload missing.');
const chunks = [...html.matchAll(/"details_chunk":(\d+)/g)].map(m => Number(m[1]));
const queue = new Set(['index.html','sitemap.xml','robots.txt','ads.txt','favicon.png','404.html','live_ranking.html']);
for (const n of new Set(chunks)) queue.add('player-details-' + String(n+1).padStart(2,'0') + '.js');
const files = new Map([['index.html', index]]);
for (const name of queue) {
  const bytes = files.get(name) || await get(name);
  files.set(name, bytes);
  if (name.endsWith('.html') || name.endsWith('.xml')) {
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/(?:src|href)="([a-zA-Z0-9_./-]+\.(?:html|js|css|png|svg|ico))"/g)) {
      const asset = match[1].replace(/^\.\//,'');
      if (!asset.includes('..') && !asset.startsWith('/')) queue.add(asset);
    }
    for (const match of text.matchAll(/<loc>https:\/\/www\.juniorsliveranking\.com\.br\/([a-zA-Z0-9_-]+\.html)<\/loc>/g)) queue.add(match[1]);
  }
}
if (!(await get('')).equals(index)) throw new Error('Published site changed during snapshot; retry with one consistent version.');
await fs.mkdir(output,{recursive:true});
for(const [name,bytes] of files) {
  const target=path.resolve(output,name);
  if (!target.startsWith(output+path.sep)) throw new Error('Invalid asset path');
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,bytes);
}
await fs.writeFile(path.join(output,'CNAME'),'www.juniorsliveranking.com.br\n');
console.log(`Preserved ${files.size} published files and ${chunks.length} ranking entries; no ITF requests or ranking calculations.`);
