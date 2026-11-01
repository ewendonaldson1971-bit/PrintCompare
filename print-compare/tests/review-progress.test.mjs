import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewProgress,durationLabel} from '../dist/review-progress.js';

test('progress includes local preparation, multiple proofs and all discovered detail batches',()=>{
  const p=new ReviewProgress(2,2,0);
  assert.equal(p.snapshot(0).fraction,0);assert.equal(p.snapshot(0).remaining,null);
  p.finishLocal(1000);assert.equal(p.snapshot(1000).fraction,0.1);
  p.finishLocal(2000);p.beginAi(2,2000);p.planBatches(3);
  assert.ok(p.snapshot(3000).fraction>0.2);assert.equal(p.snapshot(3000).remaining,null);
  p.finishBatch(13000);const first=p.snapshot(13000);
  assert.ok(first.remaining>0);assert.ok(p.snapshot(15000).remaining<first.remaining);
  p.finishBatch(24000);p.finishBatch(35000);p.finishPair(35000);
  assert.ok(Math.abs(p.snapshot(35000).fraction-0.6)<1e-10);
  p.planBatches(1);p.finishBatch(46000);p.finishPair(46000);
  assert.equal(p.snapshot(46000).fraction,0.99);
  p.finish(true);assert.equal(p.snapshot(47000).fraction,1);assert.equal(p.snapshot(47000).remaining,null);
});
test('single review retries and cancelled or unsuccessful runs do not show completion',()=>{
  const p=new ReviewProgress(0,1,0);p.beginAi(1,0);p.planBatches(2);p.finishBatch(10000);
  const partial=p.snapshot(10000).fraction;p.finish(false);
  assert.equal(p.snapshot(20000).fraction,partial);assert.equal(p.snapshot(20000).remaining,null);
  const retry=new ReviewProgress(0,1,20000);assert.equal(retry.snapshot(20000).fraction,0);
});
test('local-only comparisons estimate remaining time after the first proof, and overruns never go negative',()=>{
  const p=new ReviewProgress(2,0,0);p.finishLocal(10000);
  assert.equal(p.snapshot(10000).remaining,10);assert.equal(p.snapshot(13000).remaining,7);
  assert.equal(p.snapshot(30000).remaining,0);p.finishLocal(30000);p.finish(true);assert.equal(p.snapshot(30000).fraction,1);
  assert.equal(durationLabel(20),'less than a minute');assert.equal(durationLabel(121),'3 min');assert.equal(durationLabel(3660),'1 hr 1 min');
});
