// Locate high-contrast glyph-like runs, including outlined text with no PDF text layer.
// This selects close-ups; it does not decide whether the lettering is correct.
export const MAX_DETAIL_REGIONS=8;
function union(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y,score:(a.score||0)+(b.score||0)};}
function overlap(a,b){return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));}
export function findLetteringRegions(data,width,height){
  if(data.length!==width*height*4)throw new Error('Invalid detail-analysis image.');
  const mask=new Uint8Array(width*height),queue=new Int32Array(width*height),parts=[];
  for(let p=0;p<mask.length;p++){
    const i=p*4,min=Math.min(data[i],data[i+1],data[i+2]),max=Math.max(data[i],data[i+1],data[i+2]);
    mask[p]=min>=215&&max-min<=30?1:max<=55?2:0;
  }
  for(let p=0;p<mask.length;p++){
    const tone=mask[p];if(!tone)continue;
    let head=0,tail=1,core=0,minX=p%width,maxX=minX,minY=Math.floor(p/width),maxY=minY;queue[0]=p;mask[p]=0;
    const push=n=>{if(mask[n]===tone){mask[n]=0;queue[tail++]=n;}};
    while(head<tail){
      const n=queue[head++],x=n%width,y=Math.floor(n/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      const i=n*4;if(tone===1?Math.min(data[i],data[i+1],data[i+2])>=249:Math.max(data[i],data[i+1],data[i+2])<=40)core++;
      if(x)push(n-1);if(x+1<width)push(n+1);if(y)push(n-width);if(y+1<height)push(n+width);
    }
    const w=maxX-minX+1,h=maxY-minY+1;
    if(tail>=3&&tail<=3000&&core/tail>=.2&&h>=3&&h<=80&&w>=1&&w<=100&&w/h<=4&&w/h>=.08&&tail/(w*h)>=.08)parts.push({x:minX,y:minY,w,h,bottom:maxY,tone});
  }
  parts.sort((a,b)=>a.bottom-b.bottom);
  const rows=[];
  for(const part of parts){
    let row;
    for(let i=rows.length-1;i>=Math.max(0,rows.length-30);i--){const r=rows[i];if(r.tone===part.tone&&Math.abs(r.bottom-part.bottom)<=Math.max(2,Math.min(r.h,part.h)*.4)&&part.h/r.h>.45&&part.h/r.h<2.2){row=r;break;}}
    if(!row){rows.push({tone:part.tone,bottom:part.bottom,h:part.h,parts:[part]});continue;}
    row.parts.push(part);const n=row.parts.length;row.bottom+=(part.bottom-row.bottom)/n;row.h+=(part.h-row.h)/n;
  }
  const lines=[];
  for(const row of rows){
    row.parts.sort((a,b)=>a.x-b.x);let segment=[];
    const emit=()=>{
      if(segment.length<8)return;
      const medianHeight=segment.map(p=>p.h).sort((a,b)=>a-b)[Math.floor(segment.length/2)];
      const regular=segment.filter(p=>p.h>=medianHeight*.65&&p.h<=medianHeight*1.4);
      if(regular.length/segment.length<.75)return;
      segment=regular;
      const medianAspect=segment.map(p=>p.w/p.h).sort((a,b)=>a-b)[Math.floor(segment.length/2)];
      if(segment.length<8||medianAspect<.32||medianAspect>1.8)return;
      const x=Math.min(...segment.map(p=>p.x)),y=Math.min(...segment.map(p=>p.y)),right=Math.max(...segment.map(p=>p.x+p.w)),bottom=Math.max(...segment.map(p=>p.y+p.h));
      const glyphHeight=segment.map(p=>p.h).sort((a,b)=>a-b)[Math.floor(segment.length/2)];
      if(right-x<glyphHeight*6||y<glyphHeight||bottom>height-glyphHeight*.4)return;
      lines.push({x,y,width:right-x,height:bottom-y,glyphHeight,score:segment.length});
    };
    for(const part of row.parts){const last=segment.at(-1);if(last&&part.x-(last.x+last.w)>Math.max(row.h,part.h)*3.5){emit();segment=[];}segment.push(part);}emit();
  }
  // Group nearby lines in the same column, so paragraphs do not consume many crops.
  lines.sort((a,b)=>a.y-b.y);const blocks=[];
  for(const line of lines){
    let match;
    for(const block of blocks){
      const horizontal=Math.max(0,Math.min(block.x+block.width,line.x+line.width)-Math.max(block.x,line.x));
      const gap=line.y-(block.y+block.height);
      if(horizontal/Math.min(block.width,line.width)>.65&&gap>=-line.glyphHeight&&gap<=Math.max(block.glyphHeight,line.glyphHeight)*3){match=block;break;}
    }
    if(match){Object.assign(match,union(match,line),{glyphHeight:Math.max(match.glyphHeight,line.glyphHeight)});}else blocks.push({...line});
  }
  return blocks.map(b=>{
    const padX=b.glyphHeight*2,padY=b.glyphHeight*2.5;
    const x=Math.max(0,b.x-padX),y=Math.max(0,b.y-padY),right=Math.min(width,b.x+b.width+padX),bottom=Math.min(height,b.y+b.height+padY);
    return {x:x/width,y:y/height,width:(right-x)/width,height:(bottom-y)/height,score:b.score};
  });
}
export function combineDetailRegions(reference,print,maxRegions=Infinity){
  const regions=[];
  for(const region of [...reference,...print]){
    let combined={...region};
    for(let i=0;i<regions.length;){
      const r=regions[i],vertical=Math.max(0,Math.min(r.y+r.height,combined.y+combined.height)-Math.max(r.y,combined.y));
      const gap=Math.max(r.x,combined.x)-Math.min(r.x+r.width,combined.x+combined.width);
      if(overlap(r,combined)/Math.min(r.width*r.height,combined.width*combined.height)>.45||(vertical/Math.min(r.height,combined.height)>.5&&gap<.004)){
        combined=union(r,combined);regions.splice(i,1);i=0;
      }else i++;
    }
    regions.push(combined);
  }
  regions.sort((a,b)=>b.score-a.score);
  return {regions:regions.slice(0,maxRegions),detected:regions.length,complete:regions.length<=maxRegions};
}

export function encodeReviewImages(reference,print,details,complete,maxLength=4_300_000){
  for(const quality of [null,.96,.88,.76,.6]){
    const referenceImage=reference.toDataURL('image/jpeg',quality??.92),printImage=print.toDataURL('image/jpeg',quality??.92);
    const detailPairs=details.map(d=>({region:d.region,referenceImage:quality===null?d.reference.toDataURL('image/png'):d.reference.toDataURL('image/jpeg',quality),printImage:quality===null?d.print.toDataURL('image/png'):d.print.toDataURL('image/jpeg',quality)}));
    const payload={referenceImage,printImage,detailPairs,detailCoverageComplete:complete};
    if(JSON.stringify(payload).length<maxLength)return payload;
  }
  throw new Error('The lettering close-ups exceed the AI request size limit. This pair has not been assessed; please use a smaller page region.');
}
