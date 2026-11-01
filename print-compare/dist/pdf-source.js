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

export async function renderPdfPage(pdf,pageNumber,longest,makeCanvas,{cleanup=true}={}){
  const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1});
  try{
    const viewport=page.getViewport({scale:longest/Math.max(base.width,base.height)});
    const canvas=makeCanvas(Math.max(1,Math.round(viewport.width)),Math.max(1,Math.round(viewport.height)));
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
    return canvas;
  }finally{if(cleanup)page.cleanup();}
}

export async function renderPdfRegion(pdf,pageNumber,region,longest,makeCanvas,{cleanup=true}={}){
  if(!region||![region.x,region.y,region.width,region.height].every(Number.isFinite)||region.x<0||region.y<0||region.width<=0||region.height<=0||region.x+region.width>1.00001||region.y+region.height>1.00001)throw new Error('Invalid detail region.');
  const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1});
  try{
    const scale=longest/Math.max(base.width*region.width,base.height*region.height),viewport=page.getViewport({scale});
    const canvas=makeCanvas(Math.max(1,Math.round(viewport.width*region.width)),Math.max(1,Math.round(viewport.height*region.height)));
    await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-viewport.width*region.x,-viewport.height*region.y],background:'white'}).promise;
    return canvas;
  }finally{if(cleanup)page.cleanup();}
}
