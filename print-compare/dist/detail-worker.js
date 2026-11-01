import {findLetteringRegions} from './detail-regions.js';
self.onmessage=({data})=>{
  try{self.postMessage({regions:findLetteringRegions(data.pixels,data.width,data.height)});}catch(error){self.postMessage({error:error.message});}
};
