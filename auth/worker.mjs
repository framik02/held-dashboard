const SESSION='__Host-held-session',FLOW='__Host-held-flow';
const MAX_SESSION=8*60*60;
const bytes=new TextEncoder();
function base64url(data){return btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64url(value){return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
async function key(env){if(!/^[a-f0-9]{64}$/i.test(env.SESSION_KEY||''))throw new Error('Configurazione sessione mancante');return crypto.subtle.importKey('raw',Uint8Array.from(env.SESSION_KEY.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function seal(data,env,purpose){const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(purpose)},await key(env),bytes.encode(JSON.stringify(data)));return base64url(iv)+'.'+base64url(encrypted);}
export async function unseal(value,env,purpose){try{if(!value||value.length>3800)return null;const [iv,data]=value.split('.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64url(iv),additionalData:bytes.encode(purpose)},await key(env),unbase64url(data));const payload=JSON.parse(new TextDecoder().decode(plain));return payload.exp>Date.now()?payload:null;}catch{return null;}}
function cookies(req){return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1)];}));}
function cookie(name,value,age){return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;}
function headers(){return new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});}
function json(data,status=200,extra={}){const h=headers();h.set('Content-Type','application/json');for(const [k,v] of Object.entries(extra))h.set(k,v);return new Response(JSON.stringify(data),{status,headers:h});}
function redirect(url,setCookies=[]){const h=headers();h.set('Location',url);setCookies.forEach(c=>h.append('Set-Cookie',c));return new Response(null,{status:302,headers:h});}
function configured(env){return !!env.GITHUB_CLIENT_ID&&!!env.GITHUB_CLIENT_SECRET&&/^[a-f0-9]{64}$/i.test(env.SESSION_KEY||'')&&/^https:\/\/[^/]+$/.test(env.APP_ORIGIN||'')&&/^[\w.-]+\/[\w.-]+$/.test(env.HELD_REPO||'');}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export function allowed(endpoint,method,repo){
 if(method==='GET'&&['/user',`/repos/${repo}`,`/repos/${repo}/git/trees/main?recursive=1`].includes(endpoint))return true;
 const prefix=`/repos/${repo}/contents/`;if(!endpoint.startsWith(prefix)||!['GET','PUT'].includes(method))return false;
 const [raw,query]=endpoint.slice(prefix.length).split('?');if(query&&(method!=='GET'||query!=='ref=main'))return false;
 let p;try{p=decodeURIComponent(raw);}catch{return false;}
 return p.endsWith('.md')&&!p.split('/').some(part=>!part||part.startsWith('.'))&&!/[\\\0?#]/.test(p);
}
async function github(endpoint,token,method='GET',body,fetcher=fetch){return fetcher('https://api.github.com'+endpoint,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Held-Dashboard',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}
async function session(req,env){return unseal(cookies(req)[SESSION],env,'session');}
async function readBody(req){if(Number(req.headers.get('Content-Length')||0)>1048576)throw new Error('Richiesta troppo grande');const reader=req.body?.getReader();if(!reader)throw new Error('Corpo mancante');let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw new Error('Richiesta troppo grande');}chunks.push(value);}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(result));}
export async function handle(req,env,fetcher=fetch){
 const url=new URL(req.url),route=url.pathname;
 if(!route.startsWith('/auth/')&&!route.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!configured(env))return json({enabled:false,message:'Login GitHub non ancora configurato.'},503);
 if(url.origin!==env.APP_ORIGIN)return json({message:'Dominio non autorizzato.'},403);
 const origin=req.headers.get('Origin');if(origin&&origin!==env.APP_ORIGIN)return json({message:'Origine non autorizzata.'},403);
 if(route==='/auth/start'&&req.method==='GET'){
   const state=random(),verifier=random(),challenge=base64url(await crypto.subtle.digest('SHA-256',bytes.encode(verifier)));
   const flow=await seal({state,verifier,exp:Date.now()+600000},env,'flow');
   const target=new URL('https://github.com/login/oauth/authorize');target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:env.APP_ORIGIN+'/auth/callback',state,code_challenge:challenge,code_challenge_method:'S256',allow_signup:'false'}).toString();
   return redirect(target.href,[cookie(FLOW,flow,600)]);
 }
 if(route==='/auth/callback'&&req.method==='GET'){
   const flow=await unseal(cookies(req)[FLOW],env,'flow');const clear=cookie(FLOW,'',0);
   if(!flow||!equal(flow.state,url.searchParams.get('state')))return redirect('/?auth_error=state',[clear]);
   if(url.searchParams.has('error'))return redirect('/?auth_error=denied',[clear]);
   const code=url.searchParams.get('code');if(!code||code.length>500)return redirect('/?auth_error=code',[clear]);
   const result=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'Held-Dashboard'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,code_verifier:flow.verifier,redirect_uri:env.APP_ORIGIN+'/auth/callback'}),redirect:'error',signal:AbortSignal.timeout(20000)});
   const token=await result.json();if(!result.ok||typeof token.access_token!=='string')return redirect('/?auth_error=exchange',[clear]);
   const access=await github(`/repos/${env.HELD_REPO}`,token.access_token,'GET',undefined,fetcher);
   if(!access.ok)return redirect('/?auth_error=access',[clear,cookie(SESSION,'',0)]);
   const repository=await access.json();if(repository.full_name?.toLowerCase()!==env.HELD_REPO.toLowerCase()||repository.permissions?.push!==true)return redirect('/?auth_error=access',[clear,cookie(SESSION,'',0)]);
   const ttl=Math.max(1,Math.min(MAX_SESSION,Number(token.expires_in)||3600)-60);
   const value=await seal({token:token.access_token,csrf:random(),exp:Date.now()+ttl*1000},env,'session');
   if(value.length>3700)return redirect('/?auth_error=session',[clear]);
   return redirect('/',[clear,cookie(SESSION,value,ttl)]);
 }
 if(route==='/auth/session'&&req.method==='GET'){
   const current=await session(req,env);if(!current)return json({enabled:true,authenticated:false,repo:env.HELD_REPO});
   const who=await github('/user',current.token,'GET',undefined,fetcher);
   if(who.status===401)return json({enabled:true,authenticated:false,repo:env.HELD_REPO},200,{'Set-Cookie':cookie(SESSION,'',0)});
   if(!who.ok)return json({message:'GitHub non è raggiungibile. Riprova.'},503);
   const user=await who.json();return json({enabled:true,authenticated:true,repo:env.HELD_REPO,csrf:current.csrf,expiresAt:current.exp,user:{login:user.login}});
 }
 const current=await session(req,env);if(!current)return json({message:'Sessione scaduta. Accedi di nuovo con GitHub.'},401);
 if(req.method!=='GET'&&(origin!==env.APP_ORIGIN||!equal(req.headers.get('X-Held-CSRF'),current.csrf)))return json({message:'Richiesta non autorizzata. Ricarica la pagina.'},403);
 if(route==='/auth/logout'&&req.method==='POST'){
   // Revoca solo il token di questa sessione, non l’intera autorizzazione dell’app.
   try{await fetcher(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`,{method:'DELETE',headers:{Authorization:'Basic '+btoa(env.GITHUB_CLIENT_ID+':'+env.GITHUB_CLIENT_SECRET),Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'Held-Dashboard'},body:JSON.stringify({access_token:current.token}),redirect:'error',signal:AbortSignal.timeout(10000)});}catch{}
   return json({ok:true},200,{'Set-Cookie':cookie(SESSION,'',0)});
 }
 if(route.startsWith('/api/github/')){
   const endpoint=route.slice('/api/github'.length)+url.search;if(!allowed(endpoint,req.method,env.HELD_REPO))return json({message:'Operazione non consentita.'},403);
   let body;if(req.method==='PUT'){
     try{body=await readBody(req);}catch{return json({message:'Richiesta non valida o troppo grande.'},400);}
     if(!body||Array.isArray(body)||body.branch!=='main'||typeof body.content!=='string'||typeof body.message!=='string'||body.message.length>500||(body.sha!==undefined&&typeof body.sha!=='string')||Object.keys(body).some(k=>!['branch','content','message','sha'].includes(k)))return json({message:'Dati non validi.'},400);
   }
   const response=await github(endpoint,current.token,req.method,body,fetcher);const h=headers();h.set('Content-Type','application/json');if(response.status===401)h.set('Set-Cookie',cookie(SESSION,'',0));
   return new Response(await response.text(),{status:response.status,headers:h});
 }
 return json({message:'Non trovato.'},404);
}
export default {async fetch(req,env){try{return await handle(req,env);}catch{return json({message:'Accesso temporaneamente non disponibile. Riprova.'},503);}}};
