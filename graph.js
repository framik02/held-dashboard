import {parseMarkdown,escapeHTML as e,STATUSES,PHASES} from './core.js';

export const GRAPH_TYPES={
 avvio:{label:'Avvio',color:'#315bad'},ascolto:{label:'Ascolto',color:'#1784a3'},
 proposta:{label:'Proposta',color:'#7962b5'},copertura:{label:'Copertura e tutele',color:'#ad7627'},
 pilota:{label:'Pilota',color:'#21877d'},decisioni:{label:'Decisioni',color:'#b6597c'},
 progressi:{label:'Progressi',color:'#557da1'},documenti:{label:'Pagine della wiki',color:'#6d7b91'}
};
export function resolveReference(target,from,known){
 target=String(target).trim().replace(/^['"]|['"]$/g,'');
 if(!target||target.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(target)||target.startsWith('//'))return null;
 try{const u=new URL(target,'https://held.invalid/'+from);if(u.origin!=='https://held.invalid')return null;const p=decodeURIComponent(u.pathname.slice(1));return known.has(p)?p:null;}catch{return null;}
}
export function buildGraph(files){
 const known=new Set(files.map(f=>f.path));
 const nodes=files.map(file=>{const {meta,body}=parseMarkdown(file.raw);const task=file.path.startsWith('attivita/')&&file.path!=='attivita/README.md';
   const category=task&&Object.hasOwn(PHASES,meta.phase)?meta.phase:file.path==='decisioni.md'?'decisioni':file.path.startsWith('progressi/')?'progressi':'documenti';
   const title=typeof meta.title==='string'?meta.title:body.match(/^# (.+)$/m)?.[1]||file.path.split('/').pop().replace('.md','');
   return {id:file.path,title,category,task,status:meta.status||'',assignee:typeof meta.assignee==='string'?meta.assignee:'',body,meta};});
 const links=new Map();
 for(const n of nodes){
   const body=n.body.replace(/```[\s\S]*?```/g,'');
   const refs=[...body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map(m=>m[1]);
   const sources=Array.isArray(n.meta.sources)?n.meta.sources:typeof n.meta.sources==='string'?n.meta.sources.replace(/^\[|\]$/g,'').split(','):[];
   refs.push(...sources);
   for(const match of body.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)){
     const value=match[1].endsWith('.md')?match[1]:match[1]+'.md';
     const candidates=[...known].filter(p=>p===value||p.endsWith('/'+value));
     if(candidates.length===1)refs.push('/'+candidates[0]);
   }
   for(const ref of refs){const dest=resolveReference(ref,n.id,known);if(!dest||dest===n.id)continue;const pair=[n.id,dest].sort();links.set(pair.join('\0'),{source:pair[0],target:pair[1]});}
 }
 return {nodes,links:[...links.values()]};
}
export function layoutGraph(nodes,links){
 const types=[...new Set(nodes.map(n=>n.category))];
 const arranged=nodes.map((n,i)=>{const group=types.indexOf(n.category),a=group/types.length*Math.PI*2-Math.PI/2;return {...n,x:600+Math.cos(a)*300+Math.cos(i*2.4)*70,y:420+Math.sin(a)*240+Math.sin(i*2.4)*70,ax:600+Math.cos(a)*300,ay:420+Math.sin(a)*240};});
 const index=new Map(arranged.map(n=>[n.id,n]));
 for(let step=0;step<160;step++){
   const velocity=new Map(arranged.map(n=>[n.id,{x:(n.ax-n.x)*.012,y:(n.ay-n.y)*.012}]));
   for(let i=0;i<arranged.length;i++)for(let j=i+1;j<arranged.length;j++){
     const a=arranged[i],b=arranged[j];let dx=a.x-b.x,dy=a.y-b.y;const dist=Math.max(1,Math.hypot(dx,dy));const force=Math.min(14,9000/(dist*dist)+Math.max(0,110-dist)*.12);
     velocity.get(a.id).x+=dx/dist*force;velocity.get(a.id).y+=dy/dist*force;velocity.get(b.id).x-=dx/dist*force;velocity.get(b.id).y-=dy/dist*force;
   }
   for(const link of links){const a=index.get(link.source),b=index.get(link.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-170)*.003;
     velocity.get(a.id).x+=dx/d*f;velocity.get(a.id).y+=dy/d*f;velocity.get(b.id).x-=dx/d*f;velocity.get(b.id).y-=dy/d*f;
   }
   for(const n of arranged){const v=velocity.get(n.id);n.x=Math.max(105,Math.min(1095,n.x+v.x));n.y=Math.max(55,Math.min(765,n.y+v.y));}
 }
 return arranged;
}
function labelLines(title){const words=title.split(/\s+/);const lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>25&&lines.at(-1))lines.push('');lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}return lines.length>2?[lines[0],lines[1].slice(0,24)+'…']:lines;}
export function mountGraph(container,graph,{onOpen}={}){
 let category='',query='',selected='',scale=1,dx=0,dy=0,positioned=[],camera={x:0,y:0,w:1200,h:840};
 container.innerHTML=`<div class="graph-viewbar"><span id="graph-count" role="status"></span><button id="graph-expand" class="secondary" aria-label="Grafo a tutto schermo">⛶ <span>Espandi</span></button></div><details class="graph-options"><summary>Cerca e filtra <span>⌄</span></summary><div class="graph-toolbar"><label class="sr-only" for="graph-search">Cerca un nodo</label><input id="graph-search" type="search" placeholder="Cerca una pagina o un’attività…"><label class="sr-only" for="graph-type">Tipo di attività o contenuto</label><select id="graph-type"><option value="">Tutti i tipi</option>${Object.entries(GRAPH_TYPES).map(([key,t])=>`<option value="${key}">${e(t.label)}</option>`).join('')}</select><label class="graph-label-toggle"><input id="graph-labels" type="checkbox"> Mostra tutti i nomi</label></div><div class="graph-legend">${Object.entries(GRAPH_TYPES).map(([key,t])=>`<button data-category="${key}" aria-pressed="false"><i style="background:${t.color}"></i>${e(t.label)}</button>`).join('')}</div></details><div class="graph-layout"><section class="graph-stage"><div class="graph-controls"><button data-zoom="in" aria-label="Ingrandisci grafo">＋</button><button data-zoom="out" aria-label="Riduci grafo">−</button><button data-zoom="reset" aria-label="Centra il grafo">⤢</button></div><svg id="wiki-graph" viewBox="0 0 1200 840" aria-label="Grafo delle pagine e delle attività della wiki"><g id="graph-world"></g></svg><p class="graph-hint">Trascina · ingrandisci con due dita · tocca un nodo</p></section><aside id="graph-detail" class="graph-detail"></aside></div><details class="graph-node-list"><summary>Nomi completi dei nodi</summary><div id="graph-node-list"></div></details>`;
 const svg=container.querySelector('svg'),world=container.querySelector('#graph-world'),detail=container.querySelector('#graph-detail');
 function transform(){world.setAttribute('transform',`translate(${dx} ${dy}) scale(${scale})`);world.querySelectorAll('.node-hit').forEach(hit=>hit.setAttribute('r',String(22*camera.w/Math.max(1,svg.clientWidth)/scale)));}
 function zoom(factor){const next=Math.max(.4,Math.min(8,scale*factor));const cx=camera.x+camera.w/2,cy=camera.y+camera.h/2;dx=cx-(cx-dx)*next/scale;dy=cy-(cy-dy)*next/scale;scale=next;transform();}
 function paint(){
   const visible=graph.nodes.filter(n=>!category||n.category===category);const ids=new Set(visible.map(n=>n.id));const links=graph.links.filter(l=>ids.has(l.source)&&ids.has(l.target));
   positioned=layoutGraph(visible,links);if(svg.clientWidth<600)positioned=positioned.map(n=>({...n,x:600+(n.x-600)*.55}));const map=new Map(positioned.map(n=>[n.id,n]));
   if(selected&&!ids.has(selected))selected='';
   if(positioned.length){
     const xs=positioned.map(n=>n.x),ys=positioned.map(n=>n.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
     const ratio=Math.max(.3,svg.clientWidth/svg.clientHeight);let w=Math.max(370,maxX-minX+290),h=Math.max(280,maxY-minY+175);
     if(w/h<ratio)w=h*ratio;else h=w/ratio;
     camera={x:(minX+maxX-w)/2,y:(minY+maxY-h)/2+20,w,h};svg.setAttribute('viewBox',[camera.x,camera.y,w,h].join(' '));
   }
   const units=camera.w/Math.max(1,svg.clientWidth);
   const neighbors=new Set([selected]);for(const l of links){if(l.source===selected)neighbors.add(l.target);if(l.target===selected)neighbors.add(l.source);}
   const matches=n=>!query||(n.title+' '+n.id).toLowerCase().includes(query.toLowerCase());
   const dim=n=>(selected&&!neighbors.has(n.id))||!matches(n);
   world.innerHTML=links.map(l=>{const a=map.get(l.source),b=map.get(l.target);const active=selected&&(a.id===selected||b.id===selected);return `<line class="graph-edge ${active?'selected':''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" opacity="${dim(a)||dim(b)?'.12':active?'1':'.45'}"/>`;}).join('')+positioned.map(n=>{
     const color=GRAPH_TYPES[n.category].color,degree=links.filter(l=>l.source===n.id||l.target===n.id).length,r=Math.max(8+Math.min(7,degree*.5),5.5*units);
     return `<g class="graph-node ${selected===n.id?'selected':''} ${query&&matches(n)?'search-match':''}" transform="translate(${n.x} ${n.y})" data-node="${e(n.id)}" tabindex="0" role="button" aria-label="${e(n.title)}" opacity="${dim(n)?'.2':'1'}"><title>${e(n.title)} — ${e(GRAPH_TYPES[n.category].label)}</title><circle class="node-hit" r="${Math.max(27,22*units/scale)}" fill="transparent"/><circle class="node-halo" r="${r+7}" fill="${color}" opacity=".13"/><circle class="node-dot" r="${r}" fill="${color}"/>${n.status==='done'?'<text class="node-done" y="4" text-anchor="middle">✓</text>':''}<text class="node-label" style="font-size:${15*units}px" text-anchor="middle">${labelLines(n.title).map((line,i)=>`<tspan x="0" y="${r+22*units+i*19*units}">${e(line)}</tspan>`).join('')}</text></g>`;
   }).join('');transform();
   container.querySelector('#graph-node-list').innerHTML=visible.filter(matches).map(n=>'<button data-list-node="'+e(n.id)+'"><i style="background:'+GRAPH_TYPES[n.category].color+'"></i><span>'+e(n.title)+'</span></button>').join('');
   container.querySelectorAll('[data-list-node]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.listNode;paint();detail.scrollIntoView({block:'nearest',behavior:'smooth'});}));
   container.querySelector('#graph-count').textContent=`${visible.filter(matches).length} nodi · ${links.length} collegamenti`;
   container.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
   const node=graph.nodes.find(n=>n.id===selected);
   detail.classList.toggle('has-selection',Boolean(node));
   detail.innerHTML=node?`<button id="graph-dismiss" class="icon-button" aria-label="Chiudi dettagli del nodo">✕</button><span class="eyebrow">${e(GRAPH_TYPES[node.category].label)}</span><h2>${e(node.title)}</h2><p class="graph-path">${e(node.id)}</p>${node.task?`<p><strong>Stato</strong><br>${e(STATUSES[node.status]||node.status||'Da verificare')}</p><p><strong>Responsabile</strong><br>${e(node.assignee||'Da assegnare')}</p>`:''}<p>${graph.links.filter(l=>l.source===node.id||l.target===node.id).length} collegamenti nella wiki</p><button class="primary" id="graph-open">${node.task?'Apri attività':'Apri pagina'} ↗</button>`: '<p class="graph-empty-hint">Tocca un nodo per leggere il nome e aprire la pagina. I colori indicano il tipo di attività.</p>';
   detail.querySelector('#graph-dismiss')?.addEventListener('click',()=>{selected='';paint();});
   detail.querySelector('#graph-open')?.addEventListener('click',()=>onOpen?.(node));
 }
 container.querySelector('#graph-search').addEventListener('input',event=>{query=event.target.value;selected='';paint();});
 container.querySelector('#graph-type').addEventListener('change',event=>{category=event.target.value;selected='';scale=1;dx=dy=0;paint();});
 container.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=category===button.dataset.category?'':button.dataset.category;container.querySelector('#graph-type').value=category;selected='';scale=1;dx=dy=0;paint();}));
 container.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.zoom==='reset'){scale=1;dx=dy=0;transform();}else zoom(button.dataset.zoom==='in'?1.25:.8);}));
 let moved=false,tapNode='';const pointers=new Map();let previousDistance=0;
 svg.addEventListener('pointerdown',event=>{if(pointers.size===0){moved=false;tapNode=event.target.closest('[data-node]')?.dataset.node||'';}else moved=true;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});svg.setPointerCapture(event.pointerId);if(pointers.size===2){const [a,b]=[...pointers.values()];previousDistance=Math.hypot(a.x-b.x,a.y-b.y);}});
 svg.addEventListener('pointermove',event=>{const old=pointers.get(event.pointerId);if(!old)return;const nx=event.clientX,ny=event.clientY;if(Math.abs(nx-old.x)+Math.abs(ny-old.y)>2)moved=true;pointers.set(event.pointerId,{x:nx,y:ny});if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(previousDistance)zoom(distance/previousDistance);previousDistance=distance;}else{const factor=camera.w/svg.getBoundingClientRect().width;dx+=(nx-old.x)*factor;dy+=(ny-old.y)*factor;transform();}});
 const end=event=>{const tap=event.type==='pointerup'&&!moved&&pointers.size===1;pointers.delete(event.pointerId);previousDistance=0;if(tap){selected=tapNode;paint();}};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 svg.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);},{passive:false});
 svg.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.dataset.node){event.preventDefault();selected=event.target.dataset.node;paint();detail.querySelector('button')?.focus();}});
 const expand=container.querySelector('#graph-expand');
 const anchor=document.createComment('graph-position');container.before(anchor);
 const fullscreen=document.createElement('dialog');fullscreen.className='graph-fullscreen-shell';fullscreen.setAttribute('aria-label','Grafo a tutto schermo');document.body.append(fullscreen);
 const restore=()=>{if(!fullscreen.contains(container))return;anchor.after(container);document.body.classList.remove('graph-lock');expand.innerHTML='⛶ <span>Espandi</span>';expand.setAttribute('aria-label','Grafo a tutto schermo');expand.focus();};
 fullscreen.addEventListener('close',restore);
 expand.onclick=()=>{if(fullscreen.open){fullscreen.close();restore();}else{fullscreen.append(container);fullscreen.showModal();document.body.classList.add('graph-lock');expand.innerHTML='✕ <span>Chiudi</span>';expand.setAttribute('aria-label','Esci dal grafo a tutto schermo');expand.focus();}};
 container.querySelector('#graph-labels').onchange=event=>container.classList.toggle('show-labels',event.target.checked);
 const observer=new ResizeObserver(()=>{if(!svg.isConnected){observer.disconnect();return;}paint();});observer.observe(svg);
 paint();
 return ()=>{observer.disconnect();if(fullscreen.open)fullscreen.close();restore();fullscreen.remove();anchor.remove();};
}
