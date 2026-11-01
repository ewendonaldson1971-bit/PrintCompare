import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createCanvas} from '@napi-rs/canvas';
import {openLocalPdf,renderPdfPage} from '../dist/pdf-source.js';
import {compareImages} from '../dist/compare.js';

function twoPagePdf(padding=0){
  const first='0 0.6 0 rg 40 50 80 90 re f\n',second='0.8 0 0 rg 40 50 80 90 re f\n';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 250] /Resources << >> /Contents 4 0 R >>',`<< /Length ${first.length} >>\nstream\n${first}endstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 250] /Resources << >> /Contents 6 0 R >>',`<< /Length ${second.length} >>\nstream\n${second}endstream`];
  let pdf='%PDF-1.4\n',offsets=[];
  for(let i=0;i<objects.length;i++){if(i===2&&padding)pdf+='%'+'.'.repeat(padding)+'\n';offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 7\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Blob([pdf],{type:'application/pdf'});
}
test('local PDF loading reads file slices rather than the entire file and supports page selection',async()=>{
  const blob=twoPagePdf(3*1024*1024),reads=[];
  const file={name:'large-reference.pdf',size:blob.size,arrayBuffer:()=>assert.fail('must not read the whole source file eagerly'),slice:(start,end)=>{reads.push([start,end]);return blob.slice(start,end);}};
  const reference=await openLocalPdf(file,pdfjs);
  try{
    assert.equal(reference.numPages,2);
    const first=await renderPdfPage(reference,1,250,createCanvas),second=await renderPdfPage(reference,2,250,createCanvas);
    assert.equal(first.width,200);assert.equal(first.height,250);
    const a=first.getContext('2d').getImageData(0,0,200,250).data,b=second.getContext('2d').getImageData(0,0,200,250).data;
    assert.equal(compareImages(a,a,200,250).changed,0);
    assert.ok(compareImages(a,b,200,250).percent>5,'different PDF reference pages must produce different comparisons');
    assert.ok(reads.length>1);assert.ok(reads.every(([start,end])=>end-start<file.size),'no single read should eagerly consume the complete PDF');
  }finally{await reference.loadingTask.destroy();}
});
test('an invalid reference PDF is rejected rather than treated as a valid proof',async()=>{
  await assert.rejects(()=>openLocalPdf(new Blob(['not a PDF']),pdfjs));
});
