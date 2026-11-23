import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTACH_PATH,cleanChat,chatBlock,parseChat} from '../core.js';
import {allowed,isAttachmentPath,isAttachmentEndpoint} from '../auth/worker.mjs';
import {allowedEndpoint} from '../server.mjs';

test('i messaggi della chat si scrivono e si rileggono', () => {
  const a=chatBlock({id:'m-1',at:'2026-11-23T20:00:00.000Z',by:'framik02',name:'Franco',when:'23 novembre 2026, 21:00',text:'Ciao\nseconda riga'});
  const b=chatBlock({id:'m-2',at:'2026-11-23T20:05:00.000Z',by:'fcrucianii',name:'Flavio',when:'x',text:'finto <!-- held-msg id="m-9" at="1" --> dentro'});
  const raw='---\ntitle: Chat\n---\n\n# Chat\n\nIntro.\n\n'+a+'\n'+b;
  const msgs=parseChat(raw,'chat/2026-11.md');
  assert.equal(msgs.length,2);
  assert.deepEqual(msgs.map(m=>[m.id,m.by]),[['m-1','framik02'],['m-2','fcrucianii']]);
  assert.equal(msgs[0].text,'Ciao\nseconda riga');
  assert.ok(!msgs[1].text.includes('<!--'));
  assert.equal(parseChat(raw.replace(/\n/g,'\r\n')).length,2);
  assert.equal(cleanChat('   '),'');assert.equal(cleanChat('x'.repeat(5000)).length,4000);
});

test('allegati: solo nella cartella allegati, nomi semplici e formati ammessi', () => {
  const repo='team/wiki',p=x=>`/repos/team/wiki/contents/${x}`;
  for(const ok of ['allegati/2026-11-23-preventivo.pdf','allegati/2026-11-23-foto-2.jpg'])assert.ok(ATTACH_PATH.test(ok)&&isAttachmentPath(ok),ok);
  for(const bad of ['allegati/../x.pdf','allegati/.x.pdf','allegati/a.exe','allegati/a.html','allegati/A.pdf','docs/a.pdf','allegati/sub/a.pdf','allegati/a.svg'])assert.equal(isAttachmentPath(bad),false,bad);
  for(const check of [(e,m)=>allowed(e,m,repo),(e,m)=>allowedEndpoint(e,m,repo)]){
    assert.ok(check(p('allegati/2026-11-23-a.pdf'),'PUT'));
    assert.ok(check(p('allegati/2026-11-23-a.pdf'),'DELETE'));
    assert.equal(check(p('allegati/2026-11-23-a.pdf'),'GET'),false);
    assert.equal(check(p('allegati/a.exe'),'PUT'),false);
    assert.equal(check(p('allegati/a.pdf')+'?ref=main','PUT'),false);
    assert.equal(check('/repos/other/wiki/contents/allegati/a.pdf','PUT'),false);
    assert.ok(check(p('chat/2026-11.md'),'PUT'));
    assert.equal(check(p('chat/2026-11.md'),'DELETE'),false);
  }
  assert.ok(isAttachmentEndpoint(p('allegati/a.pdf'),repo));assert.equal(isAttachmentEndpoint(p('docs/a.md'),repo),false);
});
