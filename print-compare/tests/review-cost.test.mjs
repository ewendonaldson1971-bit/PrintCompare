import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateReviewCost,sumReviewCosts,costLabel,COST_NOTE} from '../dist/review-cost.js';
import {mergeReviewBatches} from '../dist/review-batches.js';
import {reportLines} from '../dist/ai-report.js';

test('cached tokens receive their lower rate and USD converts to AUD by dividing by 0.70',()=>{
  const cost=estimateReviewCost('gpt-4.1-2025-04-14',{input_tokens:10000,input_tokens_details:{cached_tokens:4000},output_tokens:1000});
  assert.equal(cost.usd,0.022);assert.equal(cost.aud,0.022/0.7);
  assert.equal(costLabel(cost),'Estimated AI cost (AUD): A$0.03');
  assert.equal(costLabel(estimateReviewCost('gpt-4.1',{input_tokens:100,output_tokens:10})),'Estimated AI cost (AUD): A$0.0004');
});
test('missing usage, unsupported models and invalid token counts never invent a free review',()=>{
  for(const [model,usage] of [['gpt-4.1',null],['other-model',{input_tokens:100,output_tokens:10}],['gpt-4.1',{input_tokens:-1,output_tokens:10}],['gpt-4.1',{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:101}}]])assert.equal(estimateReviewCost(model,usage),null);
  assert.match(costLabel(sumReviewCosts([null])),/unavailable/);
  const known=estimateReviewCost('gpt-4.1',{input_tokens:10000,output_tokens:1000});
  assert.match(costLabel(sumReviewCosts([known,null])),/partial/);
});
test('batch costs are summed before rounding and appear in downloaded review reports',()=>{
  const cost=estimateReviewCost('gpt-4.1',{input_tokens:10000,output_tokens:1000});
  const report={assessment:{logos:'intact',lettering:'intact',colour:'acceptable',size:'acceptable',content:'intact'},verdict:'no_significant_difference',summary:'Match',decision_reason:'Intact',differences:[],shared_elements:[],checks:[],limitations:[]};
  const batches=[1,2].map(index=>({report,cost,model:'gpt-4.1',generatedAt:'2026-11-01',detailCount:1,detailBatch:{index,total:2,expectedRegions:2}}));
  const ai=mergeReviewBatches(batches,2,2);
  assert.equal(ai.cost.aud,2*cost.aud);assert.equal(ai.cost.pricedRequests,2);
  const lines=reportLines({ai}).join('\n');assert.match(lines,/Estimated AI cost \(AUD\): A\$0.08/);assert.ok(lines.includes(COST_NOTE));
  assert.equal(sumReviewCosts([ai.cost,ai.cost]).aud,4*cost.aud);
});
