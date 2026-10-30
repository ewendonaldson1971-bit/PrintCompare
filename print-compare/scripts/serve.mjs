import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handleReview, MAX_BODY_BYTES } from '../server/artwork-review.mjs';
const root = path.resolve('dist');
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server = http.createServer(async (req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if (pathname === '/.netlify/functions/artwork-review') {
    const chunks=[];let bytes=0;
    for await (const chunk of req) { bytes+=chunk.length; if(bytes>MAX_BODY_BYTES){res.writeHead(413,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Image pair is too large.'}));return;}chunks.push(chunk); }
    const response = await handleReview(new Request(new URL(req.url,'http://127.0.0.1:4173'), {method:req.method,headers:req.headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await readFile(file); res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404).end('Not found'); }
});
const port=Number(process.env.PORT || 4173);
server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}`));
