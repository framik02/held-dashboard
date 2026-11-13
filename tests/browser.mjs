import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {encode64,serializeMarkdown,parseMarkdown} from '../core.js';

const files=new Map();let revision=1,failNext=false;
function put(path,raw){files.set(path,{raw,sha:`sha-${revision++}`});}
function task(title,phase,status='todo'){return serializeMarkdown('',{id:title,title,type:'overview',updated:'2026-11-13',status,priority:'high',phase,assignee:'Persona A',assignment:'proposed',due:'',schedule:'proposed',sources:[]},'## Risultato atteso\n\nUna consegna di prova.\n\n## Sottoattività\n\n- [ ] Primo passo\n\n## Commenti\n');}
put('attivita/a.md',task('Preparare la scheda','avvio')+'\n[Stato](../stato.md)\n');
put('attivita/b.md',task('Ascoltare le persone','ascolto','doing'));
put('attivita/c.md',task('Condividere la wiki','avvio','done'));
put('attivita/README.md','---\nphases: {"avvio":{"name":"Avvio del team","period":"Periodo proposto","description":"Un passo comune."}}\n---\n\n# Fasi\n');
put('stato.md','---\ntitle: Stato\nupdated: 2026-11-13\n---\n\n# Stato di prova\n\nContenuto condiviso.\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',err=>errors.push(err.message));
page.on('dialog',dialog=>dialog.accept());
await page.route('**/api/config',route=>route.fulfill({json:{local:true,nonce:'test',repo:'team/wiki'}}));
await page.route('**/api/github/**',async route=>{
  const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace('/api/github','');
  if(endpoint==='/user')return route.fulfill({json:{login:'persona-test'}});
  if(endpoint==='/repos/team/wiki')return route.fulfill({json:{private:true}});
  if(endpoint==='/repos/team/wiki/git/trees/main')return route.fulfill({json:{sha:`tree-${revision}`,tree:[...files].map(([path,file])=>({path,sha:file.sha,type:'blob'}))}});
  const path=decodeURIComponent(endpoint.replace('/repos/team/wiki/contents/',''));
  if(request.method()==='PUT'){
    if(failNext){failNext=false;return route.fulfill({status:503,json:{message:'Rete non disponibile'}});}
    const data=request.postDataJSON(),existing=files.get(path);
    if(existing?.sha!==data.sha)return route.fulfill({status:409,json:{message:'Versione cambiata'}});
    put(path,Buffer.from(data.content,'base64').toString('utf8'));return route.fulfill({json:{content:{sha:files.get(path).sha}}});
  }
  const file=files.get(path);return route.fulfill(file?{json:{encoding:'base64',sha:file.sha,content:encode64(file.raw)}}:{status:404,json:{message:'File non trovato'}});
});
try{
  await page.goto('http://127.0.0.1:4173');await page.getByRole('heading',{name:'Facciamo spazio alle idee.'}).waitFor();await page.getByText('1 di 3 attività completate').waitFor();
  await page.getByRole('button',{name:'Nuova attività'}).click();
  await page.locator('[name=title]').fill('Nuova consegna di prova');await page.locator('[name=assignee]').fill('Persona B');
  await page.locator('[name=body]').fill('## Risultato atteso\n\nConsegna verificata.\n\n- [ ] Preparare il materiale');
  await page.locator('[data-check]').check();await page.locator('[name=comment]').fill('Prima nota ✅');
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.locator('dialog').waitFor({state:'hidden'});
  const created=[...files].find(([p])=>p.startsWith('attivita/h-'));assert.ok(created);assert.match(created[1].raw,/- \[x\] Preparare/);assert.match(created[1].raw,/Prima nota ✅/);
  await page.getByRole('button',{name:'Attività',exact:false}).filter({has:page.locator('span')}).first().click();
  await page.locator('[data-task="attivita/a.md"]').click();await page.locator('[name=comment]').fill('Nota da preservare');
  const original=files.get('attivita/a.md');put('attivita/a.md',original.raw+'\nAggiornamento esterno.\n');
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.getByText('Il file è cambiato su GitHub', {exact:false}).waitFor();
  assert.equal(await page.locator('[name=comment]').inputValue(),'Nota da preservare');await page.getByRole('button',{name:'Scarica la mia bozza'}).waitFor();
  await page.getByRole('button',{name:'Chiudi',exact:true}).click();
  await page.locator('[data-task="attivita/a.md"]').click();await page.locator('[name=comment]').fill('Seconda nota');
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.match(files.get('attivita/a.md').raw,/Aggiornamento esterno/);assert.match(files.get('attivita/a.md').raw,/Seconda nota/);
  await page.locator('[data-status-task="attivita/a.md"]').selectOption('done');await page.waitForFunction(()=>document.querySelector('.column[data-status="done"] [data-task="attivita/a.md"]'));
  assert.equal(parseMarkdown(files.get('attivita/a.md').raw).meta.status,'done');
  await page.locator('[data-view=wiki]').click();await page.getByRole('heading',{name:'Stato di prova'}).waitFor();await page.getByRole('button',{name:'Modifica pagina',exact:true}).click();
  await page.locator('[name=raw]').fill(files.get('stato.md').raw+'\nNuovo risultato condiviso.\n');failNext=true;
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.getByText('Rete non disponibile',{exact:true}).waitFor();assert.match(await page.locator('[name=raw]').inputValue(),/Nuovo risultato/);
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Nuovo risultato condiviso.',{exact:true}).waitFor();
  put('stato.md',files.get('stato.md').raw+'\nArrivato dall’assistente AI.\n');await page.getByRole('button',{name:'Aggiorna da GitHub'}).click();await page.getByText('Arrivato dall’assistente AI.',{exact:true}).waitFor();
  await page.locator('[data-view=board]').click();await page.locator('#filter-assignee').selectOption('Persona B');assert.equal(await page.locator('.task-card').count(),1);await page.locator('#filter-assignee').selectOption('');

  await page.locator('[data-assign="attivita/a.md"]').click();
  await page.locator('[data-owner="Othello"]').click();
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.locator('dialog').waitFor({state:'hidden'});
  assert.equal(parseMarkdown(files.get('attivita/a.md').raw).meta.assignee,'Othello');
  await page.locator('[data-assign="attivita/a.md"]').click();await page.locator('[data-owner=""]').click();
  await page.getByRole('button',{name:'Salva nella wiki'}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.equal(parseMarkdown(files.get('attivita/a.md').raw).meta.assignee,'');
  await page.locator('[data-view=graph]').click();await page.locator('#wiki-graph').waitFor();
  assert.equal(await page.locator('.graph-node').count(),files.size);
  assert.ok(await page.locator('.graph-edge').count()>=1);
  assert.ok(await page.locator('.graph-node .node-label').count()===files.size);
  await page.locator('[data-node="attivita/a.md"] .node-dot').click();
  await page.locator('#graph-detail').getByRole('heading',{name:'Preparare la scheda'}).waitFor();
  await page.getByRole('button',{name:'Apri attività',exact:false}).click();await page.locator('dialog').waitFor();
  await page.getByRole('button',{name:'Chiudi',exact:true}).click();
  await page.locator('#graph-type').selectOption('ascolto');assert.equal(await page.locator('.graph-node').count(),1);
  await page.locator('#graph-type').selectOption('');
  const transform=await page.locator('#graph-world').getAttribute('transform');await page.getByRole('button',{name:'Ingrandisci grafo'}).click();assert.notEqual(await page.locator('#graph-world').getAttribute('transform'),transform);
  await page.getByRole('button',{name:'Centra il grafo'}).click();
  await page.locator('#graph-search').fill('stato.md');await page.getByText('1 nodi', {exact:false}).waitFor();await page.locator('#graph-search').fill('');
  await page.locator('[data-node="stato.md"]').focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Apri pagina',exact:false}).click();await page.getByRole('heading',{name:'Stato di prova'}).waitFor();
  await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.fonts.check('14px Manrope')),true);
  await page.locator('[data-view=overview]').click();await page.screenshot({path:'../held-desktop-test.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const view of ['overview','board','phases','wiki','graph']){await page.locator(`[data-view=${view}]`).click();await page.waitForTimeout(120);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow orizzontale in ${view}`);}
  await page.locator('#wiki-graph').waitFor();await page.screenshot({path:'../held-graph-mobile-test.png',fullPage:true});
  await page.locator('[data-view=board]').click();await page.screenshot({path:'../held-mobile-test.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Browser OK: creazione, sottoattività, commenti, conflitto, recupero errore, stati, modifica wiki, aggiornamento AI, filtri, assegnazione e rimozione responsabile, grafo/filtri/zoom/apertura nodi, font Manrope, desktop e cinque viste mobile.');
}finally{await browser.close();}
