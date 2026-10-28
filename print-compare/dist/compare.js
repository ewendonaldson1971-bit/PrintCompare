// Pixel comparison is a screening aid, not a colour or prepress certification.
export const PRESETS = { detailed: { threshold: 16, minPixels: 4 }, balanced: { threshold: 28, minPixels: 10 }, relaxed: { threshold: 44, minPixels: 20 } };

function soften(data, width, height) {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r=0,g=0,b=0,n=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const xx=x+dx, yy=y+dy;
      if(xx<0||yy<0||xx>=width||yy>=height) continue;
      const i=(yy*width+xx)*4; r+=data[i];g+=data[i+1];b+=data[i+2];n++;
    }
    const i=(y*width+x)*3;out[i]=r/n;out[i+1]=g/n;out[i+2]=b/n;
  }
  return out;
}

export function compareImages(a, b, width, height, preset='balanced') {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||a.length!==width*height*4||b.length!==a.length) throw new Error('Images must have matching, valid dimensions.');
  const {threshold,minPixels}=PRESETS[preset] || PRESETS.balanced;
  const left=soften(a,width,height),right=soften(b,width,height);
  // Correct small rasterisation offsets only. Do not register away layout changes.
  const maxShift=Math.min(5,Math.floor(Math.min(width,height)/80));
  const stride=Math.max(2,Math.floor(Math.sqrt(width*height/12000)));
  const margin=maxShift+2;
  let shiftX=0,shiftY=0,best=Infinity;
  for(let dy=-maxShift;dy<=maxShift;dy++)for(let dx=-maxShift;dx<=maxShift;dx++) {
    let score=0,n=0;
    for(let y=margin;y<height-margin;y+=stride)for(let x=margin;x<width-margin;x+=stride){
      const i=(y*width+x)*3,j=((y+dy)*width+x+dx)*3;
      score+=Math.min(100,(Math.abs(left[i]-right[j])+Math.abs(left[i+1]-right[j+1])+Math.abs(left[i+2]-right[j+2]))/3);n++;
    }
    score=n ? score/n : Infinity;
    // Prefer no translation for uniform images and tied scores.
    score+=(Math.abs(dx)+Math.abs(dy))*.02;
    if(score<best){best=score;shiftX=dx;shiftY=dy;}
  }
  const mask=new Uint8Array(width*height), diff=new Uint8ClampedArray(width*height*4);
  const tile=16, cols=Math.ceil(width/tile), rows=Math.ceil(height/tile), counts=new Uint32Array(cols*rows);
  let changed=0,compared=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const px=y*width+x,i=px*3,j=((y+shiftY)*width+x+shiftX)*3;
    let delta=0;
    if(x+shiftX>=0&&x+shiftX<width&&y+shiftY>=0&&y+shiftY<height){
      delta=Math.max(Math.abs(left[i]-right[j]),Math.abs(left[i+1]-right[j+1]),Math.abs(left[i+2]-right[j+2]));compared++;
    }
    if(delta>threshold){mask[px]=1;counts[Math.floor(y/tile)*cols+Math.floor(x/tile)]++;changed++;}
    const k=px*4;
    if(mask[px]){diff[k]=220;diff[k+1]=71;diff[k+2]=107;}else{const gray=(a[k]*.299+a[k+1]*.587+a[k+2]*.114);diff[k]=diff[k+1]=diff[k+2]=Math.round(gray*.3+178);}
    diff[k+3]=255;
  }
  const visited=new Uint8Array(counts.length), regions=[];
  for(let t=0;t<counts.length;t++){
    if(visited[t]||counts[t]<minPixels)continue;
    const queue=[t];visited[t]=1;let minX=cols,minY=rows,maxX=0,maxY=0,pixels=0;
    for(let q=0;q<queue.length;q++){
      const p=queue[q],tx=p%cols,ty=Math.floor(p/cols);pixels+=counts[p];minX=Math.min(minX,tx);minY=Math.min(minY,ty);maxX=Math.max(maxX,tx);maxY=Math.max(maxY,ty);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const nx=tx+ox,ny=ty+oy,ni=ny*cols+nx;
        if(nx<0||ny<0||nx>=cols||ny>=rows||visited[ni]||counts[ni]<minPixels)continue;
        visited[ni]=1;queue.push(ni);
      }
    }
    regions.push({x:minX*tile,y:minY*tile,width:Math.min(width,(maxX+1)*tile)-minX*tile,height:Math.min(height,(maxY+1)*tile)-minY*tile,pixels});
  }
  regions.sort((a,b)=>b.pixels-a.pixels);
  return {changed,compared,percent:compared ? changed/compared*100:0,regions,diff,shiftX,shiftY,threshold};
}
