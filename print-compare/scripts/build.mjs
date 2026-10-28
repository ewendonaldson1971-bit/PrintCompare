import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist/vendor', { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await cp(`node_modules/pdfjs-dist/build/${file}`, `dist/vendor/${file}`);
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${dir}`, `dist/vendor/${dir}`, { recursive: true });
console.log('Built Print Compare in dist/');
