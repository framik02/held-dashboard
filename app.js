import {buildGraph,mountGraph} from './graph.js';
import {loadMapLibraries,mountMap} from './mappa.js';
import {CATEGORIES,categoryLabel,STATUSES,PRIORITIES,PHASES,escapeHTML as e,parseMarkdown,serializeMarkdown,toTask,checklist,toggleCheck,addComment,encode64,decode64,markdownHTML,fileURL,ATTACH_PATH,cleanChat,chatBlock,parseChat} from './core.js';
const $=s=>document.querySelector(s);
const state={repo:'framik02/held-wiki',token:'',oauth:false,csrf:'',local:false,nonce:'',user:null,tasks:[],files:[],cache:new Map(),view:'overview',groupBy:'category',filter:{search:'',assignee:'',phase:'',priority:'',category:''},loading:false,saving:false,editor:null,wikiPath:'stato.md',meetingPath:'',docPath:'',hideDone:(()=>{try{return localStorage.getItem('held.hideDone')!=='0';}catch{return true;}})(),wikiQuery:'',lastHead:'',poll:null,session:0};
let toastTimer,disposeGraph=null;
const mobileMenu=matchMedia('(max-width:720px)');
let menuOpen=!mobileMenu.matches;
function setMenu(open,focus=false){
  menuOpen=open;$('#app').classList.toggle('menu-open',open);$('#app').classList.toggle('menu-closed',!open);
  $('#sidebar').inert=!open;$('#menu-toggle').setAttribute('aria-expanded',String(open));$('#menu-toggle').setAttribute('aria-label',open?'Chiudi menu':'Apri menu');
  $('#menu-backdrop').hidden=!(open&&mobileMenu.matches);document.body.classList.toggle('menu-lock',open&&mobileMenu.matches);
  $('.workspace').inert=open&&mobileMenu.matches;
  if(focus)(open&&mobileMenu.matches?$('#menu-close'):$('#menu-toggle')).focus();
}
$('#menu-toggle').onclick=()=>setMenu(!menuOpen,true);
$('#menu-close').onclick=$('#menu-backdrop').onclick=()=>setMenu(false,true);
mobileMenu.addEventListener('change',()=>setMenu(!mobileMenu.matches));
document.addEventListener('keydown',event=>{
 if(!menuOpen||!mobileMenu.matches)return;
 if(event.key==='Escape'){event.preventDefault();setMenu(false,true);}
 if(event.key==='Tab'){const controls=[...$('#sidebar').querySelectorAll('a,button')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
setMenu(menuOpen);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
const initials=s=>(s||'?').slice(0,2).toUpperCase();
const shortName=t=>t.assignee||'Da assegnare';
const ownerLabel=t=>shortName(t)+(t.assignment==='proposed'&&t.assignee?' · proposto':'');
// Un colore per area di lavoro e uno per persona, così si riconoscono a colpo d'occhio.
const CATEGORY_COLORS={coordinamento:'#2f67a6',sviluppo:'#6b4fb3',contabilita:'#0f7d74',finanziamenti:'#b0700c',legale:'#a2473d',comunicazione:'#b8417a',territorio:'#3d8a3a',pilota:'#c4581c',unclassified:'#6b7f93'};
const catColor=c=>CATEGORY_COLORS[c||'unclassified']||CATEGORY_COLORS.unclassified;
const PEOPLE_COLORS={flavio:'#1f6fb8',franco:'#c2410c',othello:'#7c3aed'};
const personColor=name=>{const k=(name||'').trim().toLowerCase();if(PEOPLE_COLORS[k])return PEOPLE_COLORS[k];if(!k||k==='da assegnare')return '#6b7f93';let h=0;for(const ch of k)h=(h*31+ch.charCodeAt(0))%360;return `hsl(${h} 55% 38%)`;};
const personChip=t=>`<span class="person-chip" style="--p:${personColor(t.assignee)}">${e(shortName(t))}${t.assignment==='proposed'&&t.assignee?'<small>proposto</small>':''}</span>`;
const sorted=tasks=>[...tasks].sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority])||String(a.due||'9999').localeCompare(String(b.due||'9999'))||a.title.localeCompare(b.title));
function errorText(err){if(state.oauth&&err.status===401)return 'Sessione scaduta. Conserva la bozza, esci e premi Accedi con GitHub.';if(state.oauth&&err.status===403)return 'Operazione non autorizzata. Verifica l’accesso alla wiki o riprova più tardi.';if(err.status===401)return 'Accesso scaduto o token non valido. Esci e ricollega GitHub.';if(err.status===403)return 'GitHub non autorizza questa operazione. Controlla permessi del token, accesso al repository o limite API.';if(err.status===404)return 'Repository o file non trovato. Per una wiki privata verifica che il token abbia accesso.';if(err.status===409||err.status===422)return 'Il file è cambiato su GitHub o la modifica non è applicabile. La tua bozza è conservata qui: scaricala, chiudi e riapri la scheda aggiornata prima di integrare le modifiche.';return err.message||'Connessione non disponibile. Riprova: nessuna modifica è stata confermata.';}
async function api(path,method='GET',body){
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(state.oauth)headers['X-Held-CSRF']=state.csrf;else if(state.local)headers['X-Held-Local']=state.nonce;else headers.Authorization=`Bearer ${state.token}`;
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(state.local||state.oauth?`/api/github${path}`:`https://api.github.com${path}`,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const err=new Error(data.message||'Errore GitHub');err.status=response.status;throw err;}return data;
}
const contentPath=path=>`/repos/${state.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
async function readFile(path,force=false){
  const tree=state.files.find(f=>f.path===path);const cached=state.cache.get(path);
  if(!force&&cached&&cached.sha===tree?.sha)return cached;
  const data=await api(contentPath(path)+'?ref=main');
  if(data.encoding!=='base64')throw new Error('Il file è troppo grande per questo editor. Aprilo su GitHub.');
  const file={path,sha:data.sha,raw:decode64(data.content)};state.cache.set(path,file);return file;
}
async function writeFile(path,raw,sha,message){
  const result=await api(contentPath(path),'PUT',{message,content:encode64(raw),branch:'main',...(sha?{sha}:{})});
  const file={path,raw,sha:result.content.sha};state.cache.set(path,file);return file;
}
async function linkNewTask(path,title){
  for(let attempt=0;attempt<3;attempt++){
    const index=await readFile('attivita/README.md',true);const parsed=parseMarkdown(index.raw);const filename=path.split('/').pop();
    if(parsed.body.includes(`](${filename})`))return;
    const label=title.replace(/[\[\]\r\n]/g,' ');
    const raw=serializeMarkdown(index.raw,{updated:today()},parsed.body.trimEnd()+`\n\n- [${label}](${filename})\n`);
    try{await writeFile(index.path,raw,index.sha,'Held: collega la nuova attività nell’indice');return;}catch(err){if(err.status!==409||attempt===2)throw err;}
  }
}
async function unlinkTask(path){
  const filename=path.split('/').pop();
  for(let attempt=0;attempt<3;attempt++){
    const index=await readFile('attivita/README.md',true);const parsed=parseMarkdown(index.raw);
    const lines=parsed.body.split('\n');const kept=lines.filter(line=>!line.includes(`](${filename})`));
    if(kept.length===lines.length)return;
    const raw=serializeMarkdown(index.raw,{updated:today()},kept.join('\n').replace(/\n{3,}/g,'\n\n'));
    try{await writeFile(index.path,raw,index.sha,'Held: toglie dall’indice l’attività cancellata');return;}catch(err){if(err.status!==409||attempt===2)throw err;}
  }
}
async function deleteTask(){
  const ed=state.editor;if(!ed||ed.kind!=='task'||!ed.sha||state.saving)return;
  const title=state.tasks.find(t=>t.path===ed.path)?.title||ed.path;
  if(!confirm(`Cancellare l’attività «${title}»?\n\nSparisce dalla dashboard per tutto il gruppo. Resta recuperabile dalla cronologia di GitHub.`))return;
  state.saving=true;$('#delete-task').disabled=true;$('#delete-task').textContent='Cancellazione…';
  try{
    await api(contentPath(ed.path),'DELETE',{message:`Held: cancella attività ${ed.path} · ${title}`.slice(0,500),sha:ed.sha,branch:'main'});
    state.cache.delete(ed.path);let notice='Attività cancellata.';
    try{await unlinkTask(ed.path);}catch{notice='Attività cancellata. Il collegamento in attivita/README.md è rimasto: toglilo a mano.';}
    $('#editor').close();state.editor=null;toast(notice);
  }catch(err){$('#editor-feedback').textContent=err.status===409?'Qualcuno ha modificato l’attività nel frattempo. Chiudi, ricarica e riprova.':errorText(err);}
  finally{state.saving=false;$('#delete-task').disabled=false;$('#delete-task').textContent='Cancella attività';await refresh(true);}
}
async function refresh(silent=false){
  if(state.loading||state.saving||!state.user)return;
  state.loading=true;const session=state.session;$('#refresh').disabled=true;
  try{
    const tree=await api(`/repos/${state.repo}/git/trees/main?recursive=1`);
    if(session!==state.session)return;
    if(tree.truncated)throw new Error('Indice GitHub incompleto: apri il repository per consultare tutti i file.');
    if(tree.sha!==state.lastHead||!silent){
      state.files=tree.tree.filter(f=>f.type==='blob'&&f.path.endsWith('.md'));state.dataFiles=tree.tree.filter(f=>f.type==='blob'&&/^dati\/[^/]+\/[^/]+\.json$/.test(f.path));state.attachments=tree.tree.filter(f=>f.type==='blob'&&ATTACH_PATH.test(f.path));
      await loadPeople();
      if(state.files.some(f=>f.path==='attivita/README.md')){
        const config=parseMarkdown((await readFile('attivita/README.md')).raw).meta.phases;
        if(config&&typeof config==='object')for(const [key,p] of Object.entries(config)){
          if(Object.hasOwn(PHASES,key)&&typeof p.name==='string'&&typeof p.period==='string'&&typeof p.description==='string')PHASES[key]={name:p.name,period:p.period,description:p.description};
        }
      }
      const taskFiles=state.files.filter(f=>/^attivita\/[^/]+\.md$/.test(f.path)&&!f.path.endsWith('/README.md'));
      const tasks=[];const errors=[];
      for(let i=0;i<taskFiles.length;i+=6){
        const results=await Promise.allSettled(taskFiles.slice(i,i+6).map(async f=>toTask(await readFile(f.path))));
        results.forEach(r=>r.status==='fulfilled'?tasks.push(r.value):errors.push(r.reason.message));
      }
      if(session!==state.session)return;
      state.tasks=tasks;state.lastHead=tree.sha;state.errors=errors;updateChatDot();
      // In chat non si ridisegna la pagina: si perderebbe il messaggio che si sta scrivendo.
      if(state.view==='chat'&&silent){$('#task-count').textContent=state.tasks.filter(t=>t.status!=='done').length;loadChat(true);}else render();
    }
    $('#sync-status').textContent=`Aggiornato ${new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(err){$('#sync-status').textContent='Sincronizzazione da riprovare';if(!silent)toast(errorText(err));}
  finally{state.loading=false;$('#refresh').disabled=false;}
}
async function connect(local=false,oauth=false){
  const form=new FormData($('#login-form'));state.repo=String(form.get('repo')).trim();
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(state.repo))return;
  state.local=local;state.oauth=oauth;state.token=local||oauth?'':String(form.get('token')).trim();
  if(!local&&!oauth&&!state.token){$('#login-error').textContent='Inserisci il tuo token GitHub oppure usa la modalità locale.';return;}
  $('#login-form button').disabled=true;$('#local-login').disabled=true;$('#login-error').textContent='';
  try{
    state.user=await api('/user');
    await api(`/repos/${state.repo}`);
    $('#login-form [name=token]').value='';
    $('#user-name').textContent=state.user.login;$('#user-avatar').textContent=initials(state.user.login);
    $('#repo-link').href=`https://github.com/${state.repo}`;$('#login').hidden=true;$('#app').hidden=false;
    $('#content').innerHTML='<div class="loading">Caricamento della wiki…</div>';
    await refresh();clearInterval(state.poll);state.poll=setInterval(()=>{if(!document.hidden)refresh(true);},30000);
  }catch(err){state.user=null;state.token='';$('#login-error').textContent=errorText(err);}
  finally{$('#login-form button').disabled=false;$('#local-login').disabled=false;}
}
function navigate(view){if(mobileMenu.matches)setMenu(false,true);state.view=view;render();window.scrollTo({top:0,behavior:'instant'});}
function filteredTasks(){const f=state.filter;return sorted(state.tasks.filter(t=>(!f.search||`${t.title} ${t.body} ${t.assignee}`.toLowerCase().includes(f.search.toLowerCase()))&&(!f.assignee||t.assignee===f.assignee)&&(!f.phase||t.phase===f.phase)&&(!f.priority||t.priority===f.priority)&&(!f.category||(t.category||'unclassified')===f.category)&&(!state.hideDone||t.status!=='done')));}
function phaseStats(key){const all=state.tasks.filter(t=>t.phase===key);const done=all.filter(t=>t.status==='done').length;return {total:all.length,done,percent:all.length?Math.round(done/all.length*100):0};}
function taskRow(t){return `<div class="task-row"><button class="check-button ${t.status==='done'?'done':''}" data-toggle="${e(t.path)}" aria-label="${t.status==='done'?'Riapri':'Completa'}: ${e(t.title)}">${t.status==='done'?'✓':''}</button><button class="row-open" data-task="${e(t.path)}" style="--cat:${catColor(t.category)}"><strong>${e(t.title)}</strong><small>${personChip(t)} <span class="cat-dot">${e(categoryLabel(t.category))}</span> · ${e(PHASES[t.phase].name)}</small></button><span class="tag ${t.priority}">${PRIORITIES[t.priority]}</span></div>`;}
function renderOverview(){
  const all=state.tasks,done=all.filter(t=>t.status==='done').length,doing=all.filter(t=>t.status==='doing').length,blocked=all.filter(t=>t.status==='blocked').length;
  const next=sorted(all.filter(t=>t.status!=='done')).slice(0,5);
  return `<div class="stats"><div class="stat"><span class="label">Il percorso finora</span><strong>${all.length?Math.round(done/all.length*100):0}<small> %</small></strong><small>${done} di ${all.length} attività completate</small></div><div class="stat"><span class="label">Da portare avanti</span><strong>${all.length-done}</strong><small>Un passo dopo l’altro</small></div><div class="stat"><span class="label">In corso</span><strong>${doing}</strong><small>Il lavoro di questi giorni</small></div><div class="stat"><span class="label">Da sbloccare</span><strong>${blocked}</strong><small>Qui serve una mano</small></div></div><div class="overview-grid"><section class="panel"><div class="panel-head"><h2>Da dove cominciamo</h2><button class="text-button" data-nav="board">Tutte le attività ↗</button></div>${next.length?next.map(taskRow).join(''):'<div class="empty">Tutto completato. Pronti per il prossimo passo?</div>'}</section><section class="panel"><div class="panel-head"><h2>Le fasi del progetto</h2><button class="text-button" data-nav="phases">Esplora ↗</button></div>${Object.entries(PHASES).map(([k,p],i)=>{const s=phaseStats(k);return `<div class="phase-mini"><div class="row"><span>${i+1}. ${e(p.name)}</span><small>${s.done}/${s.total}</small></div><div class="bar"><span style="width:${s.percent}%"></span></div></div>`;}).join('')}</section></div><div class="note-strip"><span>◎</span><p><strong>Un piano condiviso, da confermare insieme.</strong> Ruoli e date importati dall’agenda sono proposte. Completare una scheda registra il lavoro, non approva spese o decisioni del gruppo.</p></div><div class="section-title"><h2>Ognuno porta qualcosa.</h2><span class="tag proposal">Assegnazioni da confermare</span></div><div class="team-grid">${[...new Set(all.map(t=>t.assignee).filter(Boolean))].filter(x=>x!=='Tutti').map(name=>`<div class="team-card"><span class="avatar">${e(initials(name))}</span><div><strong>${e(name)}</strong><small>${all.filter(t=>t.assignee===name&&t.status!=='done').length} attività aperte</small></div></div>`).join('')}</div>`;
}
function options(values,selected,empty){return (empty?`<option value="">${empty}</option>`:'')+Object.entries(values).map(([k,v])=>`<option value="${e(k)}" ${k===selected?'selected':''}>${e(v)}</option>`).join('');}
function categoryOptions(){return {...CATEGORIES,...Object.fromEntries(state.tasks.filter(t=>t.category&&!Object.hasOwn(CATEGORIES,t.category)).map(t=>[t.category,categoryLabel(t.category)])),unclassified:'Da classificare'};}
function taskCard(t){return `<article class="task-card" style="--cat:${catColor(t.category)}"><div class="card-top"><span class="tag ${t.priority}">${PRIORITIES[t.priority]}</span><button class="check-button ${t.status==='done'?'done':''}" data-toggle="${e(t.path)}" aria-label="${t.status==='done'?'Riapri':'Completa'}: ${e(t.title)}">${t.status==='done'?'✓':''}</button></div><button class="card-open" data-task="${e(t.path)}">${e(t.title)}</button><button class="category-tag" data-category-task="${e(t.path)}" aria-label="Cambia area: ${e(t.title)}">${e(categoryLabel(t.category))} <span aria-hidden="true">↗</span></button><div class="meta"><span>${e(PHASES[t.phase].name)}</span></div><button class="owner-trigger" data-assign="${e(t.path)}" aria-label="Cambia assegnatario: ${e(t.title)}">${personChip(t)}<span>Cambia ↗</span></button><p class="help">${t.due?' · '+e(t.due):''}</p><select data-status-task="${e(t.path)}" aria-label="Stato di ${e(t.title)}">${options(STATUSES,t.status)}</select></article>`;}
function renderBoard(){
 const f=state.filter,tasks=filteredTasks(),owners=Object.fromEntries([...new Set(state.tasks.map(t=>t.assignee).filter(Boolean))].map(x=>[x,x]));
 const groups=state.groupBy==='category'?Object.entries(categoryOptions()).filter(([key])=>state.tasks.some(t=>(t.category||'unclassified')===key)):Object.entries(STATUSES);
 return `<div class="board-view"><label>Raggruppa per <select id="group-tasks"><option value="category" ${state.groupBy==='category'?'selected':''}>Area di lavoro</option><option value="status" ${state.groupBy==='status'?'selected':''}>Stato di avanzamento</option></select></label><label class="hide-done"><input type="checkbox" id="hide-done" ${state.hideDone?'checked':''}> Nascondi completate</label><span>${tasks.length} attività visualizzate${state.hideDone?` · ${state.tasks.filter(t=>t.status==='done').length} completate nascoste`:''}</span></div><div class="filters"><input id="task-search" type="search" placeholder="Cerca un’attività…" aria-label="Cerca attività" value="${e(f.search)}"><select id="filter-category" aria-label="Filtra per area">${options(categoryOptions(),f.category,'Tutte le aree')}</select><select id="filter-assignee" aria-label="Filtra per responsabile">${options(owners,f.assignee,'Tutte le persone')}</select><select id="filter-phase" aria-label="Filtra per fase">${options(Object.fromEntries(Object.entries(PHASES).map(([k,v])=>[k,v.name])),f.phase,'Tutte le fasi')}</select><select id="filter-priority" aria-label="Filtra per priorità">${options(PRIORITIES,f.priority,'Tutte le priorità')}</select></div><div class="board ${state.groupBy==='category'?'board-areas':''}">${groups.map(([key,label])=>{const items=tasks.filter(t=>state.groupBy==='category'?(t.category||'unclassified')===key:t.status===key);if(state.groupBy==='category'&&!items.length)return '';return '<section class="column" '+(state.groupBy==='category'?'data-area="'+e(key)+'" style="--cat:'+catColor(key)+'"':'data-status="'+e(key)+'"')+'><div class="column-head"><span>'+e(label)+'</span><b>'+items.length+'</b></div>'+ (items.map(taskCard).join('')||'<div class="empty">Nessuna attività qui.</div>')+'</section>';}).join('')||'<div class="empty">Nessuna attività corrisponde ai filtri.</div>'}</div>`;
}
function renderPhases(){return `<div class="note-strip" style="margin-top:0;margin-bottom:22px"><p>Calendario proposto nell’agenda. Le fasi successive dipendono da copertura finanziaria e tutele, non da una data già fissata.</p></div><div class="phases-list">${Object.entries(PHASES).map(([key,p],i)=>{const s=phaseStats(key);return `<article class="phase-card"><span class="phase-number">0${i+1}</span><div><span class="eyebrow">${e(p.period)}</span><h2>${e(p.name)}</h2><p>${e(p.description)}</p><button class="text-button" data-phase="${key}">Vedi le attività ↗</button></div><div><small>${s.done} di ${s.total} completate · ${s.percent}%</small><div class="bar"><span style="width:${s.percent}%"></span></div></div></article>`;}).join('')}</div>`;}
function renderWiki(){
  const pages=state.files.filter(f=>!f.path.startsWith('attivita/')&&!f.path.startsWith('.')).sort((a,b)=>a.path.localeCompare(b.path));
  return `<div class="wiki-layout"><aside class="wiki-list"><input type="search" id="wiki-search" placeholder="Cerca una pagina…" aria-label="Cerca pagine" value="${e(state.wikiQuery)}">${pages.filter(f=>f.path.toLowerCase().includes(state.wikiQuery.toLowerCase())).map(f=>`<button data-doc="${e(f.path)}" class="${f.path===state.wikiPath?'active':''}">${e(f.path.split('/').pop().replace('.md','').replaceAll('-',' '))}<small>${e(f.path)}</small></button>`).join('')}</aside><article id="wiki-article" class="wiki-article"><div class="loading">Apertura pagina…</div></article></div>`;
}
function meetingFiles(){return state.files.filter(f=>/^riunioni\/[^/]+\.md$/.test(f.path)&&!/\/README\.md$/i.test(f.path)).sort((a,b)=>b.path.localeCompare(a.path));}
function renderMeetings(){
  const files=meetingFiles();if(!state.meetingPath||!files.some(f=>f.path===state.meetingPath))state.meetingPath=files[0]?.path||'';
  return `<section class="panel calendar-panel"><div class="panel-head"><h2>Prossime chiamate</h2><button class="text-button" id="edit-calendar">Modifica calendario ↗</button></div><div id="calendar-list"><div class="loading">Leggo il calendario…</div></div></section><div class="section-title"><h2>Riassunti delle chiamate</h2></div><div class="wiki-layout"><aside class="wiki-list">${files.length?files.map(f=>`<button data-meeting="${e(f.path)}" class="${f.path===state.meetingPath?'active':''}">${e(meetingLabel(f.path))}<small>${e(f.path)}</small></button>`).join(''):'<div class="empty">Nessun riassunto ancora.</div>'}</aside><article id="meeting-article" class="wiki-article">${files.length?'<div class="loading">Apertura riassunto…</div>':'<div class="empty">I riassunti si aggiungono nella cartella riunioni/ della wiki.</div>'}</article></div>`;
}
const MONTHS=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const WEEKDAYS=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
function longDate(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');if(!m)return iso||'';const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return `${WEEKDAYS[d.getUTCDay()]} ${+m[3]} ${MONTHS[+m[2]-1]} ${m[1]}`;}
function meetingLabel(path){const name=path.split('/').pop().replace('.md','');const m=/^(\d{4}-\d{2}-\d{2})-?(.*)$/.exec(name);return m?`${longDate(m[1])}${m[2]?' · '+m[2].replaceAll('-',' '):''}`:name.replaceAll('-',' ');}
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'?u.href:'';}catch{return '';}}
function docFiles(){return state.files.filter(f=>/^docs\/[^/]+\.md$/.test(f.path)).sort((a,b)=>a.path==='docs/index.md'?-1:b.path==='docs/index.md'?1:a.path.localeCompare(b.path));}
function docLabel(path){const n=path.split('/').pop().replace('.md','');return n==='index'?'Indice del dossier':(n.charAt(0).toUpperCase()+n.slice(1)).replace(/-\d{4}-\d{2}$/,'').replaceAll('-',' ');}
function renderDocs(){
  const files=docFiles();if(!state.docPath||!files.some(f=>f.path===state.docPath))state.docPath=files.find(f=>f.path!=='docs/index.md')?.path||files[0]?.path||'';
  return renderAttachments()+`<div class="section-title"><h2>Ricerche e dossier</h2></div><div class="wiki-layout"><aside class="wiki-list">${files.length?files.map(f=>`<button data-docpage="${e(f.path)}" class="${f.path===state.docPath?'active':''}">${e(docLabel(f.path))}<small>${e(f.path)}</small></button>`).join(''):'<div class="empty">Nessun documento nella cartella docs/.</div>'}</aside><article id="docs-article" class="wiki-article"><div class="loading">Apertura documento…</div></article></div>`;
}
let docsRequest=0;
async function loadDocs(){
  const request=++docsRequest;
  try{if(!state.docPath)return;const file=await readFile(state.docPath);if(request!==docsRequest||state.view!=='docs')return;const p=parseMarkdown(file.raw);$('#docs-article').innerHTML=`<div class="article-toolbar"><small>${e(file.path)}${p.meta.updated?' · aggiornato '+e(p.meta.updated):''}</small><button class="secondary" id="edit-docpage">Modifica</button></div><div class="markdown">${markdownHTML(p.body,file.path,state.repo)}</div>`;$('#edit-docpage').onclick=()=>openDoc(file);}
  catch(err){const box=$('#docs-article');if(box)box.innerHTML=`<div class="empty">${e(errorText(err))}</div>`;}
}
let meetingRequest=0;
async function loadMeetings(){
  const request=++meetingRequest;
  try{
    const index=state.files.some(f=>f.path==='riunioni/README.md')?await readFile('riunioni/README.md'):null;
    if(request!==meetingRequest||state.view!=='meetings')return;
    const raw=index?parseMarkdown(index.raw).meta.calendar:[];
    const items=(Array.isArray(raw)?raw:[]).filter(c=>c&&typeof c.date==='string'&&c.date>=today()).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
    $('#calendar-list').innerHTML=items.length?items.map(c=>{const link=safeLink(c.link);return `<div class="calendar-row"><div class="calendar-date"><strong>${e(longDate(c.date))}</strong><small>${e(c.time?'ore '+c.time:'orario da fissare')}</small></div><div class="calendar-body"><strong>${e(c.title||'Riunione')}</strong>${c.note?`<small>${e(c.note)}</small>`:''}</div>${link?`<a class="primary" href="${e(link)}" target="_blank" rel="noopener">Entra nella chiamata</a>`:'<span class="tag proposal">Link da aggiungere</span>'}</div>`;}).join(''):'<div class="empty">Nessuna chiamata in calendario. Aggiungila con «Modifica calendario».</div>';
    $('#edit-calendar').onclick=async()=>{try{if(!index){toast('Manca riunioni/README.md nella wiki.');return;}openDoc(await readFile('riunioni/README.md',true));}catch(err){toast(errorText(err));}};
    if(state.meetingPath){const file=await readFile(state.meetingPath);if(request!==meetingRequest||state.view!=='meetings')return;const p=parseMarkdown(file.raw);$('#meeting-article').innerHTML=`<div class="article-toolbar"><small>${e(file.path)}</small><button class="secondary" id="edit-meeting">Modifica riassunto</button></div><div class="markdown">${markdownHTML(p.body,file.path,state.repo)}</div>`;$('#edit-meeting').onclick=()=>openDoc(file);}
  }catch(err){const box=$('#meeting-article')||$('#calendar-list');if(box)box.innerHTML=`<div class="empty">${e(errorText(err))}</div>`;}
}
let wikiRequest=0;
async function loadWiki(){const request=++wikiRequest;try{const file=await readFile(state.wikiPath);if(request!==wikiRequest||state.view!=='wiki')return;const p=parseMarkdown(file.raw);$('#wiki-article').innerHTML=`<div class="article-toolbar"><small>${e(file.path)}</small><button class="secondary" id="edit-doc">Modifica pagina</button></div><div class="markdown">${markdownHTML(p.body,file.path,state.repo)}</div>`;$('#edit-doc').onclick=()=>openDoc(file);}catch(err){if($('#wiki-article'))$('#wiki-article').innerHTML=`<div class="empty">${e(errorText(err))}</div>`;}}
function render(){
  if(!state.user)return;
  disposeGraph?.();disposeGraph=null;clearInterval(state.chatPoll);state.chatPoll=null;
  const titles={chat:['PARLIAMONE QUI','La chat del team.','Messaggi e file condivisi. Tutto resta nella wiki, nella cartella chat/.'],map:['I TERRITORI','Dove portare Held.','Indice esplorativo e sostegno ai genitori per i 7.896 comuni italiani, con i partner potenziali di Foligno. Rotella o pizzico per avvicinarti, clic su un comune per centrarlo.'],graph:['LA MAPPA DEL PROGETTO','Le idee, collegate.','Esplora pagine, attività e relazioni nella wiki condivisa.'],overview:['IL NOSTRO PROGETTO','Facciamo spazio alle idee.','La direzione è comune. Il prossimo passo è concreto.'],board:['DAL PIANO ALL’AZIONE','Il lavoro, un passo alla volta.','Priorità chiare, responsabilità condivise e nessun pezzo perso.'],phases:['LA STRADA DAVANTI','Una direzione, cinque fasi.','Dall’ascolto al primo pilota. Con il tempo necessario per farlo bene.'],docs:['RICERCHE E DOSSIER','I nostri documenti.','Studi, dati, casi simili e analisi raccolti per Held.'],meetings:['CI SENTIAMO OGNI SETTIMANA','Le nostre chiamate.','Il calendario con il link per entrare e il riassunto di ogni chiamata.'],wiki:['LA NOSTRA CONOSCENZA','Quello che sappiamo, insieme.','Le stesse pagine che leggete e aggiornate con i vostri assistenti AI.']};
  const [eyebrow,title,description]=titles[state.view];$('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-description').textContent=description;
  $('#breadcrumb').textContent='Held / '+({chat:'Chat',overview:'Panoramica',board:'Attività',phases:'Fasi di lavoro',meetings:'Riunioni',docs:'Documenti',wiki:'Wiki',graph:'Grafo',map:'Mappa'}[state.view]);$('#task-count').textContent=state.tasks.filter(t=>t.status!=='done').length;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('#content').innerHTML=(state.errors?.length?`<div class="warning-banner">${state.errors.map(e).join('<br>')}<br>Correggi i metadati nella wiki. Le altre attività sono disponibili.</div>`:'')+({overview:renderOverview,board:renderBoard,phases:renderPhases,wiki:renderWiki,graph:renderGraph,map:renderMap,meetings:renderMeetings,docs:renderDocs,chat:renderChat}[state.view])();
  if(state.view==='chat'){loadChat();bindChat();state.chatPoll=setInterval(()=>{if(!document.hidden)loadChat(true);},8000);}
  if(state.view==='docs')bindAttachments();
  if(state.view==='meetings')loadMeetings();
  if(state.view==='docs')loadDocs();
  if(state.view==='wiki')loadWiki();
  if(state.view==='graph')loadGraph();
  if(state.view==='map')loadMap();
  if(state.view==='phases'){
    const button=document.createElement('button');button.className='secondary';button.style.marginTop='18px';button.textContent='Modifica nomi e calendario delle fasi';button.onclick=async()=>{try{openDoc(await readFile('attivita/README.md',true));}catch(err){toast(errorText(err));}};$('#content').append(button);
  }
  $('#task-search')?.addEventListener('input',event=>{const pos=event.target.selectionStart;state.filter.search=event.target.value;render();$('#task-search').focus();$('#task-search').setSelectionRange(pos,pos);});
  for(const key of ['assignee','phase','priority','category'])$('#filter-'+key)?.addEventListener('change',event=>{state.filter[key]=event.target.value;render();});
  $('#hide-done')?.addEventListener('change',event=>{state.hideDone=event.target.checked;try{localStorage.setItem('held.hideDone',state.hideDone?'1':'0');}catch{}render();});
  $('#group-tasks')?.addEventListener('change',event=>{state.groupBy=event.target.value;render();});
  $('#wiki-search')?.addEventListener('input',event=>{const pos=event.target.selectionStart;state.wikiQuery=event.target.value;render();$('#wiki-search').focus();$('#wiki-search').setSelectionRange(pos,pos);});
}
function showDialog(editor,fields){
  state.editor=editor;$('#editor-fields').innerHTML=fields;$('#editor-feedback').textContent='';$('#download-draft').hidden=true;
  $('#editor-title').textContent=editor.kind==='doc'?'Modifica pagina':editor.sha?'Dettaglio attività':'Una nuova attività';
  $('#editor-kicker').textContent=editor.kind==='doc'?'WIKI CONDIVISA':'ATTIVITÀ';$('#source-link').href=fileURL(editor.path,state.repo);$('#source-link').hidden=!editor.sha;$('#delete-task').hidden=!(editor.kind==='task'&&editor.sha);
  $('#editor').showModal();state.editor.initial=editorSnapshot();
  if(editor.kind==='task'){
    const assignee=$('#editor-form [name=assignee]');
    const choices=document.createElement('div');choices.className='owner-options';choices.setAttribute('aria-label','Scelta rapida del responsabile');
    choices.innerHTML=['Franco','Flavio','Othello',''].map(name=>'<button type="button" class="owner-choice" style="--p:'+personColor(name)+'" data-owner="'+e(name)+'">'+e(name||'Da assegnare')+'</button>').join('');
    $('#editor-fields').prepend(choices);
    assignee.addEventListener('input',()=>$('#editor-form [name=assignment]').value='proposed');
  }
}
function editorSnapshot(){return JSON.stringify([...new FormData($('#editor-form')).entries()]);}
function taskFields(t){
  const comments=t.body?.split('\n## Commenti')[1]||'';const body=(t.body||'## Risultato atteso\n\nDescrivi quando questa attività può dirsi conclusa.\n\n## Sottoattività\n\n- [ ] Primo passo\n').split('\n## Commenti')[0];
  return `<div class="form-grid"><label class="span-2">Titolo<input name="title" required maxlength="240" value="${e(t.title||'')}"></label><label>Responsabile<input name="assignee" list="owners" value="${e(t.assignee||'')}" placeholder="Da assegnare"><datalist id="owners"><option>Franco</option><option>Flavio</option><option>Othello</option><option>Tutti</option></datalist></label><label>Assegnazione<select name="assignment">${options({proposed:'Proposta, da confermare',confirmed:'Confermata'},t.assignment||'proposed')}</select></label><label>Stato<select name="status">${options(STATUSES,t.status||'todo')}</select></label><label>Priorità<select name="priority">${options(PRIORITIES,t.priority||'medium')}</select></label><label>Area di lavoro<select name="category">${options({...CATEGORIES,...(t.category&&!Object.hasOwn(CATEGORIES,t.category)?{[t.category]:categoryLabel(t.category)}:{})},t.category??(t.raw?'':state.filter.category==='unclassified'?'':state.filter.category),'Da classificare')}</select></label><label>Fase<select name="phase">${options(Object.fromEntries(Object.entries(PHASES).map(([k,v])=>[k,v.name])),t.phase||state.filter.phase||'avvio')}</select></label><label>Scadenza <input type="date" name="due" value="${e(t.due||'')}"></label><label>Data proposta o concordata<select name="schedule">${options({proposed:'Proposta',confirmed:'Concordata'},t.schedule||'proposed')}</select></label><label class="span-2">Descrizione e sottoattività (Markdown)<textarea name="body" rows="8">${e(body)}</textarea></label></div><p class="help">Per una sottoattività scrivi <code>- [ ] Cosa fare</code>. Spunta qui sotto e salva.</p><div id="checklist"></div>${comments?`<section class="comments-view"><h3>Commenti precedenti</h3><div class="markdown">${markdownHTML(comments,t.path,state.repo)}</div></section>`:''}<label>Aggiungi un commento<textarea name="comment" rows="3" placeholder="Un aggiornamento, un dubbio, il prossimo passo…" style="min-height:85px"></textarea></label><p class="help">Il salvataggio aggiorna direttamente il file nella wiki e crea un commit a tuo nome. Il segno di spunta non sostituisce la conferma delle decisioni del gruppo.</p>`;
}
function renderChecklist(){const box=$('#checklist'),body=$('#editor-form [name=body]')?.value;if(!box||body===undefined)return;const rows=checklist(body);box.innerHTML=rows.length?`<div class="checklist-edit">${rows.map(r=>`<label><input type="checkbox" data-check="${r.index}" ${r.checked?'checked':''}>${e(r.label)}</label>`).join('')}</div>`:'';}
function openTask(path){const t=state.tasks.find(t=>t.path===path);if(!t)return;showDialog({...t,kind:'task'},taskFields(t));renderChecklist();$('#editor-form [name=body]').addEventListener('input',renderChecklist);}
function newTask(){const id='H-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,6);const t={path:`attivita/${id.toLowerCase()}.md`,id,raw:'',kind:'task'};showDialog(t,taskFields(t));renderChecklist();$('#editor-form [name=body]').addEventListener('input',renderChecklist);}
function openDoc(file){showDialog({...file,kind:'doc'},`<p class="help">Stai modificando <strong>${e(file.path)}</strong>. Mantieni il frontmatter, aggiorna le fonti e la data quando cambia il contenuto.</p><label>Contenuto Markdown<textarea name="raw" rows="22" spellcheck="false">${e(file.raw)}</textarea></label>`);}
function buildDraft(){
  const ed=state.editor,f=Object.fromEntries(new FormData($('#editor-form')));
  if(ed.kind==='doc')return f.raw;
  let body=f.body;
  if(ed.body?.includes('\n## Commenti'))body=body.trimEnd()+'\n## Commenti'+ed.body.split('\n## Commenti').slice(1).join('\n## Commenti');
  body=addComment(body,state.user.login,f.comment);
  return serializeMarkdown(ed.raw,{id:ed.id||ed.path.split('/').pop().replace('.md',''),title:f.title.trim(),type:'overview',updated:today(),status:f.status,priority:f.priority,phase:f.phase,category:f.category,assignee:f.assignee.trim(),assignment:f.assignment,due:f.due,schedule:f.schedule,...(!ed.sha?{sources:[]}:{}),updated_by:state.user.login},body);
}
async function saveEditor(event){event.preventDefault();if(state.saving)return;state.saving=true;$('#save-editor').disabled=true;$('#save-editor').textContent='Salvataggio…';$('#editor-feedback').textContent='';
  try{const ed=state.editor;const raw=buildDraft();if(ed.kind==='task')toTask({path:ed.path,raw});await writeFile(ed.path,raw,ed.sha,`Held: ${ed.kind==='doc'?'aggiorna pagina':'aggiorna attività'} ${ed.path}`);let notice='Salvato nella wiki. Il team vedrà la modifica da GitHub.';
    if(ed.kind==='task'&&!ed.sha){try{await linkNewTask(ed.path,parseMarkdown(raw).meta.title);}catch{notice='Attività salvata. Collegamento nell’indice non aggiornato: aggiungilo in attivita/README.md.';}}
    $('#editor').close();state.editor=null;toast(notice);}
  catch(err){$('#editor-feedback').textContent=errorText(err);$('#download-draft').hidden=false;}
  finally{state.saving=false;$('#save-editor').disabled=false;$('#save-editor').textContent='Salva nella wiki';await refresh(true);}
}
async function updateStatus(path,status){if(state.saving)return;const t=state.tasks.find(t=>t.path===path);if(!t)return;state.saving=true;
  try{await writeFile(path,serializeMarkdown(t.raw,{status,updated:today(),updated_by:state.user.login},t.body),t.sha,`Held: ${STATUSES[status].toLowerCase()} · ${t.title}`);toast('Stato aggiornato nella wiki.');}catch(err){toast(errorText(err));}
  finally{state.saving=false;await refresh();}
}
function closeEditor(){if(state.saving)return;if(editorSnapshot()!==state.editor?.initial&&!confirm('Ci sono modifiche non salvate. Vuoi chiudere e scartarle?'))return;$('#editor').close();state.editor=null;}
$('#login-form').onsubmit=event=>{event.preventDefault();connect(false);};$('#local-login').onclick=()=>connect(true);
$('#refresh').onclick=()=>refresh();$('#new-task').onclick=newTask;$('#delete-task').onclick=deleteTask;$('#close-editor').onclick=closeEditor;$('#editor-form').onsubmit=saveEditor;
$('#editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('#logout').onclick=async()=>{clearInterval(state.chatPoll);state.chatPoll=null;if(state.oauth){try{const response=await fetch('/auth/logout',{method:'POST',headers:{'X-Held-CSRF':state.csrf}});if(!response.ok&&response.status!==401)throw new Error();}catch{toast('Uscita non confermata: controlla la connessione e riprova.');return;}}disposeGraph?.();disposeGraph=null;setMenu(false);state.oauth=false;state.csrf='';clearInterval(state.poll);state.session++;state.token='';state.user=null;state.cache.clear();state.tasks=[];state.files=[];state.lastHead='';$('#content').innerHTML='';$('#app').hidden=true;$('#login').hidden=false;};
const mobileLogout=document.createElement('button');mobileLogout.className='icon-button mobile-logout';mobileLogout.textContent='↪';mobileLogout.setAttribute('aria-label','Esci dall’account');mobileLogout.onclick=()=>$('#logout').click();$('.topbar-actions').append(mobileLogout);
$('#download-draft').onclick=()=>{const blob=new Blob([buildDraft()],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=state.editor.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.view)navigate(target.dataset.view);if(target.dataset.nav)navigate(target.dataset.nav);
  if(target.dataset.task)openTask(target.dataset.task);
  if(target.dataset.categoryTask){openTask(target.dataset.categoryTask);$('#editor-form [name=category]').focus();}
  if(target.dataset.assign){openTask(target.dataset.assign);const input=$('#editor-form [name=assignee]');input.focus();input.select();}
  if(Object.hasOwn(target.dataset,'owner')){const input=$('#editor-form [name=assignee]');input.value=target.dataset.owner;$('#editor-form [name=assignment]').value='proposed';input.focus();}
  if(target.dataset.toggle){const t=state.tasks.find(t=>t.path===target.dataset.toggle);updateStatus(t.path,t.status==='done'?'todo':'done');}
  if(target.dataset.phase){state.filter.phase=target.dataset.phase;navigate('board');}
  if(target.dataset.doc){state.wikiPath=target.dataset.doc;render();}
  if(target.dataset.docpage){state.docPath=target.dataset.docpage;render();}
  if(target.dataset.meeting){state.meetingPath=target.dataset.meeting;render();}
  if(target.dataset.download)downloadAttachment(target.dataset.download);
  if(target.dataset.removeAttachment)removeAttachment(target.dataset.removeAttachment);
});
document.addEventListener('change',event=>{if(event.target.dataset.statusTask)updateStatus(event.target.dataset.statusTask,event.target.value);if(event.target.dataset.check){const input=$('#editor-form [name=body]');input.value=toggleCheck(input.value,Number(event.target.dataset.check),event.target.checked);}});
window.addEventListener('beforeunload',event=>{if(state.editor&&editorSnapshot()!==state.editor.initial){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
if(['localhost','127.0.0.1'].includes(location.hostname))fetch('/api/config').then(r=>r.json()).then(config=>{if(config.local){state.nonce=config.nonce;$('#local-login').hidden=false;$('#login-form [name=repo]').value=config.repo;connect(true);}}).catch(()=>{});

let graphRequest=0;
// Mappa dei comuni: i dati stanno nella wiki privata, in dati/<cartella>/dati.json e comuni.topo.json.
const blobCache=new Map();let mapRequest=0;
async function readJSONBlob(file){if(blobCache.has(file.sha))return blobCache.get(file.sha);
  const blob=await api(`/repos/${state.repo}/git/blobs/${file.sha}`);if(blob.encoding!=='base64')throw new Error('Formato inatteso per '+file.path);
  const value=JSON.parse(decode64(blob.content));if(blobCache.size>=4)blobCache.delete(blobCache.keys().next().value);blobCache.set(file.sha,value);return value;}
function renderMap(){return '<div id="map-container"><div class="loading">Carico confini e dati dei comuni dalla wiki…</div></div>';}
async function loadMap(){
  const request=++mapRequest,session=state.session;const host=()=>$('#map-container');
  const sets=[...new Set((state.dataFiles||[]).filter(f=>f.path.endsWith('/dati.json')).map(f=>f.path.split('/')[1]))].sort();
  const folder=sets.pop();const dataFile=state.dataFiles?.find(f=>f.path===`dati/${folder}/dati.json`),topoFile=state.dataFiles?.find(f=>f.path===`dati/${folder}/comuni.topo.json`);
  if(!dataFile||!topoFile){host().innerHTML='<div class="empty">Nella wiki mancano i dati della mappa: servono dati/&lt;cartella&gt;/dati.json e comuni.topo.json.</div>';return;}
  try{
    const partnerFile=state.dataFiles?.filter(f=>/^dati\/partner[^/]*\/partner\.json$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path)).pop();
    const [topo,data,partners]=await Promise.all([readJSONBlob(topoFile),readJSONBlob(dataFile),partnerFile?readJSONBlob(partnerFile).catch(()=>null):null,loadMapLibraries()]);
    if(state.view!=='map'||request!==mapRequest||session!==state.session||!host())return;
    const method=state.files.find(f=>/^docs\/mappa-indice-comuni[^/]*\.md$/.test(f.path));
    mountMap(host(),topo,data,{partners,onMethod:method?()=>{state.wikiPath=method.path;navigate('wiki');}:null});
  }catch(err){if(host())host().innerHTML=`<div class="empty">Mappa non disponibile: ${e(errorText(err))} Premi aggiorna per riprovare.</div>`;}
}
function renderGraph(){return '<div id="graph-container"><div class="loading">Collego le pagine della wiki…</div></div>';}
async function loadGraph(){
  const request=++graphRequest,session=state.session;const pages=state.files.filter(f=>!f.path.startsWith('.'));const files=[],errors=[];
  for(let i=0;i<pages.length;i+=6){
    if(state.view!=='graph'||request!==graphRequest||session!==state.session)return;
    const results=await Promise.allSettled(pages.slice(i,i+6).map(f=>readFile(f.path)));
    results.forEach((r,j)=>r.status==='fulfilled'?files.push(r.value):errors.push(pages[i+j].path));
    const loading=$('#graph-container .loading');if(loading)loading.textContent='Collego le pagine… '+Math.min(i+6,pages.length)+'/'+pages.length;
  }
  if(state.view!=='graph'||request!==graphRequest||session!==state.session)return;
  const host=$('#graph-container');disposeGraph=mountGraph(host,buildGraph(files),{onOpen:node=>{if(node.task)openTask(node.id);else{state.wikiPath=node.id;navigate('wiki');}}});
  if(errors.length){const warning=document.createElement('p');warning.className='graph-error';warning.textContent='Grafo parziale: impossibile leggere '+errors.join(', ')+'. Premi aggiorna per riprovare.';host.prepend(warning);}
}

async function initGitHubLogin(){
  const button=$('#github-login'),status=$('#oauth-status');
  try{
    const response=await fetch('./auth-config.json',{cache:'no-store'});if(!response.ok)return;const config=await response.json();
    if(config.github_login_url){const target=new URL(config.github_login_url);if(target.protocol!=='https:'||target.username||target.password)throw new Error();button.hidden=false;button.onclick=()=>location.assign(target.href);$('#login-form').hidden=true;$('.access-help').hidden=true;status.textContent='Entra con il tuo account GitHub. Non serve un token personale.';}
    if(!config.managed_auth)return;
    const sessionResponse=await fetch('/auth/session',{cache:'no-store'});const session=await sessionResponse.json();
    if(!sessionResponse.ok){status.textContent=session.message||'Login GitHub in configurazione.';return;}
    button.hidden=false;button.onclick=()=>location.assign('/auth/start');$('#login-form').hidden=true;$('.access-help').hidden=true;
    $('#login-form [name=repo]').value=session.repo;
    const error=new URL(location.href).searchParams.get('auth_error');
    if(error){status.textContent=error==='access'?'Il tuo account o l’app non hanno accesso in scrittura alla wiki. Chiedi al proprietario di verificare l’invito e l’installazione.':'Accesso non completato. Premi Accedi con GitHub per riprovare.';history.replaceState(null,'',location.pathname);}
    if(session.authenticated){state.csrf=session.csrf;await connect(false,true);if(!state.user)status.textContent=$('#login-error').textContent;}
    else if(!error)status.textContent='Accedi con il tuo account GitHub. La sessione resta attiva su questo dispositivo fino a 8 ore.';
  }catch{status.textContent='Accesso GitHub temporaneamente non disponibile.';}
}
initGitHubLogin();

// File condivisi e chat del team (richiesta del 23/11/2026).
// I file stanno in allegati/ della wiki, i messaggi in chat/AAAA-MM.md, un blocco per messaggio.
const ATTACH_EXT=['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','csv','txt','png','jpg','jpeg','webp','gif'];
const ATTACH_MAX=10*1024*1024;
const ATTACH_MIME={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',txt:'text/plain',csv:'text/csv'};
let uploading=false,sendingChat=false;
async function loadPeople(){const f=state.files.find(x=>x.path==='chat/README.md');if(!f){state.people={};return;}
  try{const p=parseMarkdown((await readFile(f.path)).raw).meta.people;state.people=p&&typeof p==='object'&&!Array.isArray(p)?p:{};}catch{state.people=state.people||{};}}
function personName(login){if(state.people?.[login])return state.people[login];if(login===state.user?.login&&state.user?.name)return state.user.name;return login||'?';}
function fileSize(n){return n>=1048576?(n/1048576).toLocaleString('it-IT',{maximumFractionDigits:1})+' MB':Math.max(1,Math.round(n/1024))+' kB';}
function fileIcon(path){return `<span class="file-ext">${e(path.split('.').pop().toUpperCase().slice(0,4))}</span>`;}
function attachmentLabel(path){const n=path.split('/').pop();const m=/^(\d{4}-\d{2}-\d{2})-(.+)\.([a-z0-9]+)$/.exec(n);return m?{date:m[1],name:m[2].replaceAll('-',' ')+'.'+m[3]}:{date:'',name:n};}
function slugFile(name){const dot=name.lastIndexOf('.');const ext=dot>0?name.slice(dot+1).toLowerCase():'';const base=(dot>0?name.slice(0,dot):name).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'file';return {base,ext};}
function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(new Error('File non leggibile.'));r.readAsDataURL(file);});}
async function uploadAttachment(file){
  const {base,ext}=slugFile(file.name);
  if(!ATTACH_EXT.includes(ext))throw new Error(`il formato .${ext||'?'} non è ammesso. Formati possibili: ${ATTACH_EXT.join(', ')}.`);
  if(!file.size)throw new Error('il file è vuoto.');
  if(file.size>ATTACH_MAX)throw new Error('il file supera 10 MB. Caricalo su Drive e incolla il link in chat.');
  const content=await fileToBase64(file);
  let path=`allegati/${today()}-${base}.${ext}`;for(let n=2;(state.attachments||[]).some(f=>f.path===path);n++)path=`allegati/${today()}-${base}-${n}.${ext}`;
  const result=await api(contentPath(path),'PUT',{message:`Carica ${path.split('/').pop()} (${personName(state.user.login)})`,content,branch:'main'});
  state.attachments=[...(state.attachments||[]),{path,sha:result.content.sha,size:file.size,type:'blob'}];
  return path;
}
async function uploadMany(list){
  const files=[...list];if(!files.length||uploading)return;uploading=true;let ok=0;const problems=[];
  try{for(const f of files){toast(`Carico ${f.name}…`);try{await uploadAttachment(f);ok++;}catch(err){problems.push(`${f.name}: ${err.status?errorText(err):err.message}`);if(err.status)break;}}}
  finally{uploading=false;}
  if(ok&&state.view==='docs')render();
  toast([ok?(ok===1?'1 file caricato nella wiki.':`${ok} file caricati nella wiki.`):'',...problems].filter(Boolean).join(' '));
}
async function downloadAttachment(path){
  const f=(state.attachments||[]).find(x=>x.path===path);if(!f){toast('File non trovato: forse è stato cancellato. Premi aggiorna.');return;}
  try{
    const blob=await api(`/repos/${state.repo}/git/blobs/${f.sha}`);const bin=atob(String(blob.content||'').replace(/\s/g,''));const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:ATTACH_MIME[path.split('.').pop()]||'application/octet-stream'}));
    const a=document.createElement('a');a.href=url;a.download=path.split('/').pop();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(err){toast(errorText(err));}
}
async function removeAttachment(path){
  const f=(state.attachments||[]).find(x=>x.path===path);if(!f)return;
  if(!confirm(`Cancellare ${attachmentLabel(path).name} dalla wiki? I messaggi in chat che lo citano non potranno più scaricarlo.`))return;
  try{await api(contentPath(path),'DELETE',{message:`Cancella ${path.split('/').pop()} (${personName(state.user.login)})`,sha:f.sha,branch:'main'});state.attachments=state.attachments.filter(x=>x.path!==path);render();toast('File cancellato.');}
  catch(err){toast(errorText(err));}
}
function renderAttachments(){
  const files=[...(state.attachments||[])].sort((a,b)=>b.path.localeCompare(a.path));
  return `<section class="panel attach-panel" id="attach-drop"><div class="panel-head"><div><h2>File condivisi</h2><p class="help">PDF, Word, Excel, PowerPoint, immagini e testo, fino a 10 MB. Si salvano nella cartella allegati/ della wiki. Puoi anche trascinarli qui.</p></div><button class="primary attach-button" id="attach-pick" type="button">Carica file</button><input type="file" id="attach-input" multiple hidden accept="${ATTACH_EXT.map(x=>'.'+x).join(',')}"></div><div class="attach-list">${files.length?files.map(f=>{const l=attachmentLabel(f.path);return `<div class="attach-row">${fileIcon(f.path)}<div class="attach-name"><strong>${e(l.name)}</strong><small>${l.date?e(longDate(l.date)):''}${f.size?' · '+fileSize(f.size):''}</small></div><button class="secondary" data-download="${e(f.path)}">Scarica</button><button class="text-button danger-text" data-remove-attachment="${e(f.path)}" aria-label="Cancella ${e(l.name)}">Cancella</button></div>`;}).join(''):'<div class="empty">Nessun file ancora. Il primo che carichi comparirà qui.</div>'}</div></section>`;
}
function bindAttachments(){
  const input=$('#attach-input'),zone=$('#attach-drop');if(!input)return;
  $('#attach-pick').onclick=()=>input.click();input.onchange=()=>{uploadMany(input.files);input.value='';};
  zone.addEventListener('dragover',ev=>{ev.preventDefault();zone.classList.add('dragging');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
  zone.addEventListener('drop',ev=>{ev.preventDefault();zone.classList.remove('dragging');uploadMany(ev.dataTransfer.files);});
}
function chatFiles(){return state.files.filter(f=>/^chat\/\d{4}-\d{2}\.md$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));}
function chatText(text){
  const re=/\[([^\]\n]{1,200})\]\((?:\.\.\/)?(allegati\/[a-z0-9-]+\.[a-z0-9]+)\)|(https:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g;let html='',last=0,m;
  while((m=re.exec(text))){html+=e(text.slice(last,m.index));
    if(m[2])html+=`<button class="chat-file" data-download="${e(m[2])}">${fileIcon(m[2])}<span>${e(m[1])}</span></button>`;
    else{const u=safeLink(m[3]);html+=u?`<a href="${e(u)}" target="_blank" rel="noopener noreferrer">${e(m[3])}</a>`:e(m[3]);}
    last=re.lastIndex;}
  return (html+e(text.slice(last))).replace(/\n/g,'<br>');
}
function renderChat(){
  return `<section class="chat"><div id="chat-log" class="chat-log" aria-live="polite"><div class="loading">Leggo i messaggi…</div></div><form id="chat-form" class="chat-form"><label class="sr-only" for="chat-text">Messaggio</label><textarea id="chat-text" name="text" rows="2" maxlength="4000" placeholder="Scrivi al team…">${e(state.chatDraft||'')}</textarea><div class="chat-actions"><button type="button" class="secondary" id="chat-attach">Allega file</button><input type="file" id="chat-file" hidden accept="${ATTACH_EXT.map(x=>'.'+x).join(',')}"><button class="primary" type="submit" id="chat-send">Invia</button></div></form><p class="help chat-help">Invio per mandare, Maiuscolo+Invio per andare a capo. I messaggi si salvano nella wiki, in chat/, e li leggono anche gli assistenti AI. Non scrivere password o dati personali di altre persone.</p></section>`;
}
function chatSeenKey(){const last=chatFiles().at(-1);return last?`${last.path}@${last.sha}`:'';}
function markChatSeen(){try{localStorage.setItem('held.chatSeen',chatSeenKey());}catch{}updateChatDot();}
function updateChatDot(){const dot=$('#chat-dot');if(!dot)return;let seen='';try{seen=localStorage.getItem('held.chatSeen')||'';}catch{}const key=chatSeenKey();dot.hidden=!key||state.view==='chat'||seen===key;}
let chatRequest=0;
async function loadChat(poll=false){
  const request=++chatRequest,session=state.session;const all=chatFiles();const files=all.slice(-(state.chatMonths||2));
  try{
    const loaded=[];for(const [i,f] of files.entries())loaded.push(await readFile(f.path,poll&&i===files.length-1));
    if(request!==chatRequest||state.view!=='chat'||session!==state.session)return;
    const last=loaded.at(-1);if(last){const t=state.files.find(f=>f.path===last.path);if(t)t.sha=last.sha;}
    const messages=loaded.flatMap(f=>parseChat(f.raw,f.path)).sort((a,b)=>a.at.localeCompare(b.at));
    const key=messages.map(m=>m.id).join(',')+'|'+(state.chatMonths||2);const log=$('#chat-log');if(!log)return;
    markChatSeen();if(poll&&key===state.chatKey)return;state.chatKey=key;
    const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<120;let day='';
    const older=all.length>files.length?'<button class="text-button chat-older" id="chat-older">Mostra i messaggi dei mesi precedenti</button>':'';
    log.innerHTML=older+(messages.length?messages.map(m=>{const d=new Date(m.at);const dd=d.toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});const sep=dd!==day?`<div class="chat-day">${e(longDate(dd))}</div>`:'';day=dd;const mine=m.by===state.user.login;
      return `${sep}<div class="chat-msg${mine?' mine':''}"><div class="chat-meta"><strong>${e(personName(m.by))}</strong><time datetime="${e(m.at)}">${e(d.toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}))}</time></div><div class="chat-text">${chatText(m.text)}</div></div>`;}).join(''):'<div class="empty">Nessun messaggio ancora. Scrivi il primo.</div>');
    $('#chat-older')?.addEventListener('click',()=>{state.chatMonths=(state.chatMonths||2)+3;state.chatKey='';loadChat();});
    if(!poll||atBottom)log.scrollTop=log.scrollHeight;
  }catch(err){const log=$('#chat-log');if(log&&!poll)log.innerHTML=`<div class="empty">${e(errorText(err))}</div>`;}
}
async function sendChat(text){
  const clean=cleanChat(text);if(!clean)return false;
  const now=new Date();const month=now.toLocaleDateString('en-CA',{timeZone:'Europe/Rome'}).slice(0,7);const path=`chat/${month}.md`;
  const name=personName(state.user.login);
  const when=now.toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const block=chatBlock({id:'m-'+now.getTime().toString(36)+'-'+crypto.randomUUID().slice(0,6),at:now.toISOString(),by:state.user.login,name,when,text:clean});
  const label=`${MONTHS[+month.slice(5)-1]} ${month.slice(0,4)}`;
  for(let attempt=0;attempt<4;attempt++){
    let file=null;
    if(attempt>0||state.files.some(f=>f.path===path)){try{file=await readFile(path,true);}catch(err){if(err.status!==404)throw err;}}
    const raw=file?file.raw.replace(/^updated: .*$/m,`updated: ${today()}`).replace(/\s*$/,'\n\n')+block:`---\ntitle: Chat del team, ${label}\ntype: overview\nupdated: ${today()}\nsources: [dashboard]\n---\n\n# Chat del team, ${label}\n\nMessaggi scritti dalla dashboard, dal più vecchio al più recente. Ogni messaggio comincia con una riga di commento con autore e ora.\n\n`+block;
    try{const saved=await writeFile(path,raw,file?.sha,`Chat: messaggio di ${name}`);const t=state.files.find(f=>f.path===path);if(t)t.sha=saved.sha;else state.files.push({path,sha:saved.sha,type:'blob'});return true;}
    catch(err){if(![409,422].includes(err.status)||attempt===3)throw err;}
  }
  return false;
}
async function submitChat(extra=''){
  if(sendingChat)return;const box=$('#chat-text');const text=[box?.value||'',extra].filter(Boolean).join('\n\n');if(!cleanChat(text))return;
  sendingChat=true;const button=$('#chat-send');if(button){button.disabled=true;button.textContent='Invio…';}
  try{if(await sendChat(text)){state.chatDraft='';if(box)box.value='';state.chatKey='';await loadChat();box?.focus();}}
  catch(err){toast('Messaggio non inviato. '+errorText(err));}
  finally{sendingChat=false;if(button){button.disabled=false;button.textContent='Invia';}}
}
function bindChat(){
  const box=$('#chat-text');if(!box)return;
  box.addEventListener('input',()=>{state.chatDraft=box.value;});
  box.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing&&!matchMedia('(pointer:coarse)').matches){ev.preventDefault();submitChat();}});
  $('#chat-form').onsubmit=ev=>{ev.preventDefault();submitChat();};
  const input=$('#chat-file');$('#chat-attach').onclick=()=>input.click();
  input.onchange=async()=>{const f=input.files[0];input.value='';if(!f||uploading)return;uploading=true;toast(`Carico ${f.name}…`);
    try{const path=await uploadAttachment(f);await submitChat(`[${f.name.replace(/[\[\]\n]/g,'')}](../${path})`);$('#toast').hidden=true;}catch(err){toast(`${f.name}: ${err.status?errorText(err):err.message}`);}finally{uploading=false;}};
}
