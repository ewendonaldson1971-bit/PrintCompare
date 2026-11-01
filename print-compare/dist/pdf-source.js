// Read local PDF ranges on demand. Neither complete PDF is uploaded to a server.
export async function openLocalPdf(file,pdfjs){
  const chunkSize=1024*1024;
  const initialData=new Uint8Array(await file.slice(0,Math.min(chunkSize,file.size)).arrayBuffer());
  let task;
  class LocalRange extends pdfjs.PDFDataRangeTransport{
    stopped=false;
    requestDataRange(begin,end){
      if(this.stopped)return;
      file.slice(begin,end).arrayBuffer().then(buffer=>{
        if(!this.stopped)this.onDataRange(begin,new Uint8Array(buffer));
      }).catch(()=>{if(!this.stopped){this.stopped=true;void task?.destroy().catch(()=>{});}});
    }
    abort(){this.stopped=true;}
  }
  const range=new LocalRange(file.size,initialData,initialData.byteLength===file.size,file.name);
  task=pdfjs.getDocument({range,length:file.size,rangeChunkSize:chunkSize,disableAutoFetch:true,disableStream:true,cMapUrl:'./vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'./vendor/standard_fonts/',wasmUrl:'./vendor/wasm/',isEvalSupported:false});
  task.onPassword=()=>{void task.destroy().catch(()=>{});};
  try{return await task.promise;}catch(error){await task.destroy().catch(()=>{});throw error;}
}

export async function renderPdfPage(pdf,pageNumber,longest,makeCanvas){
  const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1});
  try{
    const viewport=page.getViewport({scale:longest/Math.max(base.width,base.height)});
    const canvas=makeCanvas(Math.max(1,Math.round(viewport.width)),Math.max(1,Math.round(viewport.height)));
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
    return canvas;
  }finally{page.cleanup();}
}
