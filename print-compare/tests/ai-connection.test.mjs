import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAiConnection,fetchAiResponse} from '../server/ai-connection.mjs';
const gatewayBase='https://example.netlify.app/.netlify/ai/';
test('stale provider aliases cannot override the current canonical Netlify gateway credential pair',()=>{
 const actual=resolveAiConnection({OPENAI_API_KEY:'old-gateway-token',OPENAI_BASE_URL:gatewayBase,NETLIFY_AI_GATEWAY_KEY:'current-gateway-token',NETLIFY_AI_GATEWAY_URL:gatewayBase});
 assert.deepEqual(actual,{key:'current-gateway-token',baseURL:gatewayBase.slice(0,-1),mode:'netlify_gateway'});
});
test('an explicitly configured provider key and custom endpoint are preserved',()=>{
 const actual=resolveAiConnection({OPENAI_API_KEY:'sk-own-key',OPENAI_BASE_URL:'https://api.openai.com/v1',NETLIFY_AI_GATEWAY_KEY:'gateway-token',NETLIFY_AI_GATEWAY_URL:gatewayBase});
 assert.equal(actual.key,'sk-own-key');assert.equal(actual.baseURL,'https://api.openai.com/v1');
 const custom=resolveAiConnection({OPENAI_API_KEY:'custom-token',OPENAI_BASE_URL:'https://provider.example/v1',NETLIFY_AI_GATEWAY_KEY:'gateway-token',NETLIFY_AI_GATEWAY_URL:gatewayBase});assert.equal(custom.key,'custom-token');
});
test('canonical-only gateway credentials and the base-URL alias are supported',()=>{
 assert.equal(resolveAiConnection({NETLIFY_AI_GATEWAY_KEY:'gateway-token',NETLIFY_AI_GATEWAY_BASE_URL:gatewayBase}).mode,'netlify_gateway');
 assert.equal(resolveAiConnection({}),null);
});
test('a real OpenAI key is not accidentally sent to a leftover Netlify gateway URL',()=>{
 const actual=resolveAiConnection({OPENAI_API_KEY:'sk-own-key',OPENAI_BASE_URL:gatewayBase,NETLIFY_AI_GATEWAY_KEY:'gateway-token',NETLIFY_AI_GATEWAY_URL:gatewayBase});
 assert.equal(actual.key,'sk-own-key');assert.equal(actual.baseURL,'https://api.openai.com/v1');assert.equal(actual.mode,'openai');
});
test('a rejected gateway token is retried once only when the runtime supplies a fresh token',async()=>{
 const env={NETLIFY_AI_GATEWAY_KEY:'first-token',NETLIFY_AI_GATEWAY_URL:gatewayBase},keys=[];
 const {response}=await fetchAiResponse(env,'{}',async(url,options)=>{keys.push(options.headers.Authorization);if(keys.length===1){env.NETLIFY_AI_GATEWAY_KEY='refreshed-token';return new Response('{}',{status:401});}return new Response('{}',{status:200});});
 assert.equal(response.status,200);assert.deepEqual(keys,['Bearer first-token','Bearer refreshed-token']);
});
test('unchanged credentials, provider keys, quota limits and permission failures are not blindly retried',async()=>{
 for(const status of [401,403,429]){let calls=0;await fetchAiResponse({NETLIFY_AI_GATEWAY_KEY:'token',NETLIFY_AI_GATEWAY_URL:gatewayBase},'{}',async()=>{calls++;return new Response('{}',{status});});assert.equal(calls,1);}
});
