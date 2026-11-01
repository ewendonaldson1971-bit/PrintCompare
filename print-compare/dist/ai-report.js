import { pairStatus, STATUS_LABELS, ACCEPTANCE_RULES } from './assessment.js';
export const VERDICTS = {
  differences_found: 'Artwork differences found',
  no_significant_difference: 'No significant artwork differences found',
  inconclusive: 'A closer check is needed',
};
export function reportLines(result) {
  const lines=['AI ARTWORK REVIEW'];
  lines.push(`STATUS: ${STATUS_LABELS[pairStatus(result)]}`,ACCEPTANCE_RULES);
  if (!result.ai) return [...lines, result.aiError || 'AI review has not been generated for this pair.', ''];
  const {report,model,generatedAt}=result.ai;
  lines.push(`Decision: ${report.decision_reason}`,VERDICTS[report.verdict],report.summary,`Model: ${model}`,`Generated: ${generatedAt}`,'');
  lines.push(`Reference source: ${result.referenceType==='pdf'?`PDF page ${result.referencePage}`:'JPEG'}`);
  lines.push(`Lettering detail pairs reviewed: ${result.ai.detailCount??0}`);
  for (const d of report.differences) lines.push(`${d.area} — ${d.severity} priority; ${d.confidence} confidence`,`  Reference input: ${d.reference}`,`  Print PDF: ${d.print}`,'');
  for(const [title,items] of [['PRESENT IN BOTH',report.shared_elements],['CHECK BEFORE PRINTING',report.checks],['REVIEW LIMITATIONS',report.limitations]]){
    if(items.length) lines.push(title,...items.map(item=>`- ${item}`),'');
  }
  return lines;
}

const el=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;};
export function renderAiReport(container,result,{busy=false,onGenerate}={}) {
  container.replaceChildren();
  const heading=el('div','','ai-report-heading'),title=el('div','');
  title.append(el('div','CONTENT, COLOUR & COMPOSITION','eyebrow'),el('h3','AI artwork report'));
  const button=el('button',result.ai?'Regenerate AI report':'Generate AI report','secondary-button');button.type='button';button.disabled=busy||!!result.error;button.onclick=onGenerate;
  heading.append(title,button);container.append(heading);
  container.append(el('p',`Page ${result.page} · ${result.name}`,'ai-pair-label'));
  const status=pairStatus(result),decision=el('div','',`decision-banner ${status}`);
  decision.append(el('strong',STATUS_LABELS[status],'status-badge'),el('p',result.ai?.report.decision_reason || (result.aiPending?'Artwork assessment in progress.':'Generate an AI artwork report to assess this pair.')));container.append(decision);
  if(result.aiPending){const p=el('p','Reviewing logos, lettering, colours, imagery and layout…','ai-report-status');p.setAttribute('role','status');container.append(p);return;}
  if(!result.ai){container.append(el('p',result.error?'This pair could not be rendered. Fix the page pairing or files before requesting an AI report.':result.aiError||'Generate a plain-language comparison of the artwork. This sends image previews of the reference and print PDF page through Netlify to OpenAI.','ai-report-status'));return;}
  const {report}=result.ai;
  container.append(el('strong',VERDICTS[report.verdict],`ai-verdict ${report.verdict}`),el('p',report.summary,'ai-summary'));
  container.append(el('p',ACCEPTANCE_RULES,'acceptance-rules'));
  if(result.detailPreviews?.length){
    const details=document.createElement('details');details.className='lettering-details';details.append(el('summary',`Lettering close-ups (${result.detailPreviews.length} regions)`));
    for(const [i,d]of result.detailPreviews.entries()){
      const group=el('div','','lettering-pair');group.append(el('p',`Detail ${i+1} · ${Math.round(d.region.x*100)}% from left, ${Math.round(d.region.y*100)}% from top`));
      const pair=el('div','','lettering-images');
      for(const [label,src]of [['Reference',d.referenceImage],['Print PDF',d.printImage]]){const figure=document.createElement('figure'),img=document.createElement('img');img.src=src;img.alt=`${label} lettering close-up ${i+1}`;figure.append(el('figcaption',label),img);pair.append(figure);}group.append(pair);details.append(group);
    }
    container.append(details);
  }
  if(report.differences.length){
    const wrap=el('div','','ai-table-wrap'),table=el('table','','ai-table'),thead=document.createElement('thead'),head=document.createElement('tr');
    for(const label of ['Area',result.referenceType==='pdf'?`Reference PDF · page ${result.referencePage}`:'JPEG reference','Print PDF']){const th=el('th',label);th.scope='col';head.append(th);}thead.append(head);table.append(thead);
    const tbody=document.createElement('tbody');
    for(const d of report.differences){const row=document.createElement('tr'),area=el('th',d.area);area.scope='row';area.append(el('small',`${d.severity} priority · ${d.confidence} confidence`));row.append(area,el('td',d.reference),el('td',d.print));tbody.append(row);}
    table.append(tbody);wrap.append(table);container.append(wrap);
  }
  for(const [label,items] of [['Present in both',report.shared_elements],['Check before printing',report.checks],['What this review can’t verify',report.limitations]]){
    if(!items.length)continue;const group=el('div','','ai-report-group');group.append(el('h4',label));const ul=document.createElement('ul');for(const item of items)ul.append(el('li',item));group.append(ul);container.append(group);
  }
  container.append(el('p',`AI-generated visual screening · ${result.ai.model} · ${new Date(result.ai.generatedAt).toLocaleString()}. Verify reported changes against the artwork; AI can make mistakes.`,'ai-report-meta'));
}
