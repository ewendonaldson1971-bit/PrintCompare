import test from 'node:test';
import assert from 'node:assert/strict';
import {compareImages} from '../dist/compare.js';
function white(w=160,h=160){return new Uint8ClampedArray(w*h*4).fill(255);}
function rect(data,x,y,w,h,color=[0,0,0],width=160){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*width+xx)*4;data.set([...color,255],i);}}
test('identical images have no differences and no offset',()=>{const a=white();rect(a,30,30,40,60);const r=compareImages(a,a,160,160);assert.equal(r.changed,0);assert.equal(r.regions.length,0);assert.equal(r.shiftX,0);assert.equal(r.shiftY,0);});
test('missing artwork produces a bounded discrepancy region',()=>{const a=white(),b=white();rect(a,50,50,35,35);const r=compareImages(a,b,160,160);assert.ok(r.percent>3);assert.equal(r.regions.length,1);assert.ok(r.regions[0].x<=50);assert.ok(r.regions[0].x+r.regions[0].width>=85);});
test('minor JPEG-like noise does not flag a white proof',()=>{const a=white(),b=white();for(let i=0;i<b.length;i+=4){b[i]=248;b[i+1]=250;b[i+2]=247;}const r=compareImages(a,b,160,160);assert.equal(r.changed,0);});
test('colour changes are detected',()=>{const a=white(),b=white();rect(a,35,35,70,70,[180,40,40]);rect(b,35,35,70,70,[40,40,180]);assert.ok(compareImages(a,b,160,160).percent>10);});
test('small rendering offsets are aligned',()=>{const a=white(),b=white();rect(a,35,35,50,50);rect(b,36,36,50,50);const r=compareImages(a,b,160,160);assert.equal(r.shiftX,1);assert.equal(r.shiftY,1);assert.equal(r.changed,0);});
test('detailed sensitivity catches changes balanced tolerates',()=>{const a=white(),b=white();rect(b,35,35,50,50,[234,234,234]);assert.ok(compareImages(a,b,160,160,'detailed').changed>0);assert.equal(compareImages(a,b,160,160,'balanced').changed,0);});
test('invalid pixel dimensions are rejected',()=>{assert.throws(()=>compareImages(white(),new Uint8ClampedArray(4),160,160));});
