import { compareImages } from './compare.js';
self.onmessage = ({data}) => {
  try {const result=compareImages(data.a,data.b,data.width,data.height,data.preset);self.postMessage({result},[result.diff.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
