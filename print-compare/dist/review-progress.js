export class ReviewProgress {
  constructor(localTotal, aiTotal, now = Date.now()) {
    Object.assign(this, {localTotal, aiTotal, localDone:0, aiDone:0, batchDone:0, batchTotal:0, prepared:false, samples:0, aiStarted:null, started:now, ended:false, complete:false});
  }
  beginAi(total, now = Date.now()) { this.aiTotal=total; this.aiStarted=now; }
  planBatches(total) { this.batchTotal=total; this.batchDone=0; this.prepared=true; }
  finishLocal(now = Date.now()) { this.localDone++; this.localObservedAt=now; }
  finishBatch(now = Date.now()) { this.batchDone++; this.samples++; this.observedAt=now; }
  finishPair(now = Date.now()) { this.aiDone++; this.batchDone=0; this.batchTotal=0; this.prepared=false; this.observedAt=now; }
  finish(complete) { this.ended=true; this.complete=complete; }
  snapshot(now = Date.now()) {
    const local=this.localTotal?this.localDone/this.localTotal:1;
    const current=this.prepared?0.15+0.85*this.batchDone/Math.max(1,this.batchTotal):0;
    const ai=this.aiTotal?Math.min(1,(this.aiDone+current)/this.aiTotal):1;
    const fraction=this.complete?1:this.aiTotal?(this.localTotal?0.2*local+0.8*ai:ai):local;
    // Use observed AI speed, not an invented duration. Unknown future detail counts can change the estimate.
    let remaining=null;
    if(!this.ended&&this.samples&&this.aiStarted!==null&&ai>0&&ai<1)remaining=Math.max(0,((this.observedAt-this.aiStarted)*(1-ai)/ai-(now-this.observedAt))/1000);
    else if(!this.ended&&!this.aiTotal&&local>0&&local<1)remaining=Math.max(0,((this.localObservedAt-this.started)*(1-local)/local-(now-this.localObservedAt))/1000);
    return {fraction:Math.max(0,Math.min(this.complete?1:0.99,fraction)),remaining};
  }
}
export function durationLabel(seconds) {
  if(seconds<60)return 'less than a minute';
  const minutes=Math.ceil(seconds/60);
  return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)} hr ${minutes%60} min`;
}
