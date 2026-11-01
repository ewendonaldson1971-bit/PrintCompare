import {reportStatus} from './assessment.js';
import {sumReviewCosts} from './review-cost.js';

export function planDetailBatches(regions,maxPerBatch=8){
  if(!Number.isInteger(maxPerBatch)||maxPerBatch<1)throw new Error('Invalid review batch size.');
  if(!regions.length)return [[]];
  const batches=[];for(let i=0;i<regions.length;i+=maxPerBatch)batches.push(regions.slice(i,i+maxPerBatch));return batches;
}

export function mergeReviewBatches(responses,expectedBatches,expectedRegions){
  if(!responses.length)throw new Error('No AI reviews were completed.');
  const indexes=new Set(responses.map(r=>r.detailBatch?.index));
  const reviewedRegions=responses.reduce((sum,r)=>sum+(r.detailCount||0),0);
  const complete=responses.length===expectedBatches&&indexes.size===expectedBatches&&reviewedRegions===expectedRegions
    &&responses.every(r=>r.detailBatch?.total===expectedBatches&&r.detailBatch?.expectedRegions===expectedRegions&&r.detailBatch.index>=1&&r.detailBatch.index<=expectedBatches);
  const definitions={logos:['intact','missing_or_damaged'],lettering:['intact','filled_or_damaged'],colour:['acceptable','significant_change'],size:['acceptable','significant_change'],content:['intact','significant_change']};
  const assessment={};
  for(const [key,[good,bad]]of Object.entries(definitions)){
    const values=responses.map(r=>r.report.assessment?.[key]);assessment[key]=values.includes(bad)?bad:values.every(v=>v===good)?good:'uncertain';
  }
  if(!complete&&assessment.lettering!=='filled_or_damaged')assessment.lettering='uncertain';
  if(assessment.lettering==='filled_or_damaged')assessment.content='significant_change';
  if(assessment.lettering==='uncertain'&&assessment.content==='intact')assessment.content='uncertain';
  const confirmedFailure=Object.entries(definitions).some(([key,[,bad]])=>assessment[key]===bad);
  const verdict=confirmedFailure||responses.some(r=>r.report.verdict==='differences_found')?'differences_found':responses.some(r=>r.report.verdict==='inconclusive')?'inconclusive':'no_significant_difference';
  const distinct=items=>[...new Set(items.filter(Boolean))];
  const differences=[...new Map(responses.flatMap(r=>r.report.differences).map(d=>[JSON.stringify(d),d])).values()].sort((a,b)=>({high:0,medium:1,low:2}[a.severity]-{high:0,medium:1,low:2}[b.severity]));
  const report={assessment,verdict,summary:distinct(responses.map(r=>r.report.summary)).join(' '),decision_reason:'',differences:differences.slice(0,12),shared_elements:distinct(responses.flatMap(r=>r.report.shared_elements)).slice(0,12),checks:distinct(responses.flatMap(r=>r.report.checks)).slice(0,12),limitations:distinct(responses.flatMap(r=>r.report.limitations)).slice(0,12)};
  const status=reportStatus(report),decisive=responses.find(r=>reportStatus(r.report)===status)||responses[0];
  report.summary=decisive.report.summary;
  report.decision_reason=complete?`${reviewedRegions} detail regions reviewed across ${expectedBatches} batch${expectedBatches===1?'':'es'}. ${decisive.report.decision_reason}`:`Review incomplete: ${responses.length} of ${expectedBatches} batches and ${reviewedRegions} of ${expectedRegions} detail regions completed. ${confirmedFailure?decisive.report.decision_reason:'Complete the remaining reviews before passing this pair.'}`;
  report.status=status;
  return {report,cost:sumReviewCosts(responses.map(r=>r.cost)),model:distinct(responses.map(r=>r.model)).join(', '),generatedAt:responses.at(-1).generatedAt,detailCount:reviewedRegions,coverage:{complete,reviewedRegions,expectedRegions,reviewedBatches:responses.length,expectedBatches},batchReports:responses};
}
