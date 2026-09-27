import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMobileLayout} from '../scripts/27_publish_mobile_css.mjs';
const marker='      .table-scroll-wrap + .load-more-rows';
const generator='      /* Fit every ranking column */\n.table-scroll-wrap table {width:100%;}\n'+marker+' {}';
const html='<style>@media (max-width: 720px) {\n      .table-scroll-wrap {overflow:auto;}\n'+marker+' {} }</style><script>const rankingData=[{points:42}];</script>';
test('only replaces mobile CSS and keeps rankings and scripts intact',()=>{
 const result=applyMobileLayout(html,generator);
 assert.ok(result.endsWith('<script>const rankingData=[{points:42}];</script>'));
 assert.ok(result.includes('width:100%'));
 assert.equal(applyMobileLayout(result,generator),result);
});
test('refuses an unknown published layout',()=>assert.throws(()=>applyMobileLayout('<h1>unknown</h1>',generator),/boundaries/));
test('touch override preserves existing desktop CSS and is idempotent',()=>{
 const scoped='@media (max-width: 1024px) and (hover: none) and (pointer: coarse) { .page {width:100%;} }\n  </style>';
 const original='<style>.desktop {width:900px;}</style><script>const scores=[42]</script>';
 const result=applyMobileLayout(original,scoped);
 assert.ok(result.startsWith('<style>.desktop {width:900px;}'));
 assert.ok(result.endsWith('<script>const scores=[42]</script>'));
 assert.equal(applyMobileLayout(result,scoped),result);
});
