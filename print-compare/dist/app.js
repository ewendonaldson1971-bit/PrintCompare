import * as pdfjs from './vendor/pdf.mjs';
import { renderAiReport, reportLines } from './ai-report.js';
import { pairStatus, overallStatus, STATUS_LABELS, ACCEPTANCE_RULES } from './assessment.js';
import { openLocalPdf, renderPdfPage, renderPdfRegion } from './pdf-source.js';
import { combineDetailRegions, encodeReviewImages } from './detail-regions.js';
import { planDetailBatches, mergeReviewBatches } from './review-batches.js';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const state={pdf:null,pdfFile:null,proofs:[],results:[],active:0,mode:'side',busy:false,pdfLoading:false,proofLoading:0,pdfRevision:0,preset:'balanced',runPreset:'balanced',aiConfigured:null,aiRunning:false,stopAi:false,aiController:null};
const MAX_PDF=5*1024*1024*1024,MAX_JPG=25*1024*1024;
const MAX_PAIRS=30;
const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;return el;};
const message=(content,error=false)=>{const el=$('message');el.textContent=content;el.hidden=!content;el.className=error?'error':'';};
const size=bytes=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;
const proofLabel=proof=>proof.kind==='pdf'?`${proof.file.name} (reference page ${proof.referencePage})`:proof.file.name;
function removeProofs(removed){
  state.proofs=state.proofs.filter(p=>!removed.includes(p));
  for(const pdf of new Set(removed.filter(p=>p.kind==='pdf').map(p=>p.pdf)))if(!state.proofs.some(p=>p.pdf===pdf))void releasePdf(pdf);
  for(const proof of removed)if(proof.url)URL.revokeObjectURL(proof.url);
  renderFiles();renderPairing();invalidate();
}
const aiSection=text('section','','ai-report');aiSection.id='ai-report';aiSection.setAttribute('aria-label','AI artwork report');$('findings').before(aiSection);
const overallBanner=text('div','','decision-banner');overallBanner.id='overall-status';overallBanner.setAttribute('role','status');$('result-summary').before(overallBanner);
function invalidate(){state.results=[];$('results').hidden=true;update();}
async function releasePdf(pdf){if(pdf)try{await pdf.loadingTask.destroy();}catch{/* A disposed loading task needs no further cleanup. */}}
function update(){
  const ready=!!state.pdf&&state.proofs.length>0&&!state.pdfLoading&&!state.proofLoading;
  $('compare').disabled=!ready||state.busy;
  $('compare').firstElementChild.textContent=state.busy?'Comparing…':'Compare files';
  $('ready-title').textContent=state.busy?'Checking the details…':ready?'Your files are ready':'Ready when you are';
  $('ready-description').textContent=state.busy?'Rendering pages and checking each proof. Keep this tab open.':ready?`${state.pdf.numPages} PDF page${state.pdf.numPages===1?'':'s'} · ${state.proofs.length} reference${state.proofs.length===1?'':'s'} paired for comparison.`:'Add your print file and reference proofs to get started.';
  $('ready-dot').style.background=ready?'#6c9548':'#9ba88a';
  $('nav-count').textContent=state.results.length;
  $('step2').classList.toggle('active',ready);$('step3').classList.toggle('active',state.results.length>0);
  $('pdf-input').disabled=state.busy;$('jpg-input').disabled=state.busy;
  $('new-comparison').disabled=state.busy||state.pdfLoading||state.proofLoading>0;
  $('ai-enabled').disabled=state.busy;$('ai-refresh').disabled=state.busy;
  $('stop-ai').hidden=!state.aiRunning;
  $('download-report').disabled=state.busy;
  $('results').classList.toggle('ai-running',state.aiRunning);
}
async function checkAiConfiguration(){
  const status=$('ai-status');
  try{const response=await fetch('/.netlify/functions/artwork-review',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();if(typeof data.configured!=='boolean')throw new Error();state.aiConfigured=data.configured;status.textContent=data.configured?'AI service configured':'AI setup needed: enable gateway or add a server key';status.dataset.ready=String(data.configured);}
  catch{state.aiConfigured=null;status.textContent='AI service is unavailable. Local checks still work.';status.dataset.ready='false';}
  return state.aiConfigured===true;
}
$('ai-refresh').onclick=checkAiConfiguration;
$('stop-ai').onclick=()=>{state.stopAi=true;state.aiController?.abort();$('stop-ai').disabled=true;};
function inspectionLength(width,height){const ratio=Math.max(width,height)/Math.min(width,height);return Math.min(9000,Math.round(Math.sqrt(10_000_000*ratio)));}
async function locateLettering(source){
  const width=source.width,height=source.height,pixels=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
  source.width=source.height=1;
  return new Promise((resolve,reject)=>{
    const worker=new Worker('./detail-worker.js',{type:'module'});
    worker.onmessage=event=>{worker.terminate();event.data.error?reject(new Error(event.data.error)):resolve(event.data.regions);};
    worker.onerror=()=>{worker.terminate();reject(new Error('Could not inspect small lettering. Please retry this pair.'));};
    worker.postMessage({pixels,width,height},[pixels.buffer]);
  });
}
async function renderReferenceRegion(proof,region,longest){
  if(proof.kind==='pdf')return renderPdfRegion(proof.pdf,proof.referencePage,region,longest,canvas,{cleanup:false});
  const img=new Image();img.src=proof.url;await img.decode();
  const w=proof.width*region.width,h=proof.height*region.height,scale=Math.min(1,longest/Math.max(w,h)),out=canvas(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));
  out.getContext('2d').drawImage(img,proof.width*region.x,proof.height*region.y,w,h,0,0,out.width,out.height);return out;
}
async function* prepareAiBatches(result){
  const proof=state.proofs.find(p=>p.id===result.proofId);
  if(!proof)throw new Error('The reference is no longer available. Compare the files again.');
  const page=await state.pdf.getPage(result.page),base=page.getViewport({scale:1});
  const referencePage=proof.kind==='pdf'?await proof.pdf.getPage(proof.referencePage):null;
  try{
    // Render the PDF separately at higher resolution; do not upsample the low-resolution proof.
    const viewport=page.getViewport({scale:2000/Math.max(base.width,base.height)});
    const print=canvas(Math.max(1,Math.round(viewport.width)),Math.max(1,Math.round(viewport.height)));
    await page.render({canvasContext:print.getContext('2d'),viewport,background:'white'}).promise;
    const reference=referencePage?await renderPdfPage(proof.pdf,proof.referencePage,2000,canvas,{cleanup:false}):await renderProofSource(proof,2000);
    message(`Inspecting small lettering: ${result.name}`);
    const printAnalysis=await renderPdfPage(state.pdf,result.page,inspectionLength(base.width,base.height),canvas,{cleanup:false});
    const printRegions=await locateLettering(printAnalysis);
    const referenceAnalysis=referencePage?await renderPdfPage(proof.pdf,proof.referencePage,inspectionLength(reference.width,reference.height),canvas,{cleanup:false}):await renderProofSource(proof,inspectionLength(reference.width,reference.height));
    const referenceRegions=await locateLettering(referenceAnalysis);
    const selection=combineDetailRegions(referenceRegions,printRegions),batches=planDetailBatches(selection.regions);
    result.reviewPlan={batches:batches.length,regions:selection.regions.length};
    for(const [index,regions]of batches.entries()){
      const detailCanvases=[];
      for(const [regionIndex,region]of regions.entries()){
        if(state.stopAi)throw new DOMException('Review stopped.','AbortError');
        message(`Preparing lettering close-up ${index*8+regionIndex+1} of ${selection.regions.length}: ${result.name}`);
        const crop={x:region.x,y:region.y,width:region.width,height:region.height};
        detailCanvases.push({region:crop,reference:await renderReferenceRegion(proof,crop,1800),print:await renderPdfRegion(state.pdf,result.page,crop,1800,canvas,{cleanup:false})});
      }
      const payload=encodeReviewImages(reference,print,detailCanvases,true);result.detailPreviews.push(...payload.detailPairs);
      yield {...payload,detailBatch:{index:index+1,total:batches.length,expectedRegions:selection.regions.length}};
    }
  }finally{page.cleanup();referencePage?.cleanup();}
}
async function generateAiForResult(result){
  result.aiPending=true;result.aiError=null;result.ai=null;result.detailPreviews=[];result.reviewPlan=null;renderResults();
  const controller=new AbortController(),responses=[];state.aiController=controller;
  try{
    for await(const images of prepareAiBatches(result)){
      if(state.stopAi)throw new DOMException('Review stopped.','AbortError');
      message(`Reviewing lettering batch ${images.detailBatch.index} of ${images.detailBatch.total}: ${result.name}`);
      const response=await fetch('/.netlify/functions/artwork-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...images,referenceName:result.name,referenceType:result.referenceType,referencePage:result.referencePage,pdfName:state.pdfFile.name,page:result.page,referenceDimensions:`${result.proofWidth} × ${result.proofHeight} pixels${result.referenceType==='pdf'?' (rendered PDF reference page)':''}`}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(65000)])});
      let payload;try{payload=await response.json();}catch{throw new Error(response.status===429?'AI request limit reached. Please try again later.':'The AI service returned an unreadable response. Please try again.');}
      if(!response.ok)throw new Error(payload.error||'AI review could not be completed. Please retry.');
      if(!payload.report)throw new Error('The AI report was incomplete. Please retry.');
      responses.push(payload);
    }
    result.ai=mergeReviewBatches(responses,result.reviewPlan.batches,result.reviewPlan.regions);
  }catch(error){
    result.aiError=error.name==='AbortError'?'AI review was stopped before all batches completed.':error.name==='TimeoutError'?'AI review took too long. Please try this pair again.':error.message;
    if(responses.length)result.ai=mergeReviewBatches(responses,result.reviewPlan.batches,result.reviewPlan.regions);
  }
  finally{result.aiPending=false;state.aiController=null;renderResults();}
}
function renderCurrentAi(){
  const result=state.results[state.active];if(!result)return;
  renderAiReport(aiSection,result,{busy:state.busy,onGenerate:()=>runSingleAi(result)});
}
async function runSingleAi(result){
  if(state.busy||result.error)return;
  state.busy=true;state.aiRunning=true;state.stopAi=false;$('stop-ai').disabled=false;update();renderPairing();renderCurrentAi();
  try{
    if(!await checkAiConfiguration()){result.aiError=state.aiConfigured===false?'AI reporting needs the server API key. Add OPENAI_API_KEY in Netlify with Functions scope and redeploy, then click Generate AI report.':'The AI service is unavailable. Please try again later.';renderCurrentAi();return;}
    message(`AI reviewing page ${result.page}: ${result.name}`);await generateAiForResult(result);
  }finally{state.busy=false;state.aiRunning=false;update();renderPairing();renderCurrentAi();message('');}
}
function fileRow(name,detail,remove){const row=text('div','','file-row');row.append(text('span',name),text('small',detail));const button=text('button','×');button.type='button';button.setAttribute('aria-label',`Remove ${name}`);button.onclick=()=>{if(!state.busy)remove();};row.append(button);return row;}
function renderFiles(){
  $('pdf-list').replaceChildren();$('jpg-list').replaceChildren();
  if(state.pdfFile)$('pdf-list').append(fileRow(state.pdfFile.name,`${state.pdf.numPages} pages · ${size(state.pdfFile.size)}`,()=>{state.pdfRevision++;releasePdf(state.pdf);state.pdf=null;state.pdfFile=null;renderFiles();renderPairing();invalidate();}));
  const shown=new Set();
  for(const proof of state.proofs){
    if(proof.kind==='pdf'){
      if(shown.has(proof.pdf))continue;shown.add(proof.pdf);
      const pairs=state.proofs.filter(p=>p.pdf===proof.pdf);
      const row=fileRow(proof.file.name,`PDF · ${proof.pdf.numPages} pages · ${pairs.length} paired · ${size(proof.file.size)}`,()=>removeProofs(state.proofs.filter(p=>p.pdf===proof.pdf)));
      const add=text('button','+ Page');add.type='button';add.className='add-reference-page';add.setAttribute('aria-label',`Add a reference page from ${proof.file.name}`);add.disabled=state.busy||state.proofLoading>0||state.proofs.length>=MAX_PAIRS;
      add.onclick=()=>{if(state.busy||state.proofs.length>=MAX_PAIRS)return;const referencePage=Math.min(proof.pdf.numPages,Math.max(...pairs.map(p=>p.referencePage))+1);state.proofs.push({...proof,id:crypto.randomUUID(),referencePage,page:Math.min(state.proofs.length+1,state.pdf?.numPages||1)});renderFiles();renderPairing();invalidate();};
      row.insertBefore(add,row.lastChild);$('jpg-list').append(row);
    }else $('jpg-list').append(fileRow(proof.file.name,size(proof.file.size),()=>removeProofs([proof])));
  }
  $('pdf-drop-title').textContent=state.pdf?'Drop a PDF to replace it':'Drop your print PDF here';
  $('jpg-drop-title').textContent=state.proofs.length?'Drop more PDF or JPEG proofs here':'Drop your PDF or JPEG proofs here';
}
async function loadPdf(files){
  if(state.busy||!files.length)return;
  if(files.length!==1){message('Please add one PDF print file.',true);return;}
  const file=files[0];
  if(!/\.pdf$/i.test(file.name)||file.size>MAX_PDF){message('Choose a PDF smaller than 5 GB.',true);return;}
  const revision=++state.pdfRevision;state.pdfLoading=true;update();message('Opening your print PDF…');
  try{
    const pdf=await openLocalPdf(file,pdfjs);
    if(revision!==state.pdfRevision){await releasePdf(pdf);return;}
    releasePdf(state.pdf);state.pdf=pdf;state.pdfFile=file;
    for(let i=0;i<state.proofs.length;i++)state.proofs[i].page=Math.min(i+1,pdf.numPages);
    renderFiles();renderPairing();invalidate();message('');
  }catch(error){if(revision===state.pdfRevision)message('Could not open this PDF. Check that it is valid and not password protected. Large PDFs may exceed your browser memory limits.',true);}
  finally{if(revision===state.pdfRevision){state.pdfLoading=false;update();}$('pdf-input').value='';}
}
async function loadProofs(files){
  if(state.busy||!files.length)return;
  state.proofLoading++;update();const errors=[];
  try{for(const file of files){
    const isPdf=/\.pdf$/i.test(file.name);
    if((!isPdf&&!/\.(jpe?g)$/i.test(file.name))||file.size>(isPdf?MAX_PDF:MAX_JPG)){errors.push(`${file.name}: choose a PDF up to 5 GB or a JPEG up to 25 MB.`);continue;}
    if(state.proofs.length>=MAX_PAIRS){errors.push('Up to 30 page pairs can be compared in one batch.');break;}
    if(state.proofs.some(p=>p.file.name===file.name&&p.file.size===file.size&&p.file.lastModified===file.lastModified))continue;
    if(isPdf){
      let pdf;
      try{
        message(`Opening reference PDF: ${file.name}…`);pdf=await openLocalPdf(file,pdfjs);
        const count=Math.min(pdf.numPages,MAX_PAIRS-state.proofs.length);
        if(count<=0){await releasePdf(pdf);errors.push('This batch already has 30 page pairs.');continue;}
        for(let referencePage=1;referencePage<=count;referencePage++)state.proofs.push({id:crypto.randomUUID(),kind:'pdf',file,pdf,referencePage,page:Math.min(state.proofs.length+1,state.pdf?.numPages||1)});
        if(count<pdf.numPages)errors.push(`${file.name}: added the first ${count} pages. This batch supports 30 pairs; use the reference-page selectors to choose other pages, or compare remaining pages in another batch.`);
      }catch{if(pdf)await releasePdf(pdf);errors.push(`${file.name}: could not open this reference PDF. Check for password protection, corruption, or browser memory limits.`);}
      continue;
    }
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      if(img.naturalWidth*img.naturalHeight>120000000)throw new Error('Too large');
      state.proofs.push({id:crypto.randomUUID(),kind:'jpeg',file,url,width:img.naturalWidth,height:img.naturalHeight,page:Math.min(state.proofs.length+1,state.pdf?.numPages||1)});
    }catch{URL.revokeObjectURL(url);errors.push(`${file.name}: could not decode this JPEG or its dimensions are too large.`);}
  }
  renderFiles();renderPairing();invalidate();message(errors.join(' '),errors.length>0);
  }finally{state.proofLoading--;update();renderFiles();$('jpg-input').value='';}
}
function pagePicker(total,current,label,onChange){
  const control=total<=200?document.createElement('select'):document.createElement('input');
  if(total<=200)for(let n=1;n<=total;n++)control.add(new Option(`Page ${n}`,n));
  else{control.type='number';control.min=1;control.max=total;control.step=1;}
  control.value=current;control.disabled=state.busy;control.setAttribute('aria-label',label);
  control.onchange=()=>{const page=Number(control.value);if(!Number.isInteger(page)||page<1||page>total){control.value=current;message(`Choose a page from 1 to ${total}.`,true);return;}onChange(page);};return control;
}
function renderPairing(){
  $('pairing').hidden=!state.pdf||!state.proofs.length;if($('pairing').hidden)return;
  $('pairing-summary').textContent=`${state.proofs.length} proof${state.proofs.length===1?'':'s'}`;
  const rows=$('pairing-rows');rows.replaceChildren();
  for(const [index,proof]of state.proofs.entries()){
    const row=text('div','','pairing-row');
    if(proof.kind==='pdf')row.append(text('span','PDF','pdf-proof-icon'));else{const img=new Image();img.src=proof.url;img.alt='';row.append(img);}
    row.append(text('span',proof.file.name,'proof-pair-name'));
    if(proof.kind==='pdf'){
      const label=text('label','','pair-page-label');label.append(text('small','Reference'),pagePicker(proof.pdf.numPages,proof.referencePage,`Reference page for ${proof.file.name}, pair ${index+1}`,page=>{proof.referencePage=page;invalidate();}));row.append(label);
    }
    row.append(text('span','→','pair-arrow'));
    const printLabel=text('label','','pair-page-label');printLabel.append(text('small','Print PDF'),pagePicker(state.pdf.numPages,proof.page,`Print PDF page for ${proof.file.name}, pair ${index+1}`,page=>{proof.page=page;invalidate();}));row.append(printLabel);
    const remove=text('button','×','remove-pair');remove.type='button';remove.disabled=state.busy;remove.setAttribute('aria-label',`Remove pairing ${index+1} for ${proof.file.name}`);remove.onclick=()=>removeProofs([proof]);row.append(remove);rows.append(row);
  }
  const control=text('label','','sensitivity');control.append(text('span','Comparison sensitivity'));
  const select=document.createElement('select');select.id='sensitivity';
  for(const [label,value] of [['Detailed','detailed'],['Balanced','balanced'],['Relaxed','relaxed']])select.add(new Option(label,value));
  select.value=state.preset;select.disabled=state.busy;select.onchange=()=>{state.preset=select.value;invalidate();};
  control.append(select,text('small','Balanced reduces small JPEG compression differences.'));rows.append(control);
}
function wireDrop(id,inputId,handler){
  const drop=$(id),input=$(inputId);input.addEventListener('change',()=>handler([...input.files]));
  drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!state.busy)input.click();}});
  for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();if(!state.busy)drop.classList.add('dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');handler([...e.dataTransfer.files]);});
}
wireDrop('pdf-drop','pdf-input',loadPdf);wireDrop('jpg-drop','jpg-input',loadProofs);
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
function canvas(width,height){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
async function renderProofSource(proof,longest){
  if(proof.kind==='pdf'){
    return renderPdfPage(proof.pdf,proof.referencePage,longest,canvas);
  }
  const scale=Math.min(1,longest/Math.max(proof.width,proof.height)),source=canvas(Math.max(1,Math.round(proof.width*scale)),Math.max(1,Math.round(proof.height*scale))),img=new Image();img.src=proof.url;await img.decode();source.getContext('2d').drawImage(img,0,0,source.width,source.height);return source;
}
function analyse(a,b,width,height,preset){return new Promise((resolve,reject)=>{
  const worker=new Worker('./comparison-worker.js',{type:'module'});
  worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);};
  worker.onerror=e=>{worker.terminate();reject(new Error(e.message||'Comparison worker failed.'));};
  worker.postMessage({a,b,width,height,preset},[a.buffer,b.buffer]);
});}
$('compare').onclick=async()=>{
  if(state.busy||!state.pdf||!state.proofs.length)return;
  state.busy=true;state.results=[];state.runPreset=state.preset;update();renderPairing();$('results').hidden=true;
  const results=[];
  try{
    for(let index=0;index<state.proofs.length;index++){
      const proof=state.proofs[index];message(`Comparing proof ${index+1} of ${state.proofs.length}: ${proofLabel(proof)}`);
      await new Promise(r=>requestAnimationFrame(r));
      try{
        const page=await state.pdf.getPage(proof.page),base=page.getViewport({scale:1});
        const referenceSource=await renderProofSource(proof,1600);
        const longest=Math.max(referenceSource.width,referenceSource.height);
        const viewport=page.getViewport({scale:longest/Math.max(base.width,base.height)});
        const width=Math.max(1,Math.round(viewport.width)),height=Math.max(1,Math.round(viewport.height));
        const print=canvas(width,height),reference=canvas(width,height);
        await page.render({canvasContext:print.getContext('2d'),viewport,background:'white'}).promise;
        const ctx=reference.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
        const scale=Math.min(width/referenceSource.width,height/referenceSource.height),rw=referenceSource.width*scale,rh=referenceSource.height*scale;
        ctx.drawImage(referenceSource,(width-rw)/2,(height-rh)/2,rw,rh);
        const ratioMismatch=Math.abs((referenceSource.width/referenceSource.height)/(base.width/base.height)-1)>.015;
        const result=await analyse(print.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data,ctx.getImageData(0,0,width,height).data,width,height,state.runPreset);
        const difference=canvas(width,height);difference.getContext('2d').putImageData(new ImageData(result.diff,width,height),0,0);
        delete result.diff;
        results.push({...result,proofId:proof.id,name:proofLabel(proof),referenceType:proof.kind,referencePage:proof.referencePage||null,page:proof.page,width,height,proofWidth:proof.width||referenceSource.width,proofHeight:proof.height||referenceSource.height,ratioMismatch,print,reference,difference});
        page.cleanup();
      }catch(error){results.push({name:proofLabel(proof),referenceType:proof.kind,referencePage:proof.referencePage||null,page:proof.page,error:`Unable to compare this pair: ${error.message}`});}
    }
    state.results=results;state.active=0;renderResults();message('');$('results').hidden=false;$('results').scrollIntoView({behavior:'smooth',block:'start'});
    if($('ai-enabled').checked){
      const available=await checkAiConfiguration();
      if(available){
        state.aiRunning=true;state.stopAi=false;$('stop-ai').disabled=false;update();
        const pairs=results.filter(r=>!r.error);
        for(let i=0;i<pairs.length;i++){
          if(state.stopAi)break;
          message(`AI artwork review ${i+1} of ${pairs.length}: ${pairs[i].name}`);
          await generateAiForResult(pairs[i]);
          // Stop a batch after service/configuration failures instead of repeating failing calls.
          if(pairs[i].aiError){message('An AI review could not be completed. Local results are available; retry the affected pair from its report.',true);break;}
        }
        if(state.stopAi)message('AI reviews stopped. Completed reports and all local comparisons are still available.');
        else if(pairs.every(r=>r.ai))message('AI artwork reports are ready. Review the findings and download the combined report.');
      }else{
        for(const result of results)result.aiError=state.aiConfigured===false?'AI reporting needs the server API key. Local comparison is complete. Add OPENAI_API_KEY in Netlify with Functions scope and redeploy, then generate a report here.':'AI reporting is unavailable right now. Local comparison is complete; try generating an AI report later.';
      }
    }
  }finally{state.busy=false;state.aiRunning=false;update();renderPairing();if(state.results.length)renderResults();}
};
function renderResults(){
  const valid=state.results.filter(r=>!r.error),status=overallStatus(state.results);
  overallBanner.className=`decision-banner overall-decision ${status}`;overallBanner.replaceChildren(text('strong',`Overall ${STATUS_LABELS[status]}`,'status-badge'),text('p',status==='pass'?'All proof pairs pass the artwork acceptance rules.':status==='fail'?'At least one proof has a failing artwork change. Check the failed pairs below.':'One or more proof pairs have not been assessed reliably. Complete the AI reviews to obtain a Pass/Fail result.'));
  const summary=$('result-summary');summary.replaceChildren();
  for(const [number,label]of[[valid.length,'Proofs compared'],[state.results.filter(r=>pairStatus(r)==='pass').length,'Passed'],[state.results.filter(r=>pairStatus(r)==='fail').length,'Failed'],[state.results.filter(r=>pairStatus(r)==='not_assessed').length,'Not assessed']]){
    const card=text('div','','summary-card');card.append(text('strong',number),text('span',label));summary.append(card);
  }
  const tabs=$('result-tabs');tabs.replaceChildren();
  state.results.forEach((r,i)=>{const b=text('button',`${STATUS_LABELS[pairStatus(r)]} · Page ${r.page} · ${r.name}`);b.title=r.name;b.dataset.status=pairStatus(r);b.classList.toggle('selected',i===state.active);b.onclick=()=>{state.active=i;renderResults();};tabs.append(b);});
  renderViewer();renderCurrentAi();renderFindings();
}
function figure(caption,source){const f=document.createElement('figure');f.append(text('figcaption',caption));const c=canvas(source.width,source.height);c.getContext('2d').drawImage(source,0,0);f.append(c);return f;}
function renderViewer(){
  const result=state.results[state.active],container=$('canvas-container');container.replaceChildren();
  for(const b of document.querySelectorAll('[data-mode]'))b.classList.toggle('selected',b.dataset.mode===state.mode);
  $('overlay-control').hidden=state.mode!=='overlay'||!!result.error;
  if(result.error){container.append(text('p','Preview unavailable for this pair.'));$('viewer-dimensions').textContent='';return;}
  $('viewer-dimensions').textContent=`${result.width} × ${result.height} px`;
  if(state.mode==='side'){
    container.append(figure(result.referenceType==='pdf'?`Reference PDF · page ${result.referencePage}`:'JPEG reference',result.reference),figure(`Print PDF · page ${result.page}`,result.print));$('view-caption').textContent=result.referenceType==='pdf'?`Reference PDF page ${result.referencePage} / print PDF page ${result.page}`:'JPEG reference / Print PDF';
  }else if(state.mode==='overlay'){
    const c=canvas(result.width,result.height),ctx=c.getContext('2d');ctx.drawImage(result.print,0,0);ctx.globalAlpha=Number($('opacity').value)/100;ctx.drawImage(result.reference,-result.shiftX,-result.shiftY);container.append(figure('PDF + reference overlay',c));$('view-caption').textContent='Blend the reference over the PDF to inspect alignment.';
  }else{
    const c=canvas(result.width,result.height),ctx=c.getContext('2d');ctx.drawImage(result.difference,0,0);ctx.strokeStyle='#c43b65';ctx.lineWidth=Math.max(1,result.width/600);
    for(const region of result.regions)ctx.strokeRect(region.x,region.y,region.width,region.height);
    container.append(figure('Highlighted differences',c));$('view-caption').textContent='Pink pixels show differences; boxes group nearby changes.';
  }
}
function renderFindings(){
  const r=state.results[state.active],findings=$('findings');findings.replaceChildren();
  findings.append(text('h3','Local pixel check','pixel-heading'));
  function add(title,detail,warning){const el=text('div','',`finding ${warning?'warning':'pass'}`);el.append(text('strong',title),text('small',detail));findings.append(el);}
  if(r.error){add('Comparison incomplete',r.error,true);return;}
  const changed=r.regions.length>0||r.percent>.1;
  add(changed?'Pixel differences highlighted':'No significant pixel differences detected',`${r.percent.toFixed(2)}% of compared pixels exceed the ${state.runPreset} threshold. ${r.regions.length} grouped region${r.regions.length===1?'':'s'} to inspect. Pixel differences are for inspection only and do not determine Pass/Fail.`,changed);
  if(r.ratioMismatch)add('Page proportions differ','The reference was fitted without stretching. Check for crop marks, bleed, a different crop, or an incorrect page pairing before interpreting the differences.',true);
  if(r.referenceType!=='pdf'&&Math.max(r.proofWidth,r.proofHeight)<800)add('Low-resolution reference',`The reference is ${r.proofWidth} × ${r.proofHeight} pixels. Small text changes and fine details may be missed.`,true);
  if(r.shiftX||r.shiftY)add('Small alignment offset corrected',`The comparison aligns the reference by ${-r.shiftX}px horizontally and ${-r.shiftY}px vertically. Edge strips outside the overlap are excluded.`,false);
  for(const [i,region] of r.regions.slice(0,12).entries())add(`Region ${i+1} · ${Math.round(region.x/r.width*100)}% from left, ${Math.round(region.y/r.height*100)}% from top`,`${region.width} × ${region.height} pixels · ${region.pixels.toLocaleString()} flagged pixels in this region`,true);
  if(r.regions.length>12)add(`${r.regions.length-12} more regions`,'All regions are highlighted in the Differences view and included in the report.',true);
}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{state.mode=b.dataset.mode;if(state.results.length)renderViewer();};
$('opacity').oninput=()=>{$('opacity-value').textContent=`${$('opacity').value}%`;renderViewer();};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download-report').onclick=()=>{
  const lines=['PRINT COMPARE — ARTWORK & PIXEL COMPARISON REPORT',`Created: ${new Date().toLocaleString()}`,`Print PDF: ${state.pdfFile.name}`,`Pixel sensitivity: ${state.runPreset}`,'','AI observations can be mistaken. Verify reported changes against the artwork. This report is not a prepress or colour-accuracy certification.',''];
  lines.push(`OVERALL STATUS: ${STATUS_LABELS[overallStatus(state.results)]}`,ACCEPTANCE_RULES,'');
  for(const r of state.results){lines.push(`REFERENCE: ${r.name}`,`PDF page: ${r.page}`);if(r.error){lines.push('STATUS: NOT ASSESSED',r.error,'');continue;}
    lines.push(...reportLines(r),'LOCAL PIXEL CHECK',`Comparison resolution: ${r.width} x ${r.height}`,`Reference resolution: ${r.proofWidth} x ${r.proofHeight}`,`Flagged pixels: ${r.changed} of ${r.compared} (${r.percent.toFixed(4)}%)`,`Regions: ${r.regions.length}`,`Aspect ratio mismatch: ${r.ratioMismatch?'YES — review pairing/crop':'No'}`,`Alignment translation: x=${-r.shiftX}px, y=${-r.shiftY}px`, 'Region coordinates below use the comparison resolution, with origin at top left.');
    r.regions.forEach((region,i)=>lines.push(`  ${i+1}. x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}, flagged pixels=${region.pixels}`));lines.push('');
  }
  lines.push('LIMITATIONS','JPEG compression, RGB conversion, anti-aliasing, alignment, bleed, and crop marks may produce differences. Changes below reference resolution may be missed. Spot colours, overprint, separations, font embedding, and print colour accuracy are not checked.');
  download(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),`print-compare-report-${new Date().toISOString().slice(0,10)}.txt`);
};
$('new-comparison').onclick=()=>{
  if(state.busy||state.pdfLoading||state.proofLoading)return;
  state.pdfRevision++;releasePdf(state.pdf);state.pdf=null;state.pdfFile=null;const references=state.proofs;state.proofs=[];for(const pdf of new Set(references.filter(p=>p.kind==='pdf').map(p=>p.pdf)))void releasePdf(pdf);for(const proof of references)if(proof.url)URL.revokeObjectURL(proof.url);state.results=[];state.active=0;state.mode='side';state.preset='balanced';$('opacity').value=50;$('opacity-value').textContent='50%';
  renderFiles();renderPairing();invalidate();message('');window.scrollTo({top:0,behavior:'smooth'});
};
$('how-nav').onclick=()=>$('how-dialog').showModal();for(const button of document.querySelectorAll('.dialog-close'))button.onclick=()=>$('how-dialog').close();
$('how-dialog').addEventListener('click',e=>{if(e.target===$('how-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('workspace-nav').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});update();checkAiConfiguration();
