import test from 'node:test';
import assert from 'node:assert/strict';
import {planDetailBatches,mergeReviewBatches} from '../dist/review-batches.js';
const assessment={logos:'intact',lettering:'intact',colour:'acceptable',size:'acceptable',content:'intact'};
function response(index,total,count,expected,changes={}){return {model:'test',generatedAt:'2026-11-01',detailCount:count,detailBatch:{index,total,expectedRegions:expected},report:{assessment:{...assessment,...changes},verdict:changes.lettering==='filled_or_damaged'?'differences_found':'no_significant_difference',summary:'Artwork matches the reference.',decision_reason:'All supplied details are intact.',differences:[],shared_elements:['Artwork'],checks:[],limitations:[]}};}
test('all detail regions are assigned to batches, including regions beyond the old eight-region limit',()=>{
 const regions=Array.from({length:19},(_,id)=>({id})),batches=planDetailBatches(regions);assert.deepEqual(batches.map(b=>b.length),[8,8,3]);assert.deepEqual(batches.flat(),regions);
 assert.deepEqual(planDetailBatches([]),[[]]);
});
test('a matching comparison with more than eight regions passes after every batch completes',()=>{
 const result=mergeReviewBatches([response(1,2,8,11),response(2,2,3,11)],2,11);assert.equal(result.report.status,'pass');assert.equal(result.coverage.complete,true);assert.equal(result.detailCount,11);
});
test('a stopped, failed or missing later batch never converts an earlier pass to an overall pass',()=>{
 const result=mergeReviewBatches([response(1,2,8,11)],2,11);assert.equal(result.report.status,'not_assessed');assert.equal(result.coverage.complete,false);
});
test('a filled counter in a later batch fails the whole comparison',()=>{
 const result=mergeReviewBatches([response(1,2,8,11),response(2,2,3,11,{lettering:'filled_or_damaged'})],2,11);assert.equal(result.report.status,'fail');assert.equal(result.report.assessment.content,'significant_change');
});
test('a confirmed defect remains a failure even if a subsequent review cannot finish',()=>{
 assert.equal(mergeReviewBatches([response(1,2,8,11,{lettering:'filled_or_damaged'})],2,11).report.status,'fail');
});
test('genuine uncertainty and duplicate batch results cannot produce a pass',()=>{
 assert.equal(mergeReviewBatches([response(1,2,8,11),response(2,2,3,11,{lettering:'uncertain'})],2,11).report.status,'not_assessed');
 assert.equal(mergeReviewBatches([response(1,2,8,16),response(1,2,8,16)],2,16).report.status,'not_assessed');
});
