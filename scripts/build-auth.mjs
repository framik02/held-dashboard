import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist-auth');fs.mkdirSync(path.join(output,'fonts'),{recursive:true});fs.mkdirSync(path.join(output,'vendor'),{recursive:true});
for(const file of ['index.html','app.js','core.js','graph.js','mappa.js','vendor/d3.min.js','vendor/topojson.min.js','style.css','icon.svg','fonts/manrope-variable.ttf','fonts/OFL.txt'])fs.copyFileSync(path.join(root,file),path.join(output,file));
fs.writeFileSync(path.join(output,'auth-config.json'),JSON.stringify({managed_auth:true,github_login_url:null})+'\n');
console.log('Asset del login GitHub pronti in dist-auth. Nessuna credenziale inclusa.');
