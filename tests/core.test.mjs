import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdown,serializeMarkdown,toTask,addComment,toggleCheck,checklist,encode64,decode64,markdownHTML,safeLink} from '../core.js';
import {allowedEndpoint} from '../server.mjs';

const source='---\ntitle: "Ascoltare le persone"\nstatus: todo\nphase: ascolto\npriority: high\nsources: [../agenda.md]\ncustom: valore da conservare\n---\n\n## Note\n\n- [ ] Interviste\n- [x] Traccia pronta\n';
test('Il roundtrip conserva fonti, metadati sconosciuti e testo',()=>{
  const next=serializeMarkdown(source,{status:'doing',title:'Persone: bisogni e "idee"'},parseMarkdown(source).body);
  assert.equal(parseMarkdown(next).meta.status,'doing');assert.equal(parseMarkdown(next).meta.title,'Persone: bisogni e "idee"');assert.match(next,/sources: \[\.\.\/agenda.md\]/);assert.match(next,/custom: valore da conservare/);assert.match(next,/- \[x\] Traccia pronta/);
});
test('Supporta BOM e terminatori Windows senza perdere testo',()=>{assert.equal(parseMarkdown('\uFEFF'+source.replaceAll('\n','\r\n')).meta.status,'todo');});
test('Le sottoattività cambiano solo la riga richiesta',()=>{const body=parseMarkdown(source).body;const rows=checklist(body);assert.equal(rows.length,2);assert.equal(checklist(toggleCheck(body,rows[0].index,true))[0].checked,true);assert.throws(()=>toggleCheck(body,0,true));});
test('Commenti in append, Unicode integro e autore riconoscibile',()=>{const a=addComment('## Note\nTesto','flavio','Una possibilità ✅','2026-11-13T20:00:00Z');const b=addComment(a,'franco','Ricevuto\nGrazie','2026-11-13T21:00:00Z');assert.equal(b.match(/## Commenti/g).length,1);assert.match(b,/@flavio/);assert.match(b,/@franco/);assert.equal(decode64(encode64(b)),b);});
test('Metadati errati non diventano attività silenziosamente',()=>{assert.equal(toTask({raw:source,path:'attivita/a.md'}).status,'todo');assert.throws(()=>toTask({raw:source.replace('todo','inventato'),path:'attivita/a.md'}));});
test('Il frontmatter non può cambiare percorso, SHA o sorgente della scheda',()=>{const raw=source.replace('status: todo','status: todo\npath: decisioni.md\nsha: falso\nraw: falso');const t=toTask({raw,path:'attivita/a.md',sha:'vero'});assert.equal(t.path,'attivita/a.md');assert.equal(t.sha,'vero');assert.equal(t.raw,raw);});
test('Il renderer non esegue HTML o URL javascript',()=>{const html=markdownHTML('<script>alert(1)</script>\n[x](javascript:alert)\n[wiki](../stato.md)','docs/a.md','team/wiki');assert.doesNotMatch(html,/<script/);assert.doesNotMatch(html,/href="javascript/);assert.match(html,/https:\/\/github.com\/team\/wiki\/blob\/main\/stato.md/);assert.equal(safeLink('data:text/html,abc','a.md','a/b'),'#');});
test('Il proxy locale limita repository, endpoint e file scrivibili',()=>{
  const repo='team/wiki';assert.equal(allowedEndpoint('/repos/team/wiki/contents/attivita/h-1.md','PUT',repo),true);assert.equal(allowedEndpoint('/repos/team/wiki/contents/.github/workflows/run.yml','PUT',repo),false);assert.equal(allowedEndpoint('/repos/other/wiki/contents/a.md','PUT',repo),false);assert.equal(allowedEndpoint('/repos/team/wiki/contents/%2e%2e/a.md','PUT',repo),false);assert.equal(allowedEndpoint('/repos/team/wiki/contents/a.md','DELETE',repo),false);assert.equal(allowedEndpoint('/user','GET',repo),true);
});

test('Le aree mancanti o nuove restano leggibili senza alterare la scheda',()=>{const file={path:'attivita/a.md',raw:source};assert.equal(toTask(file).category,undefined);const raw=serializeMarkdown(source,{category:'sviluppo'},parseMarkdown(source).body);assert.equal(toTask({...file,raw}).category,'sviluppo');const custom=serializeMarkdown(raw,{category:'nuova-area'},parseMarkdown(raw).body);assert.equal(toTask({...file,raw:custom}).category,'nuova-area');assert.match(custom,/custom: valore da conservare/);assert.throws(()=>toTask({...file,raw:serializeMarkdown(source,{category:[]},parseMarkdown(source).body)}));});
