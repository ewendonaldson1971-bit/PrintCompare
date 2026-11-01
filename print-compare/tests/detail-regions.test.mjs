import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {findLetteringRegions,combineDetailRegions,encodeReviewImages} from '../dist/detail-regions.js';
test('small outlined-style white captions over a dark picture are selected for detail review',()=>{
  const c=createCanvas(1200,180),ctx=c.getContext('2d');ctx.fillStyle='#65442e';ctx.fillRect(0,0,1200,180);ctx.fillStyle='white';ctx.font='bold 12px sans-serif';ctx.fillText('ARTIST IMPRESSION RESIDENT LOBBY AND ENTRANCE TO POOL',650,167);
  const regions=findLetteringRegions(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
  assert.ok(regions.some(r=>r.x<.6&&r.x+r.width>.7&&r.y<.93&&r.y+r.height>.88));
  assert.ok(regions.every(r=>r.x>=0&&r.y>=0&&r.x+r.width<=1.00001&&r.y+r.height<=1.00001));
});
test('paired crops merge small bleed offsets and adjoining caption fragments',()=>{
  const a={x:.55,y:.9,width:.05,height:.05,score:20},b={x:.602,y:.902,width:.06,height:.05,score:25},c={x:.551,y:.901,width:.11,height:.05,score:50};
  const result=combineDetailRegions([a,b],[c]);assert.equal(result.regions.length,1);assert.equal(result.complete,true);assert.ok(result.regions[0].width>.11);
});
test('insufficient crop capacity is explicitly reported, never silently called complete',()=>{
  const regions=Array.from({length:10},(_,i)=>({x:(i%5)*.2,y:Math.floor(i/5)*.5,width:.05,height:.05,score:i+1}));
  const result=combineDetailRegions(regions,[]);assert.equal(result.regions.length,8);assert.equal(result.detected,10);assert.equal(result.complete,false);
});
test('a blank page does not invent lettering regions',()=>{
  const c=createCanvas(200,100),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,200,100);assert.deepEqual(findLetteringRegions(ctx.getImageData(0,0,200,100).data,200,100),[]);
});
test('lettering close-ups are lossless when they fit and are never silently discarded to fit a request',()=>{
  const c=createCanvas(100,30),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,100,30);ctx.fillStyle='black';ctx.font='bold 20px sans-serif';ctx.fillText('POOL',0,22);
  const details=[{region:{x:0,y:0,width:.2,height:.1},reference:c,print:c}];
  const payload=encodeReviewImages(c,c,details,true);assert.equal(payload.detailPairs.length,1);assert.ok(payload.detailPairs[0].referenceImage.startsWith('data:image/png;base64,'));assert.equal(payload.detailCoverageComplete,true);
  assert.throws(()=>encodeReviewImages(c,c,details,true,10),/not been assessed/);
});
