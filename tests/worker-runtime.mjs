import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const {Miniflare,convertV4MiniflareOptions}=await import(process.env.HELD_MINIFLARE_MODULE||'miniflare');
const source=fs.readFileSync(process.env.HELD_WORKER_FILE||fileURLToPath(new URL('../auth/worker.mjs',import.meta.url)),'utf8');
const origin='https://held.example';
const mock=`export default {async fetch(req){
 const url=new URL(req.url);const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
 if(!['github.com','api.github.com'].includes(url.hostname))throw new Error('Credenziali inoltrate a un dominio estraneo');
 if(url.pathname==='/login/oauth/access_token'){
  const body=await req.json();if(body.code==='redirect-code')return new Response(null,{status:307,headers:{Location:'https://untrusted.example/token'}});
  if(!body.code_verifier||body.client_secret!=='fake-secret')return json({error:'invalid_exchange'},400);
  return json({access_token:'fake-'+body.code,expires_in:28800});
 }
 if(url.pathname==='/repos/team/wiki')return json({full_name:'team/wiki',permissions:{push:true}});
 if(url.pathname==='/user')return json({login:'test-user'});
 if(url.pathname==='/applications/fake-client/token')return new Response(null,{status:204});
 if(url.pathname==='/repos/team/wiki/contents/redirect.md')return new Response(null,{status:302,headers:{Location:'https://untrusted.example/wiki'}});
 if(url.pathname==='/repos/team/wiki/contents/test.md'){
  if(req.method==='PUT'){const body=await req.json();return body.sha==='old-sha'?json({message:'conflict'},409):json({content:{sha:'new-sha'}});}
  return json({sha:'current-sha',encoding:'base64',content:'dGVzdA=='});
 }
 return json({message:'Unexpected mock endpoint'},404);
}};`;
const options={workers:[
 {name:'held',modules:true,script:source,compatibilityDate:'2026-11-13',bindings:{SESSION_KEY:'a'.repeat(64),GITHUB_CLIENT_ID:'fake-client',GITHUB_CLIENT_SECRET:'fake-secret',APP_ORIGIN:origin,HELD_REPO:'team/wiki'},outboundService:'github-mock'},
 {name:'github-mock',modules:true,script:mock,compatibilityDate:'2026-11-13'}
]};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
const request=(path,init={})=>mf.dispatchFetch(origin+path,{...init,redirect:'manual'});
const cookie=(response,name)=>response.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0];
async function callback(code){const start=await request('/auth/start');assert.equal(start.status,302);const state=new URL(start.headers.get('location')).searchParams.get('state');return request('/auth/callback?code='+code+'&state='+state,{headers:{Cookie:cookie(start,'__Host-held-flow')}});}
try{
 const complete=await callback('success-code');assert.equal(complete.status,302,'Il callback deve completare anche nel runtime Cloudflare');assert.equal(complete.headers.get('location'),'/');
 const sessionCookie=cookie(complete,'__Host-held-session');assert.ok(sessionCookie);
 const session=await (await request('/auth/session',{headers:{Cookie:sessionCookie}})).json();assert.equal(session.authenticated,true);assert.equal(session.user.login,'test-user');assert.ok(!JSON.stringify(session).includes('fake-success-code'));
 const headers={Cookie:sessionCookie,Origin:origin,'X-Held-CSRF':session.csrf};
 assert.equal((await request('/api/github/repos/team/wiki/contents/test.md',{headers})).status,200);
 const conflict=await request('/api/github/repos/team/wiki/contents/test.md',{method:'PUT',headers,body:JSON.stringify({branch:'main',message:'Test',content:'dGVzdA==',sha:'old-sha'})});assert.equal(conflict.status,409);
 assert.equal((await request('/api/github/repos/team/wiki/contents/redirect.md',{headers})).status,503,'Il proxy deve rifiutare redirect GitHub senza inoltrare credenziali');
 const rejected=await callback('redirect-code');assert.equal(rejected.status,503,'Lo scambio OAuth deve rifiutare redirect inattesi');assert.ok(!cookie(rejected,'__Host-held-session'));
 const logout=await request('/auth/logout',{method:'POST',headers});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 console.log('Runtime Cloudflare OK: callback OAuth, ripristino sessione, lettura/scrittura con conflitto, blocco redirect esterni e uscita. Nessuna chiamata a GitHub reale.');
}finally{await mf.dispose();}
