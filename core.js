export const STATUSES = {todo:'Da fare', doing:'In corso', blocked:'Bloccata', done:'Completata'};
export const PRIORITIES = {high:'Alta', medium:'Media', low:'Bassa'};
export const PHASES = {
  avvio: {name:'Avvio del team', period:'Da concordare', description:'Ruoli, strumenti e un ritmo comune.'},
  ascolto: {name:'Ascolto e contatti', period:'Da concordare', description:'Capire i bisogni e costruire la rete locale.'},
  proposta: {name:'Proposta concreta', period:'Da concordare', description:'Sede, forma giuridica, budget e dossier.'},
  copertura: {name:'Copertura e tutele', period:'Dopo la proposta', description:'Risorse formalizzate e condizioni per partire.'},
  pilota: {name:'Pilota e valutazione', period:'12 settimane dalla copertura', description:'Incontri, risultati e decisione sul secondo ciclo.'}
};
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function parseMarkdown(raw) {
  raw=raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  const match=raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const meta=Object.create(null);
  if(match) for(const line of match[1].split('\n')) {
    const m=line.match(/^([a-z_]+):\s*(.*)$/); if(!m)continue;
    let val=m[2].trim();
    try { val=JSON.parse(val); } catch { if(val.startsWith("'")&&val.endsWith("'")) val=val.slice(1,-1).replace(/''/g,"'"); }
    meta[m[1]]=val;
  }
  return {meta, body:match?raw.slice(match[0].length).replace(/^\n/,''):raw, header:match?match[1]:''};
}
export function serializeMarkdown(original, updates, body) {
  const parsed=parseMarkdown(original); const remaining={...updates};
  const lines=parsed.header?parsed.header.split('\n').map(line=>{
    const key=line.match(/^([a-z_]+):/)?.[1];
    if(key && Object.hasOwn(remaining,key)){const value=remaining[key];delete remaining[key];return `${key}: ${JSON.stringify(value)}`;} return line;
  }):[];
  for(const [key,value] of Object.entries(remaining))lines.push(`${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trimEnd()}\n`;
}
export function toTask(file) {
  const {meta,body}=parseMarkdown(file.raw);
  if(typeof meta.title!=='string' || !meta.title.trim() || !Object.hasOwn(STATUSES,meta.status) || !Object.hasOwn(PHASES,meta.phase) || !Object.hasOwn(PRIORITIES,meta.priority) || (meta.assignee!==undefined&&typeof meta.assignee!=='string')) throw new Error(`Metadati non validi: ${file.path}`);
  return {...meta,...file,body};
}
export function checklist(body) { const rows=body.split('\n'); return rows.flatMap((line,index)=>{const m=line.match(/^\s*- \[([ xX])\] (.*)$/);return m?[{index,checked:m[1]!==' ',label:m[2]}]:[];}); }
export function toggleCheck(body,index,checked) {
  const lines=body.split('\n'); if(!/^\s*- \[[ xX]\] /.test(lines[index]||''))throw new Error('Sottoattività non trovata.');
  lines[index]=lines[index].replace(/\[[ xX]\]/,checked?'[x]':'[ ]');return lines.join('\n');
}
export function addComment(body, author, text, date=new Date().toISOString()) {
  if(!text.trim())return body;
  if(!body.includes('\n## Commenti'))body=body.trimEnd()+'\n\n## Commenti\n';
  const safeAuthor=author.replace(/[^a-zA-Z0-9_-]/g,'');
  return body.trimEnd()+`\n\n### ${date} · @${safeAuthor}\n\n`+text.trim().split('\n').map(l=>`> ${l}`).join('\n')+'\n';
}
export function encode64(text) { const bytes=new TextEncoder().encode(text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary); }
export function decode64(text) { return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0))); }
export function fileURL(path,repo) {return `https://github.com/${repo}/blob/main/`+path.split('/').map(encodeURIComponent).join('/');}
export function safeLink(href,path,repo) {
  if(/^https?:\/\//i.test(href))return href;
  if(/^(mailto:)/i.test(href))return href;
  if(/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//'))return '#';
  try{return new URL(href,fileURL(path,repo)).href;}catch{return '#';}
}
export function markdownHTML(body,path,repo) {
  function inline(text) {
    return escapeHTML(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,url)=>`<a href="${escapeHTML(safeLink(url.replace(/&amp;/g,'&'),path,repo))}" target="_blank" rel="noopener noreferrer">${label}</a>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
  }
  let code=false;
  return body.split('\n').map(line=>{
    if(line.startsWith('```')) {code=!code;return code?'<pre><code>':'</code></pre>';}
    if(code)return escapeHTML(line)+'\n';
    const heading=line.match(/^(#{1,6}) (.*)$/);if(heading)return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if(/^\s*- \[[ xX]\]/.test(line))return `<p class="md-check">${line.includes('[ ]')?'☐':'☑'} ${inline(line.replace(/^\s*- \[[ xX]\] /,''))}</p>`;
    if(/^[-*] /.test(line))return `<p class="md-bullet">• ${inline(line.slice(2))}</p>`;
    if(line.startsWith('>'))return `<blockquote>${inline(line.replace(/^> ?/,''))}</blockquote>`;
    if(line.startsWith('|'))return `<div class="md-table-row">${line.split('|').slice(1,-1).map(x=>`<span>${inline(x.trim())}</span>`).join('')}</div>`;
    return line.trim()?`<p>${inline(line)}</p>`:'';
  }).join('\n')+(code?'</code></pre>':'');
}
