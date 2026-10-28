// Synthetic files for manually checking the complete upload/render/compare flow.
import {createCanvas} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const stream='0.12 0.35 0.26 rg 50 280 280 140 re f\n0 0 0 rg 50 188 180 12 re f\n';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
let pdf='%PDF-1.4\n',offsets=[0];
for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
const start=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
await writeFile('test-results/print.pdf',pdf);
for(const changed of [false,true]){
  const c=createCanvas(400,500),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,500);ctx.fillStyle='rgb(31,89,66)';ctx.fillRect(50,80,280,140);
  if(!changed){ctx.fillStyle='black';ctx.fillRect(50,300,180,12);}
  await writeFile(`test-results/${changed?'missing-content':'matching'}.jpg`,c.toBuffer('image/jpeg',92));
}
console.log('Created PDF and matching/changed JPEG fixtures in test-results/');
