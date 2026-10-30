import * as pdfjs from './vendor/pdf.mjs';
import { renderAiReport, reportLines } from './ai-report.js';
import { pairStatus, overallStatus, STATUS_LABELS, ACCEPTANCE_RULES } from './assessment.js';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const state={pdf:null,pdfFile:null,proofs:[],results:[],active:0,mode:'side',busy:false,pdfLoading:false,proofLoading:0,pdfRevision:0,preset:'balanced',runPreset:'balanced',aiConfigured:null,aiRunning:false,stopAi:false,aiController:null};
const MAX_PDF=100*1024*1024,MAX_JPG=25*1024*1024;
const text=(tag,content,className)=>{const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;return el;};
const message=(content,error=false)=>{const el=$('message');el.textContent=content;el.hidden=!content;el.className=error?'error':'';};
const size=bytes=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;
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
  try{const response=await fetch('/.netlify/functions/artwork-review',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();if(typeof data.configured!=='boolean')throw new Error();state.aiConfigured=data.configured;status.textContent=data.configured?'AI reporting available':'AI setup needed: add the server API key';status.dataset.ready=String(data.configured);}
  catch{state.aiConfigured=null;status.textContent='AI service is unavailable. Local checks still work.';status.dataset.ready='false';}
  return state.aiConfigured===true;
}
$('ai-refresh').onclick=checkAiConfiguration;
$('stop-ai').onclick=()=>{state.stopAi=true;state.aiController?.abort();$('stop-ai').disabled=true;};
async function prepareAiImages(result){
  const proof=state.proofs.find(p=>p.id===result.proofId);
  if(!proof)throw new Error('The reference is no longer available. Compare the files again.');
  const page=await state.pdf.getPage(result.page),base=page.getViewport({scale:1});
  try{
    // Render the PDF separately at higher resolution; do not upsample the low-resolution proof.
    const viewport=page.getViewport({scale:2000/Math.max(base.width,base.height)});
    const print=canvas(Math.max(1,Math.round(viewport.width)),Math.max(1,Math.round(viewport.height)));
    await page.render({canvasContext:print.getContext('2d'),viewport,background:'white'}).promise;
    const scale=Math.min(1,2000/Math.max(proof.width,proof.height));
    const reference=canvas(Math.max(1,Math.round(proof.width*scale)),Math.max(1,Math.round(proof.height*scale)));
    const img=new Image();img.src=proof.url;await img.decode();reference.getContext('2d').drawImage(img,0,0,reference.width,reference.height);
    for(const quality of [.92,.82,.68,.5]){
      const referenceImage=reference.toDataURL('image/jpeg',quality),printImage=print.toDataURL('image/jpeg',quality);
      if(referenceImage.length+printImage.length<4_300_000)return {referenceImage,printImage};
    }
    throw new Error('This artwork creates an oversized AI preview. Try a smaller reference.');
  }finally{page.cleanup();}
}
async function generateAiForResult(result){
  result.aiPending=true;result.aiError=null;result.ai=null;renderResults();
  const controller=new AbortController();state.aiController=controller;
  try{
    const images=await prepareAiImages(result);
    if(state.stopAi)throw new DOMException('Review stopped.','AbortError');
    const response=await fetch('/.netlify/functions/artwork-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...images,referenceName:result.name,pdfName:state.pdfFile.name,page:result.page,referenceDimensions:`${result.proofWidth} × ${result.proofHeight} pixels`}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(65000)])});
    let payload;try{payload=await response.json();}catch{throw new Error(response.status===429?'AI request limit reached. Please try again later.':'The AI service returned an unreadable response. Please try again.');}
    if(!response.ok)throw new Error(payload.error||'AI review could not be completed. Please retry.');
    if(!payload.report)throw new Error('The AI report was incomplete. Please retry.');
    result.ai=payload;
  }catch(error){result.aiError=error.name==='AbortError'?'AI review was stopped. No completed AI review was recorded.':error.name==='TimeoutError'?'AI review took too long. Please try this pair again.':error.message;}
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
  for(const proof of state.proofs)$('jpg-list').append(fileRow(proof.file.name,size(proof.file.size),()=>{URL.revokeObjectURL(proof.url);state.proofs=state.proofs.filter(p=>p.id!==proof.id);renderFiles();renderPairing();invalidate();}));
  $('pdf-drop-title').textContent=state.pdf?'Drop a PDF to replace it':'Drop your print PDF here';
  $('jpg-drop-title').textContent=state.proofs.length?'Drop more JPEG proofs here':'Drop your JPEG proofs here';
}
async function loadPdf(files){
  if(state.busy||!files.length)return;
  if(files.length!==1){message('Please add one PDF print file.',true);return;}
  const file=files[0];
  if(!/\.pdf$/i.test(file.name)||file.size>MAX_PDF){message('Choose a PDF smaller than 100 MB.',true);return;}
  const revision=++state.pdfRevision;state.pdfLoading=true;update();message('Opening your print PDF…');
  let task;
  try{
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'./vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'./vendor/standard_fonts/',wasmUrl:'./vendor/wasm/',isEvalSupported:false});
    task.onPassword=()=>{task.destroy();};
    const pdf=await task.promise;
    if(revision!==state.pdfRevision){await releasePdf(pdf);return;}
    releasePdf(state.pdf);state.pdf=pdf;state.pdfFile=file;
    for(let i=0;i<state.proofs.length;i++)state.proofs[i].page=Math.min(i+1,pdf.numPages);
    renderFiles();renderPairing();invalidate();message('');
  }catch(error){if(revision===state.pdfRevision)message('Could not open this PDF. Check that it is valid and not password protected.',true);}
  finally{if(revision===state.pdfRevision){state.pdfLoading=false;update();}$('pdf-input').value='';}
}
async function loadProofs(files){
  if(state.busy||!files.length)return;
  state.proofLoading++;update();const errors=[];
  try{for(const file of files){
    if(!/\.(jpe?g)$/i.test(file.name)||file.size>MAX_JPG){errors.push(`${file.name}: choose a JPEG smaller than 25 MB.`);continue;}
    if(state.proofs.length>=30){errors.push('Up to 30 proofs can be compared at once.');break;}
    if(state.proofs.some(p=>p.file.name===file.name&&p.file.size===file.size&&p.file.lastModified===file.lastModified))continue;
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      if(img.naturalWidth*img.naturalHeight>120000000)throw new Error('Too large');
      state.proofs.push({id:crypto.randomUUID(),file,url,width:img.naturalWidth,height:img.naturalHeight,page:Math.min(state.proofs.length+1,state.pdf?.numPages||1)});
    }catch{URL.revokeObjectURL(url);errors.push(`${file.name}: could not decode this JPEG or its dimensions are too large.`);}
  }
  renderFiles();renderPairing();invalidate();message(errors.join(' '),errors.length>0);
  }finally{state.proofLoading--;update();$('jpg-input').value='';}
}
function renderPairing(){
  $('pairing').hidden=!state.pdf||!state.proofs.length;if($('pairing').hidden)return;
  $('pairing-summary').textContent=`${state.proofs.length} proof${state.proofs.length===1?'':'s'}`;
  const rows=$('pairing-rows');rows.replaceChildren();
  for(const proof of state.proofs){
    const row=text('div','','pairing-row'),img=new Image();img.src=proof.url;img.alt='';
    const select=document.createElement('select');select.setAttribute('aria-label',`PDF page for ${proof.file.name}`);
    for(let n=1;n<=state.pdf.numPages;n++){const option=new Option(`Page ${n}`,n);select.add(option);}
    select.value=proof.page;select.disabled=state.busy;
    select.onchange=()=>{proof.page=Number(select.value);invalidate();};
    row.append(img,text('span',proof.file.name),text('span','→'),select);row.children[2].style.flex='0';rows.append(row);
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
      const proof=state.proofs[index];message(`Comparing proof ${index+1} of ${state.proofs.length}: ${proof.file.name}`);
      await new Promise(r=>requestAnimationFrame(r));
      try{
        const page=await state.pdf.getPage(proof.page),base=page.getViewport({scale:1});
        const longest=Math.min(1600,Math.max(proof.width,proof.height));
        const viewport=page.getViewport({scale:longest/Math.max(base.width,base.height)});
        const width=Math.max(1,Math.round(viewport.width)),height=Math.max(1,Math.round(viewport.height));
        const print=canvas(width,height),reference=canvas(width,height);
        await page.render({canvasContext:print.getContext('2d'),viewport,background:'white'}).promise;
        const img=new Image();img.src=proof.url;await img.decode();
        const ctx=reference.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
        const scale=Math.min(width/proof.width,height/proof.height),rw=proof.width*scale,rh=proof.height*scale;
        ctx.drawImage(img,(width-rw)/2,(height-rh)/2,rw,rh);
        const ratioMismatch=Math.abs((proof.width/proof.height)/(base.width/base.height)-1)>.015;
        const result=await analyse(print.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data,ctx.getImageData(0,0,width,height).data,width,height,state.runPreset);
        const difference=canvas(width,height);difference.getContext('2d').putImageData(new ImageData(result.diff,width,height),0,0);
        delete result.diff;
        results.push({...result,proofId:proof.id,name:proof.file.name,page:proof.page,width,height,proofWidth:proof.width,proofHeight:proof.height,ratioMismatch,print,reference,difference});
        page.cleanup();
      }catch(error){results.push({name:proof.file.name,page:proof.page,error:`Unable to compare this pair: ${error.message}`});}
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
    container.append(figure('Print PDF',result.print),figure('JPEG reference',result.reference));$('view-caption').textContent='Print PDF / JPEG reference';
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
  if(r.ratioMismatch)add('Page proportions differ','The JPEG was fitted without stretching. Check for crop marks, bleed, a different crop, or an incorrect page pairing before interpreting the differences.',true);
  if(Math.max(r.proofWidth,r.proofHeight)<800)add('Low-resolution reference',`The reference is ${r.proofWidth} × ${r.proofHeight} pixels. Small text changes and fine details may be missed.`,true);
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
  state.pdfRevision++;releasePdf(state.pdf);state.pdf=null;state.pdfFile=null;for(const proof of state.proofs)URL.revokeObjectURL(proof.url);state.proofs=[];state.results=[];state.active=0;state.mode='side';state.preset='balanced';$('opacity').value=50;$('opacity-value').textContent='50%';
  renderFiles();renderPairing();invalidate();message('');window.scrollTo({top:0,behavior:'smooth'});
};
$('how-nav').onclick=()=>$('how-dialog').showModal();for(const button of document.querySelectorAll('.dialog-close'))button.onclick=()=>$('how-dialog').close();
$('how-dialog').addEventListener('click',e=>{if(e.target===$('how-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('workspace-nav').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});update();checkAiConfiguration();
