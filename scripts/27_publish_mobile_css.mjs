import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function applyMobileLayout(html, generator) {
  const scopedQuery = '@media (max-width: 1024px) and (hover: none) and (pointer: coarse) {';
  const scopedStart = generator.indexOf(scopedQuery);
  if (scopedStart >= 0) {
    const scopedEnd = generator.indexOf('  </style>', scopedStart);
    const styleStart = html.indexOf('<style>');
    const styleEnd = html.indexOf('</style>', styleStart);
    if (scopedEnd < 0 || styleStart < 0 || styleEnd < 0) throw new Error('Mobile CSS boundaries not found.');
    const marker = '/* Mobile touch layout override */';
    const previous = html.indexOf(marker, styleStart);
    const insertAt = previous >= 0 && previous < styleEnd ? previous : styleEnd;
    const result = html.slice(0, insertAt) + marker + '\n' + generator.slice(scopedStart, scopedEnd) + html.slice(styleEnd);
    const strip = text => text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    if (strip(html) !== strip(result)) throw new Error('Changes outside CSS detected.');
    return result;
  }
  const startMarker = '      /* Fit every ranking column';
  const endMarker = '      .table-scroll-wrap + .load-more-rows';
  const sourceStart = generator.indexOf(startMarker);
  const sourceEnd = generator.indexOf(endMarker, sourceStart);
  const mobileStart = html.indexOf('@media (max-width: 720px)');
  const existingMarker = html.indexOf(startMarker, mobileStart);
  const targetStart = existingMarker >= 0 ? existingMarker : html.indexOf('      .table-scroll-wrap {', mobileStart);
  const targetEnd = html.indexOf(endMarker, targetStart);
  if ([sourceStart, sourceEnd, mobileStart, targetStart, targetEnd].some(n => n < 0)) throw new Error('Mobile CSS boundaries not found; refusing to modify published artifact.');
  const result = html.slice(0, targetStart) + generator.slice(sourceStart, sourceEnd) + html.slice(targetEnd);
  const withoutStyles = text => text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  if (withoutStyles(html) !== withoutStyles(result)) throw new Error('Changes outside CSS detected.');
  return result;
}

export function applyMobileViewport(html, generator) {
  const start = generator.indexOf('    const mobileLayoutQuery =');
  if (start < 0) return html;
  const end = generator.indexOf('    applyLanguage(currentLanguage);', start);
  if (end < 0 || !html.includes('</body>')) throw new Error('Viewport script boundaries not found.');
  const script = generator.slice(start, end);
  const clean = html.replace(/<script id="mobile-viewport-layout">[\s\S]*?<\/script>\n?/g, '');
  return clean.replace('</body>', '<script id="mobile-viewport-layout">\n' + script + '</script>\n</body>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] || 'data/exports');
  const file = path.join(directory, 'index.html');
  const generator = fs.readFileSync('scripts/09_generate_live_ranking_html.mjs', 'utf8');
  const original = fs.readFileSync(file, 'utf8');
  const updated = applyMobileViewport(applyMobileLayout(original, generator), generator);
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(file, updated);
  console.log(JSON.stringify({ sourceHtml: hash(original), publishedHtml: hash(updated), change: 'mobile CSS and viewport sizing only; ranking and match data preserved' }));
}
