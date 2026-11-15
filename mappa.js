// Vista Mappa: colora i comuni con l'indice esplorativo e altri indicatori.
// I dati non stanno in questo repository pubblico: arrivano dalla wiki privata (cartella dati/).
import {escapeHTML as e} from './core.js';

let libs;
function loadScript(src){return new Promise((ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('Impossibile caricare '+src));document.head.append(s);});}
export function loadMapLibraries(){
  if(window.d3&&window.topojson)return Promise.resolve();
  libs??=loadScript('vendor/d3.min.js').then(()=>loadScript('vendor/topojson.min.js')).catch(err=>{libs=null;throw err;});
  return libs;
}

const fmt=(v,d=1)=>v==null||Number.isNaN(v)?'ND':v.toLocaleString('it-IT',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtI=v=>v==null?'ND':Math.round(v).toLocaleString('it-IT');
const MACRO={N:'Nord',C:'Centro',S:'Sud e isole'};
const PAL=['#a83232','#d9705f','#f2b9a8','#e6e8e4','#b9dcae','#5fa85a','#1f6b34'];
export const MAP_INDICATORS=[
  {k:'idx',label:'Indice esplorativo Held',unit:'su 100',d:1},
  {k:'gen',label:'Sostegno ai genitori',unit:'su 100',d:1},
  {k:'bisogno',label:'Dimensione: bisogno',unit:'percentile',d:0},
  {k:'partner',label:'Dimensione: partner e sedi',unit:'percentile',d:0},
  {k:'bacino',label:'Dimensione: bacino',unit:'percentile',d:0},
  {k:'mobilita',label:'Dimensione: mobilità',unit:'percentile',d:0},
  {k:'q65',label:'Residenti con 65 anni e più',unit:'%',d:1},
  {k:'qsoli',label:'Famiglie di una sola persona',unit:'%',d:1},
  {k:'iv',label:'Indice di vecchiaia',unit:'over 65 ogni 100 under 15',d:0},
  {k:'nido',label:'Posti nido ogni 100 bambini 0-2',unit:'posti',d:1,invert:true,cap:100},
  {k:'q010',label:'Bambini fino a 10 anni',unit:'%',d:1},
  {k:'np',label:'Non profit ogni 10.000 abitanti (prov.)',unit:'organizzazioni',d:1},
  {k:'occf',label:'Occupazione femminile 20-64 (prov.)',unit:'%',d:1},
];
const DIMS=[['bisogno','Bisogno'],['partner','Partner e sedi'],['bacino','Bacino'],['mobilita','Mobilità']];
const NUTS06={1:'ITC1',2:'ITC2',3:'ITC4',5:'ITD3',6:'ITD4',7:'ITC3',8:'ITD5',9:'ITE1',10:'ITE2',11:'ITE3',12:'ITE4',13:'ITF1',14:'ITF2',15:'ITF3',16:'ITF4',17:'ITF5',18:'ITF6',19:'ITG1',20:'ITG2'};

export const groupKey=(c,g)=>g==='c'?c.c:g==='r'?String(c.r):c.m;
// Media dei comuni del gruppo: semplice (ogni comune conta uguale) o pesata per abitanti.
export function aggregate(comuni,ind,g,avg){
  const acc=new Map();
  for(const c of comuni){const v=c[ind.k];if(v==null)continue;const val=ind.cap?Math.min(v,ind.cap):v;
    const k=groupKey(c,g);const a=acc.get(k)||{s:0,w:0,n:0,pop:0};const w=avg==='w'?c.pop:1;a.s+=val*w;a.w+=w;a.n++;a.pop+=c.pop;acc.set(k,a);}
  const out=new Map();for(const [k,a] of acc)out.set(k,{v:a.s/a.w,n:a.n,pop:a.pop});return out;
}

export function mountMap(host,topo,data,{onMethod}={}){
  const d3=window.d3,topojson=window.topojson;
  const byCode=new Map(data.comuni.map(c=>[c.c,c]));
  const W=data.pesi||{};
  const state={ind:'idx',gran:'c',avg:'s',sel:'054018'};
  try{Object.assign(state,JSON.parse(localStorage.getItem('held-mappa')||'{}'));}catch{}
  if(!byCode.has(state.sel))state.sel=data.comuni[0].c;
  const save=()=>{try{localStorage.setItem('held-mappa',JSON.stringify(state));}catch{}};
  host.innerHTML=`<div class="held-map">
   <div class="hm-controls" role="group" aria-label="Filtri della mappa">
    <label class="hm-field">Cosa colorare<select id="hm-ind">${MAP_INDICATORS.map(i=>`<option value="${i.k}">${e(i.label)}</option>`).join('')}</select></label>
    <div class="hm-field"><span id="hm-gran-lab">Granularità</span><div class="hm-seg" role="group" aria-labelledby="hm-gran-lab" id="hm-gran">
      <button type="button" data-v="c">Comune</button><button type="button" data-v="r">Regione</button><button type="button" data-v="m">Nord, Centro, Sud</button></div></div>
    <div class="hm-field"><span id="hm-avg-lab">Media dei comuni</span><div class="hm-seg" role="group" aria-labelledby="hm-avg-lab" id="hm-avg">
      <button type="button" data-v="s">Semplice</button><button type="button" data-v="w">Pesata per abitanti</button></div></div>
    <label class="hm-field hm-search">Cerca un comune<input id="hm-q" type="search" placeholder="Foligno, Spello, Trevi…" autocomplete="off"><div id="hm-suggest" hidden></div></label>
    ${onMethod?'<button type="button" class="secondary hm-method" id="hm-method">Metodo e fonti ↗</button>':''}
   </div>
   <div class="hm-main">
    <div class="hm-mapbox"><svg id="hm-map" role="img" aria-label="Mappa d'Italia colorata per comune"></svg><div id="hm-tip" hidden></div><div class="hm-legend" id="hm-legend"></div></div>
    <aside class="hm-side"><section class="hm-card" id="hm-detail" aria-live="polite"></section>
     <section class="hm-card"><h3 id="hm-chart-title">Andamento della popolazione</h3><svg id="hm-chart" viewBox="0 0 420 210" role="img" aria-label="Grafico nel tempo"></svg><div class="hm-chart-legend" id="hm-chart-legend"></div><p class="hm-sub" id="hm-chart-note"></p></section>
     <section class="hm-card" id="hm-context"></section></aside>
   </div>
   <section class="hm-card"><h3 id="hm-rank-title">Classifica</h3><div class="hm-tables"><div class="hm-tablebox"><table id="hm-top"></table></div><div class="hm-tablebox"><table id="hm-bottom"></table></div></div></section>
  </div>`;
  const $=s=>host.querySelector(s);
  const svg=d3.select($('#hm-map'));
  const feats=topojson.feature(topo,topo.objects.comuni).features;
  const MW=900,MH=980;svg.attr('viewBox',`0 0 ${MW} ${MH}`);
  const proj=d3.geoIdentity().reflectY(true).fitSize([MW,MH],{type:'FeatureCollection',features:feats});
  const path=d3.geoPath(proj);
  const gU=svg.append('g'),gB=svg.append('g').attr('pointer-events','none'),gH=svg.append('g').attr('pointer-events','none');
  const units=gU.selectAll('path').data(feats).join('path').attr('class','hm-u').attr('d',path);
  const mesh=f=>path(topojson.mesh(topo,topo.objects.comuni,f));
  gB.append('path').attr('d',mesh((a,b)=>a===b)).attr('fill','none').attr('stroke','#7a8fa5').attr('stroke-width',.5);
  const regPath=gB.append('path').attr('d',mesh((a,b)=>a.properties.COD_REG!==b.properties.COD_REG)).attr('fill','none').attr('stroke','#18324d').attr('stroke-opacity',.55).attr('stroke-width',.7);
  gB.append('path').attr('d',mesh((a,b)=>a.properties.MACRO!==b.properties.MACRO)).attr('fill','none').attr('stroke','#18324d').attr('stroke-width',1.6);

  let curAgg,curInd,mid=0,ext=1,colorOf=()=>null;
  const groupName=(k,g)=>g==='c'?byCode.get(k)?.n:g==='r'?data.regioni[k]:MACRO[k];
  const members=()=>{const k=groupKey(byCode.get(state.sel),state.gran);return data.comuni.filter(c=>groupKey(c,state.gran)===k);};
  const meanOf=(list,key)=>{let s=0,w=0;for(const c of list){const v=c[key];if(v==null)continue;const ww=state.avg==='w'?c.pop:1;s+=v*ww;w+=ww;}return w?s/w:null;};
  const sumOf=(list,key)=>list.reduce((s,c)=>s+(c[key]||0),0);
  const rankList=()=>[...curAgg.entries()].map(([k,a])=>({k,...a})).sort((a,b)=>curInd.invert?a.v-b.v:b.v-a.v);

  function render(){
    const ind=MAP_INDICATORS.find(i=>i.k===state.ind)||MAP_INDICATORS[0];curInd=ind;$('#hm-ind').value=ind.k;
    host.querySelectorAll('#hm-gran button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===state.gran));
    host.querySelectorAll('#hm-avg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===state.avg));
    curAgg=aggregate(data.comuni,ind,state.gran,state.avg);
    // grigio sulla media italiana, estremi simmetrici al 95° percentile delle distanze
    let s=0,w=0;for(const c of data.comuni){const v=c[ind.k];if(v==null)continue;const ww=state.avg==='w'?c.pop:1;s+=(ind.cap?Math.min(v,ind.cap):v)*ww;w+=ww;}mid=s/w;
    const dev=[...curAgg.values()].map(a=>Math.abs(a.v-mid)).sort((a,b)=>a-b);ext=dev[Math.floor(dev.length*.95)]||dev[dev.length-1]||1;if(ind.cap)ext=Math.min(ext,ind.cap);
    const sign=ind.invert?-1:1;
    colorOf=v=>{if(v==null)return '#dbe5ef';const t=Math.max(-1,Math.min(1,sign*(v-mid)/ext));return PAL[Math.round((t+1)/2*6)];};
    const fillOf=f=>{const c=byCode.get(f.properties.PRO_COM_T);const a=c&&curAgg.get(groupKey(c,state.gran));return colorOf(a?a.v:null);};
    units.attr('fill',fillOf).style('stroke',state.gran==='c'?null:fillOf).style('stroke-width',state.gran==='c'?null:.6);
    regPath.attr('stroke-width',state.gran==='c'?.7:1).attr('stroke-opacity',state.gran==='m'?.25:.55);
    const lo=mid-sign*ext,hi=mid+sign*ext;
    $('#hm-legend').innerHTML=`<div class="hm-ramp" aria-hidden="true">${PAL.map(c=>`<span style="background:${c}"></span>`).join('')}</div>
      <div class="hm-ticks"><span>${fmt(lo,ind.d)}</span><span>media Italia ${fmt(mid,ind.d)}</span><span>${fmt(hi,ind.d)}</span></div>
      <div class="hm-cap">${e(ind.label)} · ${e(ind.unit)}. ${ind.invert?'Meno posti = più verde. ':''}Rosso meno adatto a Held, verde più adatto.${state.gran!=='c'?` Media ${state.avg==='w'?'pesata per abitanti':'semplice'} dei comuni.`:''}</div>`;
    renderRank();renderDetail();highlight();save();
  }
  function highlight(){
    gH.selectAll('*').remove();const c=byCode.get(state.sel);const k=groupKey(c,state.gran);
    const shapes=state.gran==='c'?feats.filter(f=>f.properties.PRO_COM_T===state.sel)
      :[topojson.merge(topo,topo.objects.comuni.geometries.filter(g=>{const cc=byCode.get(g.properties.PRO_COM_T);return cc&&groupKey(cc,state.gran)===k;}))];
    gH.selectAll('path').data(shapes).join('path').attr('d',path).attr('fill','none').attr('stroke','#18324d').attr('stroke-width',state.gran==='c'?2:2.2);
  }
  function renderRank(){
    const arr=rankList(),n=arr.length,g=state.gran,lim=g==='m'?3:10;
    const row=(x,i)=>`<tr class="hm-row" data-k="${e(x.k)}"><td class="hm-n">${i+1}</td><td><span class="hm-sw" style="background:${colorOf(x.v)}"></span>${e(groupName(x.k,g))}${g==='c'?` <small>${e(byCode.get(x.k).p)}</small>`:''}</td><td class="hm-n">${fmt(x.v,curInd.d)}</td><td class="hm-n">${g==='c'?fmtI(x.pop):x.n.toLocaleString('it-IT')}</td></tr>`;
    const head=`<tr><th>#</th><th>${g==='c'?'Comune':g==='r'?'Regione':'Area'}</th><th class="hm-n">${e(curInd.unit)}</th><th class="hm-n">${g==='c'?'Abitanti':'Comuni'}</th></tr>`;
    $('#hm-rank-title').textContent=`Classifica per ${curInd.label.toLowerCase()} · ${n.toLocaleString('it-IT')} ${g==='c'?'comuni':g==='r'?'regioni':'aree'}`;
    $('#hm-top').innerHTML='<caption>Più adatti</caption>'+head+arr.slice(0,lim).map(row).join('');
    $('#hm-bottom').innerHTML=g==='m'?'':'<caption>Meno adatti</caption>'+head+arr.slice(-lim).map((x,j)=>row(x,n-lim+j)).join('');
  }
  function renderDetail(){
    const c0=byCode.get(state.sel),g=state.gran,k=groupKey(c0,g),list=members(),arr=rankList(),pos=arr.findIndex(x=>x.k===k)+1,a=curAgg.get(k);
    const where=g==='c'?`${c0.p} · ${data.regioni[c0.r]} · ${MACRO[c0.m]}`:g==='r'?`${MACRO[c0.m]} · ${list.length.toLocaleString('it-IT')} comuni`:`${list.length.toLocaleString('it-IT')} comuni`;
    const pop=sumOf(list,'pop'),p65=sumOf(list,'p65'),p014=sumOf(list,'p014');
    const val=key=>g==='c'?c0[key]:meanOf(list,key);
    const nido=g==='c'?c0.nido:meanOf(list.map(c=>({...c,nido:c.nido==null?null:Math.min(c.nido,100)})),'nido');
    $('#hm-detail').innerHTML=`<span class="eyebrow">${g==='c'?'Comune':g==='r'?'Regione':'Area'} selezionata</span><h2>${e(groupName(k,g))}</h2><p class="hm-sub">${e(where)}</p>
      <div class="hm-score"><strong>${fmt(a?a.v:null,curInd.d)}</strong><span class="hm-chip">${pos?`${pos}° su ${arr.length.toLocaleString('it-IT')}`:'ND'}</span></div>
      <p class="hm-sub">${e(curInd.label)}${g!=='c'?`, media ${state.avg==='w'?'pesata':'semplice'} dei comuni`:''}</p>
      <div class="hm-dims">${DIMS.map(([key,lab])=>{const v=val(key);return `<div class="hm-dim"><span>${lab} <small>${W[key]??''}%</small></span><span class="hm-bar"><i style="width:${v==null?0:v}%"></i></span><b>${fmt(v,0)}</b></div>`;}).join('')}</div>
      <dl class="hm-facts">
        <div><dt>Indice Held</dt><dd>${fmt(val('idx'),1)}</dd></div><div><dt>Sostegno genitori</dt><dd>${fmt(val('gen'),1)}</dd></div>
        <div><dt>Residenti 2025</dt><dd>${fmtI(pop)}</dd></div><div><dt>65 anni e più</dt><dd>${fmt(p65/pop*100,1)}% <small>${fmtI(p65)}</small></dd></div>
        <div><dt>Famiglie di una persona</dt><dd>${fmt(val('qsoli'),1)}%</dd></div><div><dt>Posti nido / 100 bimbi</dt><dd>${fmt(nido,1)}</dd></div>
        <div><dt>Indice di vecchiaia</dt><dd>${fmt(p014?p65/p014*100:null,0)}</dd></div><div><dt>Non profit / 10.000 ab.</dt><dd>${fmt(val('np'),1)} <small>${g==='c'?'prov. '+c0.npY:''}</small></dd></div>
      </dl>`;
    renderChart(list,groupName(k,g));renderContext(c0);
  }
  function renderChart(list,name){
    const yrs=data.anni,g=state.gran;
    const sum=key=>yrs.map((_,i)=>list.reduce((s,c)=>s+(c[key][i]||0),0));
    const tot=g==='c'?list[0].s:sum('s'),p65=g==='c'?list[0].s65:sum('s65'),p014=g==='c'?list[0].s014:sum('s014');
    const q65=yrs.map((_,i)=>tot[i]?p65[i]/tot[i]*100:null),q014=yrs.map((_,i)=>tot[i]?p014[i]/tot[i]*100:null);
    const all=[...q65,...q014].filter(v=>v!=null);const sc=d3.select($('#hm-chart'));sc.selectAll('*').remove();
    $('#hm-chart-title').textContent=`${name}: anziani e bambini nel tempo`;
    if(!all.length){$('#hm-chart-note').textContent='Serie non disponibile.';return;}
    const m={l:34,r:56,t:12,b:24},Wc=420,Hc=210;
    const x=d3.scalePoint().domain(yrs).range([m.l,Wc-m.r]);
    const y=d3.scaleLinear().domain([Math.floor(d3.min(all)-1),Math.ceil(d3.max(all)+1)]).nice().range([Hc-m.b,m.t]);
    y.ticks(5).forEach(t=>{sc.append('line').attr('class','hm-grid').attr('x1',m.l).attr('x2',Wc-m.r).attr('y1',y(t)).attr('y2',y(t));sc.append('text').attr('x',m.l-6).attr('y',y(t)+4).attr('text-anchor','end').text(t+'%');});
    yrs.forEach((yy,i)=>{if(i%2===0||i===yrs.length-1)sc.append('text').attr('x',x(yy)).attr('y',Hc-6).attr('text-anchor','middle').text(yy===2026?'2026*':yy);});
    const series=[{v:q65,c:'#245b93',lab:'65 anni e più'},{v:q014,c:'#d9705f',lab:'0-14 anni'}];
    const line=d3.line().defined(d=>d[1]!=null).x(d=>x(d[0])).y(d=>y(d[1]));
    series.forEach(s=>{const pts=yrs.map((yy,i)=>[yy,s.v[i]]);
      sc.append('path').attr('d',line(pts)).attr('fill','none').attr('stroke',s.c).attr('stroke-width',2).attr('stroke-linejoin','round');
      const last=pts.filter(p=>p[1]!=null).pop();if(last){sc.append('circle').attr('cx',x(last[0])).attr('cy',y(last[1])).attr('r',4).attr('fill',s.c).attr('stroke','#fff').attr('stroke-width',2);
        sc.append('text').attr('class','hm-lab').attr('x',x(last[0])+8).attr('y',y(last[1])+4).text(fmt(last[1],1)+'%');}});
    const cross=sc.append('line').attr('y1',m.t).attr('y2',Hc-m.b).attr('stroke','#7a8fa5').attr('stroke-dasharray','3 3').attr('opacity',0);
    const tipT=sc.append('text').attr('class','hm-lab').attr('y',m.t+2).attr('opacity',0);
    sc.append('rect').attr('x',m.l).attr('y',m.t).attr('width',Wc-m.l-m.r).attr('height',Hc-m.t-m.b).attr('fill','transparent')
      .on('pointermove',ev=>{const [px]=d3.pointer(ev);const i=d3.minIndex(yrs,yy=>Math.abs(x(yy)-px));const xx=x(yrs[i]);cross.attr('x1',xx).attr('x2',xx).attr('opacity',1);
        tipT.attr('x',Math.min(xx+6,Wc-150)).attr('opacity',1).text(`${yrs[i]}${yrs[i]===2026?' stima':''}: ${fmt(q65[i],1)}% over 65 · ${fmt(q014[i],1)}% 0-14 · ${fmtI(tot[i])} ab.`);})
      .on('pointerleave',()=>{cross.attr('opacity',0);tipT.attr('opacity',0);});
    $('#hm-chart-legend').innerHTML=series.map(s=>`<span><i style="background:${s.c}"></i>${s.lab}</span>`).join('');
    const dd=tot[0]&&tot[tot.length-2]?(tot[tot.length-2]-tot[0])/tot[0]*100:null;
    $('#hm-chart-note').textContent=`Quota sul totale dei residenti al 1° gennaio. Residenti dal 2019 al 2025: ${dd==null?'ND':(dd>0?'+':'')+fmt(dd,1)+'%'}. *2026 è una stima ISTAT.${g!=='c'?' Somma dei comuni dell’anno.':''}`;
  }
  function renderContext(c0){
    const g=state.gran,code=g==='m'?(c0.m==='C'?'ITE':null):NUTS06[c0.r],area=g==='m'?MACRO[c0.m]:data.regioni[c0.r];
    const av=ref=>data.avq[`${ref}|2024`]||{},it=av('IT'),r=code?av(code):{},vol=(ref,f)=>data.vol[`${ref}|${f}`];
    const line=(lab,a,b)=>`<div><span>${lab}</span><b>${a==null?'ND':fmt(a,1)+'%'} <small>Italia ${b==null?'ND':fmt(b,1)+'%'}</small></b></div>`;
    $('#hm-context').innerHTML=`<h3>Relazioni e volontariato · ${e(area)}${code?'':' (dato non disponibile)'}</h3><div class="hm-ctx">
      ${line('Non incontra mai amici nel tempo libero (6+ anni, 2024)',r['6_NEVER'],it['6_NEVER'])}
      ${line('Dichiara di non avere amici (6+ anni, 2024)',r['6_NFRIEND'],it['6_NFRIEND'])}
      ${line('Volontariato in organizzazioni (15+ anni, 2023)',code?vol(code,'ORGVOL'):null,vol('IT','ORGVOL'))}
      ${line('Aiuto diretto senza organizzazione (15+ anni, 2023)',code?vol(code,'DIRVOL'):null,vol('IT','DIRVOL'))}</div>
      <p class="hm-sub">Dati regionali ISTAT: valgono per tutta la regione, non per il singolo comune.</p>`;
  }
  const choose=code=>{state.sel=code;renderDetail();highlight();save();};
  const tip=$('#hm-tip'),box=$('.hm-mapbox');
  units.on('pointermove',(ev,f)=>{const c=byCode.get(f.properties.PRO_COM_T);if(!c)return;const k=groupKey(c,state.gran),a=curAgg.get(k);
      tip.hidden=false;tip.innerHTML=`<b>${e(groupName(k,state.gran))}</b>${state.gran==='c'?`<span>${e(c.p)}</span><br>`:''}<span>${e(curInd.label)}: ${fmt(a?a.v:null,curInd.d)}</span>`;
      const r=box.getBoundingClientRect();let x=ev.clientX-r.left+14;const y=ev.clientY-r.top+14;if(x>r.width-250)x-=270;tip.style.left=x+'px';tip.style.top=y+'px';d3.select(ev.currentTarget).classed('hm-hot',true).raise();})
    .on('pointerleave',ev=>{tip.hidden=true;d3.select(ev.currentTarget).classed('hm-hot',false);})
    .on('click',(ev,f)=>{if(byCode.has(f.properties.PRO_COM_T))choose(f.properties.PRO_COM_T);});
  $('#hm-ind').onchange=ev=>{state.ind=ev.target.value;render();};
  $('#hm-gran').onclick=ev=>{const b=ev.target.closest('button');if(b){state.gran=b.dataset.v;render();}};
  $('#hm-avg').onclick=ev=>{const b=ev.target.closest('button');if(b){state.avg=b.dataset.v;render();}};
  $('.hm-tables').onclick=ev=>{const tr=ev.target.closest('tr.hm-row');if(!tr)return;const k=tr.dataset.k;choose(state.gran==='c'?k:(data.comuni.find(c=>groupKey(c,state.gran)===k)||{}).c||state.sel);};
  if(onMethod)$('#hm-method').onclick=onMethod;
  const q=$('#hm-q'),sug=$('#hm-suggest');const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  q.oninput=()=>{const t=norm(q.value.trim());if(t.length<2){sug.hidden=true;return;}
    const hits=data.comuni.filter(c=>norm(c.n).startsWith(t)).concat(data.comuni.filter(c=>!norm(c.n).startsWith(t)&&norm(c.n).includes(t))).slice(0,8);
    sug.innerHTML=hits.map(c=>`<button type="button" data-c="${e(c.c)}">${e(c.n)}<small>${e(c.p)}</small></button>`).join('')||'<button type="button" disabled>Nessun comune</button>';sug.hidden=false;};
  sug.onclick=ev=>{const b=ev.target.closest('button[data-c]');if(!b)return;ev.preventDefault();q.value='';sug.hidden=true;choose(b.dataset.c);};
  q.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();sug.querySelector('button[data-c]')?.click();}if(ev.key==='Escape')sug.hidden=true;};
  render();
  return ()=>{host.innerHTML='';};
}
