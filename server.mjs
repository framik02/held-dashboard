import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173),repo=process.env.HELD_REPO||'framik02/held-wiki';
const nonce=randomBytes(32).toString('hex');
const assets=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/core.js','core.js'],['/style.css','style.css'],['/icon.svg','icon.svg'],['/auth-config.json','auth-config.json'],['/graph.js','graph.js'],['/mappa.js','mappa.js'],['/vendor/d3.min.js','vendor/d3.min.js'],['/vendor/topojson.min.js','vendor/topojson.min.js'],['/fonts/manrope-variable.ttf','fonts/manrope-variable.ttf']]);
const mime={'.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf'};
const gh=process.platform==='win32'?'gh.exe':'gh';
function respond(res,status,data,type='application/json') {res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','X-Frame-Options':'DENY'});res.end(type==='application/json'?JSON.stringify(data):data);}
import {isAttachmentPath,attachmentBodyLimit,isAttachmentEndpoint} from './auth/worker.mjs';
export function allowedEndpoint(endpoint,method,repository){
  if(method==='GET'&&(endpoint==='/user'||endpoint===`/repos/${repository}`||endpoint===`/repos/${repository}/git/trees/main?recursive=1`))return true;
  const blobs=`/repos/${repository}/git/blobs/`;
  if(method==='GET'&&endpoint.startsWith(blobs)&&/^[0-9a-f]{40}$/.test(endpoint.slice(blobs.length)))return true;
  const prefix=`/repos/${repository}/contents/`;
  if(!endpoint.startsWith(prefix)||!['GET','PUT','DELETE'].includes(method))return false;
  let p;try{p=decodeURIComponent(endpoint.slice(prefix.length).split('?')[0]);}catch{return false;}
  if(isAttachmentPath(p))return ['PUT','DELETE'].includes(method)&&!endpoint.includes('?');
  const ok=p.endsWith('.md')&&!p.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.'))&&!p.includes('\\')&&!p.includes('\0');
  if(method==='DELETE')return ok&&/^attivita\/[^/]+\.md$/.test(p)&&!/\/README\.md$/i.test(p);
  return ok;
}
async function getBody(req,max=1024*1024){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>max)throw new Error('Richiesta troppo grande.');}return body;}
function callGitHub(endpoint,method,body){return new Promise(resolve=>{
  const args=['api',endpoint,'--method',method,'-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'];
  if(body)args.push('--input','-');
  const child=spawn(gh,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  const timeout=setTimeout(()=>child.kill(),25000);
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  child.on('error',()=>{clearTimeout(timeout);resolve({status:503,data:{message:'GitHub CLI non disponibile. Installa gh ed esegui gh auth login.'}});});
  child.on('close',code=>{clearTimeout(timeout);let data;try{data=JSON.parse(out);}catch{data={message:'GitHub CLI non connessa. Esegui gh auth login e riprova.'};}const status=code===0?200:Number(err.match(/HTTP (\d{3})/)?.[1]||502);resolve({status,data});});
  child.stdin.on('error',()=>{});child.stdin.end(body||'');
});}
export function createServer(){return http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return respond(res,403,{message:'Host non autorizzato.'});
    if(req.headers.origin&&! [`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))return respond(res,403,{message:'Origine non autorizzata.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname==='/api/config'&&req.method==='GET')return respond(res,200,{local:true,repo,nonce});
    if(url.pathname.startsWith('/api/github/')){
      if(req.headers['x-held-local']!==nonce)return respond(res,403,{message:'Sessione locale non valida. Ricarica la pagina.'});
      const endpoint=req.url.slice('/api/github'.length);
      if(!allowedEndpoint(endpoint,req.method,repo))return respond(res,403,{message:'Questa operazione non è disponibile nella dashboard.'});
      const body=['PUT','DELETE'].includes(req.method)?await getBody(req,isAttachmentEndpoint(endpoint,repo)?attachmentBodyLimit():1024*1024):'';
      if(req.method==='PUT'){const parsed=JSON.parse(body||'{}');if(parsed.branch!=='main'||typeof parsed.content!=='string'||typeof parsed.message!=='string')return respond(res,400,{message:'Dati non validi.'});}
      if(req.method==='DELETE'){const parsed=JSON.parse(body||'{}');if(parsed.branch!=='main'||typeof parsed.sha!=='string'||typeof parsed.message!=='string'||parsed.content!==undefined)return respond(res,400,{message:'Dati non validi.'});}
      const result=await callGitHub(endpoint,req.method,body);return respond(res,result.status,result.data);
    }
    if(req.method!=='GET'||!assets.has(url.pathname))return respond(res,404,{message:'Non trovato.'});
    const file=assets.get(url.pathname);respond(res,200,await readFile(path.join(root,file)),mime[path.extname(file)]);
  }catch{return respond(res,500,{message:'Richiesta non completata. Verifica la connessione e riprova.'});}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createServer().listen(port,'127.0.0.1',()=>console.log(`Held: http://127.0.0.1:${port} · Wiki ${repo}`));
}
