import {buildGraph,mountGraph} from './graph.js';
import {STATUSES,PRIORITIES,PHASES,escapeHTML as e,parseMarkdown,serializeMarkdown,toTask,checklist,toggleCheck,addComment,encode64,decode64,markdownHTML,fileURL} from './core.js';
const $=s=>document.querySelector(s);
const state={repo:'framik02/held-wiki',token:'',oauth:false,csrf:'',local:false,nonce:'',user:null,tasks:[],files:[],cache:new Map(),view:'overview',filter:{search:'',assignee:'',phase:'',priority:''},loading:false,saving:false,editor:null,wikiPath:'stato.md',wikiQuery:'',lastHead:'',poll:null,session:0};
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'});
const initials=s=>(s||'?').slice(0,2).toUpperCase();
const shortName=t=>t.assignee||'Da assegnare';
const ownerLabel=t=>shortName(t)+(t.assignment==='proposed'&&t.assignee?' · proposto':'');
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
async function refresh(silent=false){
  if(state.loading||state.saving||!state.user)return;
  state.loading=true;const session=state.session;$('#refresh').disabled=true;
  try{
    const tree=await api(`/repos/${state.repo}/git/trees/main?recursive=1`);
    if(session!==state.session)return;
    if(tree.truncated)throw new Error('Indice GitHub incompleto: apri il repository per consultare tutti i file.');
    if(tree.sha!==state.lastHead||!silent){
      state.files=tree.tree.filter(f=>f.type==='blob'&&f.path.endsWith('.md'));
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
      state.tasks=tasks;state.lastHead=tree.sha;state.errors=errors;render();
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
function navigate(view){state.view=view;render();window.scrollTo({top:0,behavior:'instant'});}
function filteredTasks(){const f=state.filter;return sorted(state.tasks.filter(t=>(!f.search||`${t.title} ${t.body} ${t.assignee}`.toLowerCase().includes(f.search.toLowerCase()))&&(!f.assignee||t.assignee===f.assignee)&&(!f.phase||t.phase===f.phase)&&(!f.priority||t.priority===f.priority)));}
function phaseStats(key){const all=state.tasks.filter(t=>t.phase===key);const done=all.filter(t=>t.status==='done').length;return {total:all.length,done,percent:all.length?Math.round(done/all.length*100):0};}
function taskRow(t){return `<div class="task-row"><button class="check-button ${t.status==='done'?'done':''}" data-toggle="${e(t.path)}" aria-label="${t.status==='done'?'Riapri':'Completa'}: ${e(t.title)}">${t.status==='done'?'✓':''}</button><button class="row-open" data-task="${e(t.path)}"><strong>${e(t.title)}</strong><small>${e(ownerLabel(t))} · ${e(PHASES[t.phase].name)}</small></button><span class="tag ${t.priority}">${PRIORITIES[t.priority]}</span></div>`;}
function renderOverview(){
  const all=state.tasks,done=all.filter(t=>t.status==='done').length,doing=all.filter(t=>t.status==='doing').length,blocked=all.filter(t=>t.status==='blocked').length;
  const next=sorted(all.filter(t=>t.status!=='done')).slice(0,5);
  return `<div class="stats"><div class="stat"><span class="label">Il percorso finora</span><strong>${all.length?Math.round(done/all.length*100):0}<small> %</small></strong><small>${done} di ${all.length} attività completate</small></div><div class="stat"><span class="label">Da portare avanti</span><strong>${all.length-done}</strong><small>Un passo dopo l’altro</small></div><div class="stat"><span class="label">In corso</span><strong>${doing}</strong><small>Il lavoro di questi giorni</small></div><div class="stat"><span class="label">Da sbloccare</span><strong>${blocked}</strong><small>Qui serve una mano</small></div></div><div class="overview-grid"><section class="panel"><div class="panel-head"><h2>Da dove cominciamo</h2><button class="text-button" data-nav="board">Tutte le attività ↗</button></div>${next.length?next.map(taskRow).join(''):'<div class="empty">Tutto completato. Pronti per il prossimo passo?</div>'}</section><section class="panel"><div class="panel-head"><h2>Le fasi del progetto</h2><button class="text-button" data-nav="phases">Esplora ↗</button></div>${Object.entries(PHASES).map(([k,p],i)=>{const s=phaseStats(k);return `<div class="phase-mini"><div class="row"><span>${i+1}. ${e(p.name)}</span><small>${s.done}/${s.total}</small></div><div class="bar"><span style="width:${s.percent}%"></span></div></div>`;}).join('')}</section></div><div class="note-strip"><span>◎</span><p><strong>Un piano condiviso, da confermare insieme.</strong> Ruoli e date importati dall’agenda sono proposte. Completare una scheda registra il lavoro, non approva spese o decisioni del gruppo.</p></div><div class="section-title"><h2>Ognuno porta qualcosa.</h2><span class="tag proposal">Assegnazioni da confermare</span></div><div class="team-grid">${[...new Set(all.map(t=>t.assignee).filter(Boolean))].filter(x=>x!=='Tutti').map(name=>`<div class="team-card"><span class="avatar">${e(initials(name))}</span><div><strong>${e(name)}</strong><small>${all.filter(t=>t.assignee===name&&t.status!=='done').length} attività aperte</small></div></div>`).join('')}</div>`;
}
function options(values,selected,empty){return (empty?`<option value="">${empty}</option>`:'')+Object.entries(values).map(([k,v])=>`<option value="${e(k)}" ${k===selected?'selected':''}>${e(v)}</option>`).join('');}
function renderBoard(){
  const f=state.filter, tasks=filteredTasks(), owners=Object.fromEntries([...new Set(state.tasks.map(t=>t.assignee).filter(Boolean))].map(x=>[x,x]));
  return `<div class="filters"><input id="task-search" type="search" placeholder="Cerca un’attività…" aria-label="Cerca attività" value="${e(f.search)}"><select id="filter-assignee" aria-label="Filtra per responsabile">${options(owners,f.assignee,'Tutte le persone')}</select><select id="filter-phase" aria-label="Filtra per fase">${options(Object.fromEntries(Object.entries(PHASES).map(([k,v])=>[k,v.name])),f.phase,'Tutte le fasi')}</select><select id="filter-priority" aria-label="Filtra per priorità">${options(PRIORITIES,f.priority,'Tutte le priorità')}</select></div><div class="board">${Object.entries(STATUSES).map(([key,label])=>`<section class="column" data-status="${key}"><div class="column-head"><span>${label}</span><b>${tasks.filter(t=>t.status===key).length}</b></div>${tasks.filter(t=>t.status===key).map(t=>`<article class="task-card"><div class="card-top"><span class="tag ${t.priority}">${PRIORITIES[t.priority]}</span><button class="check-button ${t.status==='done'?'done':''}" data-toggle="${e(t.path)}" aria-label="${t.status==='done'?'Riapri':'Completa'}: ${e(t.title)}">${t.status==='done'?'✓':''}</button></div><button class="card-open" data-task="${e(t.path)}">${e(t.title)}</button><div class="meta"><span>${e(PHASES[t.phase].name)}</span><span class="avatar" title="${e(ownerLabel(t))}">${e(initials(t.assignee))}</span></div><button class="owner-trigger" data-assign="${e(t.path)}" aria-label="Cambia assegnatario: ${e(t.title)}"><span>${e(ownerLabel(t))}</span><span>Cambia ↗</span></button><p class="help">${t.due?' · '+e(t.due):''}</p><select data-status-task="${e(t.path)}" aria-label="Stato di ${e(t.title)}">${options(STATUSES,t.status)}</select></article>`).join('')||'<div class="empty">Nessuna attività qui.</div>'}</section>`).join('')}</div>`;
}
function renderPhases(){return `<div class="note-strip" style="margin-top:0;margin-bottom:22px"><p>Calendario proposto nell’agenda. Le fasi successive dipendono da copertura finanziaria e tutele, non da una data già fissata.</p></div><div class="phases-list">${Object.entries(PHASES).map(([key,p],i)=>{const s=phaseStats(key);return `<article class="phase-card"><span class="phase-number">0${i+1}</span><div><span class="eyebrow">${e(p.period)}</span><h2>${e(p.name)}</h2><p>${e(p.description)}</p><button class="text-button" data-phase="${key}">Vedi le attività ↗</button></div><div><small>${s.done} di ${s.total} completate · ${s.percent}%</small><div class="bar"><span style="width:${s.percent}%"></span></div></div></article>`;}).join('')}</div>`;}
function renderWiki(){
  const pages=state.files.filter(f=>!f.path.startsWith('attivita/')&&!f.path.startsWith('.')).sort((a,b)=>a.path.localeCompare(b.path));
  return `<div class="wiki-layout"><aside class="wiki-list"><input type="search" id="wiki-search" placeholder="Cerca una pagina…" aria-label="Cerca pagine" value="${e(state.wikiQuery)}">${pages.filter(f=>f.path.toLowerCase().includes(state.wikiQuery.toLowerCase())).map(f=>`<button data-doc="${e(f.path)}" class="${f.path===state.wikiPath?'active':''}">${e(f.path.split('/').pop().replace('.md','').replaceAll('-',' '))}<small>${e(f.path)}</small></button>`).join('')}</aside><article id="wiki-article" class="wiki-article"><div class="loading">Apertura pagina…</div></article></div>`;
}
let wikiRequest=0;
async function loadWiki(){const request=++wikiRequest;try{const file=await readFile(state.wikiPath);if(request!==wikiRequest||state.view!=='wiki')return;const p=parseMarkdown(file.raw);$('#wiki-article').innerHTML=`<div class="article-toolbar"><small>${e(file.path)}</small><button class="secondary" id="edit-doc">Modifica pagina</button></div><div class="markdown">${markdownHTML(p.body,file.path,state.repo)}</div>`;$('#edit-doc').onclick=()=>openDoc(file);}catch(err){if($('#wiki-article'))$('#wiki-article').innerHTML=`<div class="empty">${e(errorText(err))}</div>`;}}
function render(){
  if(!state.user)return;
  const titles={graph:['LA MAPPA DEL PROGETTO','Le idee, collegate.','Esplora pagine, attività e relazioni nella wiki condivisa.'],overview:['IL NOSTRO PROGETTO','Facciamo spazio alle idee.','La direzione è comune. Il prossimo passo è concreto.'],board:['DAL PIANO ALL’AZIONE','Il lavoro, un passo alla volta.','Priorità chiare, responsabilità condivise e nessun pezzo perso.'],phases:['LA STRADA DAVANTI','Una direzione, cinque fasi.','Dall’ascolto al primo pilota. Con il tempo necessario per farlo bene.'],wiki:['LA NOSTRA CONOSCENZA','Quello che sappiamo, insieme.','Le stesse pagine che leggete e aggiornate con i vostri assistenti AI.']};
  const [eyebrow,title,description]=titles[state.view];$('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-description').textContent=description;
  $('#breadcrumb').textContent='Held / '+({overview:'Panoramica',board:'Attività',phases:'Fasi di lavoro',wiki:'Wiki',graph:'Grafo'}[state.view]);$('#task-count').textContent=state.tasks.filter(t=>t.status!=='done').length;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('#content').innerHTML=(state.errors?.length?`<div class="warning-banner">${state.errors.map(e).join('<br>')}<br>Correggi i metadati nella wiki. Le altre attività sono disponibili.</div>`:'')+({overview:renderOverview,board:renderBoard,phases:renderPhases,wiki:renderWiki,graph:renderGraph}[state.view])();
  if(state.view==='wiki')loadWiki();
  if(state.view==='graph')loadGraph();
  if(state.view==='phases'){
    const button=document.createElement('button');button.className='secondary';button.style.marginTop='18px';button.textContent='Modifica nomi e calendario delle fasi';button.onclick=async()=>{try{openDoc(await readFile('attivita/README.md',true));}catch(err){toast(errorText(err));}};$('#content').append(button);
  }
  $('#task-search')?.addEventListener('input',event=>{const pos=event.target.selectionStart;state.filter.search=event.target.value;render();$('#task-search').focus();$('#task-search').setSelectionRange(pos,pos);});
  for(const key of ['assignee','phase','priority'])$('#filter-'+key)?.addEventListener('change',event=>{state.filter[key]=event.target.value;render();});
  $('#wiki-search')?.addEventListener('input',event=>{const pos=event.target.selectionStart;state.wikiQuery=event.target.value;render();$('#wiki-search').focus();$('#wiki-search').setSelectionRange(pos,pos);});
}
function showDialog(editor,fields){
  state.editor=editor;$('#editor-fields').innerHTML=fields;$('#editor-feedback').textContent='';$('#download-draft').hidden=true;
  $('#editor-title').textContent=editor.kind==='doc'?'Modifica pagina':editor.sha?'Dettaglio attività':'Una nuova attività';
  $('#editor-kicker').textContent=editor.kind==='doc'?'WIKI CONDIVISA':'ATTIVITÀ';$('#source-link').href=fileURL(editor.path,state.repo);$('#source-link').hidden=!editor.sha;
  $('#editor').showModal();state.editor.initial=editorSnapshot();
  if(editor.kind==='task'){
    const assignee=$('#editor-form [name=assignee]');
    const choices=document.createElement('div');choices.className='owner-options';choices.setAttribute('aria-label','Scelta rapida del responsabile');
    choices.innerHTML=['Franco','Flavio','Othello',''].map(name=>'<button type="button" data-owner="'+e(name)+'">'+e(name||'Da assegnare')+'</button>').join('');
    $('#editor-fields').prepend(choices);
    assignee.addEventListener('input',()=>$('#editor-form [name=assignment]').value='proposed');
  }
}
function editorSnapshot(){return JSON.stringify([...new FormData($('#editor-form')).entries()]);}
function taskFields(t){
  const comments=t.body?.split('\n## Commenti')[1]||'';const body=(t.body||'## Risultato atteso\n\nDescrivi quando questa attività può dirsi conclusa.\n\n## Sottoattività\n\n- [ ] Primo passo\n').split('\n## Commenti')[0];
  return `<div class="form-grid"><label class="span-2">Titolo<input name="title" required maxlength="240" value="${e(t.title||'')}"></label><label>Responsabile<input name="assignee" list="owners" value="${e(t.assignee||'')}" placeholder="Da assegnare"><datalist id="owners"><option>Franco</option><option>Flavio</option><option>Othello</option><option>Tutti</option></datalist></label><label>Assegnazione<select name="assignment">${options({proposed:'Proposta, da confermare',confirmed:'Confermata'},t.assignment||'proposed')}</select></label><label>Stato<select name="status">${options(STATUSES,t.status||'todo')}</select></label><label>Priorità<select name="priority">${options(PRIORITIES,t.priority||'medium')}</select></label><label>Fase<select name="phase">${options(Object.fromEntries(Object.entries(PHASES).map(([k,v])=>[k,v.name])),t.phase||state.filter.phase||'avvio')}</select></label><label>Scadenza <input type="date" name="due" value="${e(t.due||'')}"></label><label>Data proposta o concordata<select name="schedule">${options({proposed:'Proposta',confirmed:'Concordata'},t.schedule||'proposed')}</select></label><label class="span-2">Descrizione e sottoattività (Markdown)<textarea name="body" rows="8">${e(body)}</textarea></label></div><p class="help">Per una sottoattività scrivi <code>- [ ] Cosa fare</code>. Spunta qui sotto e salva.</p><div id="checklist"></div>${comments?`<section class="comments-view"><h3>Commenti precedenti</h3><div class="markdown">${markdownHTML(comments,t.path,state.repo)}</div></section>`:''}<label>Aggiungi un commento<textarea name="comment" rows="3" placeholder="Un aggiornamento, un dubbio, il prossimo passo…" style="min-height:85px"></textarea></label><p class="help">Il salvataggio aggiorna direttamente il file nella wiki e crea un commit a tuo nome. Il segno di spunta non sostituisce la conferma delle decisioni del gruppo.</p>`;
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
  return serializeMarkdown(ed.raw,{id:ed.id||ed.path.split('/').pop().replace('.md',''),title:f.title.trim(),type:'overview',updated:today(),status:f.status,priority:f.priority,phase:f.phase,assignee:f.assignee.trim(),assignment:f.assignment,due:f.due,schedule:f.schedule,...(!ed.sha?{sources:[]}:{}),updated_by:state.user.login},body);
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
$('#refresh').onclick=()=>refresh();$('#new-task').onclick=newTask;$('#close-editor').onclick=closeEditor;$('#editor-form').onsubmit=saveEditor;
$('#editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('#logout').onclick=async()=>{if(state.oauth){try{const response=await fetch('/auth/logout',{method:'POST',headers:{'X-Held-CSRF':state.csrf}});if(!response.ok&&response.status!==401)throw new Error();}catch{toast('Uscita non confermata: controlla la connessione e riprova.');return;}}state.oauth=false;state.csrf='';clearInterval(state.poll);state.session++;state.token='';state.user=null;state.cache.clear();state.tasks=[];state.files=[];state.lastHead='';$('#content').innerHTML='';$('#app').hidden=true;$('#login').hidden=false;};
const mobileLogout=document.createElement('button');mobileLogout.className='icon-button mobile-logout';mobileLogout.textContent='↪';mobileLogout.setAttribute('aria-label','Esci dall’account');mobileLogout.onclick=()=>$('#logout').click();$('.topbar>div').append(mobileLogout);
$('#download-draft').onclick=()=>{const blob=new Blob([buildDraft()],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=state.editor.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.view)navigate(target.dataset.view);if(target.dataset.nav)navigate(target.dataset.nav);
  if(target.dataset.task)openTask(target.dataset.task);
  if(target.dataset.assign){openTask(target.dataset.assign);const input=$('#editor-form [name=assignee]');input.focus();input.select();}
  if(Object.hasOwn(target.dataset,'owner')){const input=$('#editor-form [name=assignee]');input.value=target.dataset.owner;$('#editor-form [name=assignment]').value='proposed';input.focus();}
  if(target.dataset.toggle){const t=state.tasks.find(t=>t.path===target.dataset.toggle);updateStatus(t.path,t.status==='done'?'todo':'done');}
  if(target.dataset.phase){state.filter.phase=target.dataset.phase;navigate('board');}
  if(target.dataset.doc){state.wikiPath=target.dataset.doc;render();}
});
document.addEventListener('change',event=>{if(event.target.dataset.statusTask)updateStatus(event.target.dataset.statusTask,event.target.value);if(event.target.dataset.check){const input=$('#editor-form [name=body]');input.value=toggleCheck(input.value,Number(event.target.dataset.check),event.target.checked);}});
window.addEventListener('beforeunload',event=>{if(state.editor&&editorSnapshot()!==state.editor.initial){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
if(['localhost','127.0.0.1'].includes(location.hostname))fetch('/api/config').then(r=>r.json()).then(config=>{if(config.local){state.nonce=config.nonce;$('#local-login').hidden=false;$('#login-form [name=repo]').value=config.repo;connect(true);}}).catch(()=>{});

let graphRequest=0;
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
  const host=$('#graph-container');mountGraph(host,buildGraph(files),{onOpen:node=>{if(node.task)openTask(node.id);else{state.wikiPath=node.id;navigate('wiki');}}});
  if(errors.length){const warning=document.createElement('p');warning.className='graph-error';warning.textContent='Grafo parziale: impossibile leggere '+errors.join(', ')+'. Premi aggiorna per riprovare.';host.prepend(warning);}
}

async function initGitHubLogin(){
  const button=$('#github-login'),status=$('#oauth-status');
  try{
    const response=await fetch('./auth-config.json',{cache:'no-store'});if(!response.ok)return;const config=await response.json();
    if(config.github_login_url){const target=new URL(config.github_login_url);if(target.protocol!=='https:'||target.username||target.password)throw new Error();button.hidden=false;button.onclick=()=>location.assign(target.href);}
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
