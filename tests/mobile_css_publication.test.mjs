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
