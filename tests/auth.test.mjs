import test from 'node:test';
import assert from 'node:assert/strict';
import {handle,seal,unseal,allowed} from '../auth/worker.mjs';
const env={SESSION_KEY:'a'.repeat(64),GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-secret',APP_ORIGIN:'https://held.example',HELD_REPO:'team/wiki',ASSETS:{fetch:()=>new Response('static')}};
const request=(path,init={})=>new Request(env.APP_ORIGIN+path,init);
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
const never=()=>{throw new Error('Unexpected network');};
async function sessionHeaders(extra={}){return {Cookie:'__Host-held-session='+await seal({token:'fake-user-token',csrf:'test-csrf',exp:Date.now()+60000},env,'session'),...extra};}
test('session encryption rejects tampering, expiry, wrong key and wrong purpose',async()=>{
 const value=await seal({token:'private-value',exp:Date.now()+60000},env,'session');
 assert.equal((await unseal(value,env,'session')).token,'private-value');assert.ok(!value.includes('private-value'));
 assert.equal(await unseal(value,env,'flow'),null);assert.equal(await unseal(value,{...env,SESSION_KEY:'b'.repeat(64)},'session'),null);
 assert.equal(await unseal(value.slice(0,20)+'x'+value.slice(21),env,'session'),null);
 assert.equal(await unseal(await seal({exp:1},env,'session'),env,'session'),null);
});
test('OAuth binds state and PKCE to encrypted cookie and verifies repository access',async()=>{
 const start=await handle(request('/auth/start'),env,never),target=new URL(start.headers.get('location'));
 assert.equal(target.origin,'https://github.com');assert.equal(target.searchParams.get('code_challenge_method'),'S256');
 const flowCookie=start.headers.get('set-cookie');assert.match(flowCookie,/Secure; HttpOnly; SameSite=Lax/);
 const headers={Cookie:flowCookie.split(';')[0]};let exchanged=false;
 const invalid=await handle(request('/auth/callback?state=wrong&code=test',{headers}),env,never);assert.equal(invalid.headers.get('location'),'/?auth_error=state');
 const mock=async(url,opts)=>{
  if(url.endsWith('/access_token')){const body=JSON.parse(opts.body);assert.ok(body.code_verifier);const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier))).toString('base64url');assert.equal(digest,target.searchParams.get('code_challenge'));exchanged=true;return reply({access_token:'fake-user-token',expires_in:28800});}
  assert.equal(url,'https://api.github.com/repos/team/wiki');return reply({full_name:'team/wiki',permissions:{push:true}});
 };
 const callback=await handle(request('/auth/callback?code=test&state='+target.searchParams.get('state'),{headers}),env,mock);
 assert.ok(exchanged);assert.equal(callback.headers.get('location'),'/');assert.match(callback.headers.get('set-cookie'),/__Host-held-session=/);assert.ok(!callback.headers.get('set-cookie').includes('fake-user-token'));
 const denied=await handle(request('/auth/callback?code=test&state='+target.searchParams.get('state'),{headers}),env,async(url,opts)=>url.endsWith('/access_token')?mock(url,opts):reply({full_name:'team/wiki',permissions:{push:false}}));assert.equal(denied.headers.get('location'),'/?auth_error=access');
});
test('session restore never sends the GitHub token to JavaScript',async()=>{
 const response=await handle(request('/auth/session',{headers:await sessionHeaders()}),env,async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer fake-user-token');return reply({login:'tester'});});
 const body=await response.text();assert.ok(!body.includes('fake-user-token'));assert.equal(JSON.parse(body).csrf,'test-csrf');assert.equal(JSON.parse(body).authenticated,true);
 const expired=await handle(request('/auth/session'),env,never);assert.equal((await expired.json()).authenticated,false);
 const revoked=await handle(request('/auth/session',{headers:await sessionHeaders()}),env,()=>reply({},401));assert.equal((await revoked.json()).authenticated,false);assert.match(revoked.headers.get('set-cookie'),/Max-Age=0/);
});
test('proxy is restricted to main Markdown files in the configured repository',()=>{
 assert.ok(allowed('/repos/team/wiki/contents/docs/test.md?ref=main','GET','team/wiki'));
 for(const p of ['/repos/other/wiki/contents/a.md','/repos/team/wiki/contents/.github/a.md','/repos/team/wiki/contents/%2e%2e/a.md','/repos/team/wiki/contents/a.md?ref=other','/repos/team/wiki/contents/a.js','/repos/team/wiki/contents/a%5cb.md'])assert.equal(allowed(p,'GET','team/wiki'),false,p);
 assert.equal(allowed('/repos/team/wiki/contents/a.md','DELETE','team/wiki'),false);assert.equal(allowed('/repos/team/wiki/contents/attivita/h001.md','DELETE','team/wiki'),true);assert.equal(allowed('/repos/team/wiki/contents/attivita/README.md','DELETE','team/wiki'),false);assert.ok(allowed('/repos/team/wiki/git/blobs/0123456789abcdef0123456789abcdef01234567','GET','team/wiki'));assert.equal(allowed('/repos/team/wiki/git/blobs/abc','GET','team/wiki'),false);assert.equal(allowed('/repos/other/wiki/git/blobs/0123456789abcdef0123456789abcdef01234567','GET','team/wiki'),false);assert.equal(allowed('/repos/team/wiki/git/blobs/0123456789abcdef0123456789abcdef01234567','PUT','team/wiki'),false);assert.equal(allowed('/repos/team/wiki/contents/docs/a.md','DELETE','team/wiki'),false);
});
test('writes require session, same origin and CSRF; preserve SHA conflicts',async()=>{
 const path='/api/github/repos/team/wiki/contents/docs/a.md',body=JSON.stringify({branch:'main',message:'Test',content:'dGVzdA==',sha:'old-sha'});
 assert.equal((await handle(request(path,{method:'PUT',body}),env,never)).status,401);
 assert.equal((await handle(request(path,{method:'PUT',body,headers:await sessionHeaders({Origin:env.APP_ORIGIN})}),env,never)).status,403);
 assert.equal((await handle(request(path,{method:'PUT',body,headers:await sessionHeaders({Origin:'https://evil.example','X-Held-CSRF':'test-csrf'})}),env,never)).status,403);
 const headers=await sessionHeaders({Origin:env.APP_ORIGIN,'X-Held-CSRF':'test-csrf'});
 const conflict=await handle(request(path,{method:'PUT',body,headers}),env,async(url,opts)=>{assert.equal(JSON.parse(opts.body).sha,'old-sha');assert.equal(opts.headers.Authorization,'Bearer fake-user-token');return reply({message:'conflict'},409);});assert.equal(conflict.status,409);
 assert.equal((await handle(request(path,{method:'PUT',body:body.replace('main','other'),headers}),env,never)).status,400);
 assert.equal((await handle(request(path,{method:'PUT',body:'null',headers}),env,never)).status,400);
});
test('logout revokes only the current token and clears the cookie',async()=>{
 const response=await handle(request('/auth/logout',{method:'POST',headers:await sessionHeaders({Origin:env.APP_ORIGIN,'X-Held-CSRF':'test-csrf'})}),env,async(url,opts)=>{assert.equal(url,'https://api.github.com/applications/test-client/token');assert.equal(opts.method,'DELETE');assert.equal(JSON.parse(opts.body).access_token,'fake-user-token');return new Response(null,{status:204});});
 assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal(response.status,200);
});
test('missing setup fails closed while public static assets stay available',async()=>{
 assert.equal((await handle(request('/auth/session'),{},never)).status,503);
 assert.equal(await (await handle(request('/'),env,never)).text(),'static');
 assert.equal((await handle(new Request('https://wrong.example/auth/start'),env,never)).status,403);
});
