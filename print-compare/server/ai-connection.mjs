function value(env,name){return typeof env[name]==='string'?env[name].trim():'';}
function endpoint(value){return value.replace(/\/+$/,'');}
function sameGateway(a,b){
  try{const left=new URL(a),right=new URL(b);return left.origin===right.origin&&left.pathname.replace(/\/+$/,'')===right.pathname.replace(/\/+$/,'');}catch{return false;}
}
export function resolveAiConnection(env){
  const providerKey=value(env,'OPENAI_API_KEY'),providerBase=value(env,'OPENAI_BASE_URL');
  const gatewayKey=value(env,'NETLIFY_AI_GATEWAY_KEY'),gatewayBase=value(env,'NETLIFY_AI_GATEWAY_URL')||value(env,'NETLIFY_AI_GATEWAY_BASE_URL');
  // Provider aliases can retain an earlier gateway token in a reused runtime.
  // Keep the current canonical gateway key and URL together; preserve custom provider keys.
  if(gatewayKey&&gatewayBase&&(!providerKey||providerKey===gatewayKey||(!providerKey.startsWith('sk-')&&sameGateway(providerBase,gatewayBase))))return {key:gatewayKey,baseURL:endpoint(gatewayBase),mode:'netlify_gateway'};
  if(!providerKey)return null;
  const customBase=providerKey.startsWith('sk-')&&sameGateway(providerBase,gatewayBase)?'':providerBase;
  return {key:providerKey,baseURL:endpoint(customBase||'https://api.openai.com/v1'),mode:providerKey.startsWith('sk-')&&!customBase?'openai':'configured_provider'};
}

export async function fetchAiResponse(env,body,fetchImpl=fetch){
  const signal=AbortSignal.timeout(50_000);
  let connection=resolveAiConnection(env);
  if(!connection)throw new Error('AI connection is not configured.');
  const send=()=>{
    if(new URL(connection.baseURL).protocol!=='https:')throw new Error('AI connection must use HTTPS.');
    return fetchImpl(`${connection.baseURL}/responses`,{method:'POST',signal,headers:{Authorization:`Bearer ${connection.key}`,'Content-Type':'application/json'},body});
  };
  let response=await send();
  if(response.status===401&&connection.mode==='netlify_gateway'){
    const current=resolveAiConnection(env);
    if(current?.mode==='netlify_gateway'&&current.key!==connection.key){
      await response.body?.cancel();connection=current;response=await send();
    }
  }
  return {response,connection};
}
