import {defineConfig} from 'vite';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pkg=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));
let gitVersion='';
try{gitVersion=execFileSync('git',['describe','--tags','--match','v[0-9]*','--always'],{encoding:'utf8'}).trim();}catch{}
const appVersion=process.env.APP_VERSION||gitVersion.replace(/^v/,'')||`${pkg.version}-dev`;
export default defineConfig({define:{__APP_VERSION__:JSON.stringify(appVersion)},plugins:[{
 name:'winter-arc-private-rules',
 resolveId(id){if(id==='virtual:app-rules')return '\0virtual:app-rules';},
 load(id){
  if(id!=='\0virtual:app-rules')return;
  const localRules=new URL('../Docs/REGLAS_WINTER_ARC.md',import.meta.url);
  const rules=process.env.APP_RULES_CONTENT||(existsSync(localRules)?readFileSync(localRules,'utf8'):'');
  if(!rules.trim())throw new Error('Configura APP_RULES_CONTENT para construir la pantalla de reglas.');
  return `export default ${JSON.stringify(rules)};`;
 }
},{name:'winter-arc-offline',enforce:'post',generateBundle(_options,bundle){
 const assets=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png',...Object.keys(bundle).filter(name=>/\.(?:js|css|woff2?|ttf|otf)$/.test(name)).map(name=>'/'+name)];
 const template=readFileSync(new URL('./pwa/service-worker.js',import.meta.url),'utf8');
 const version=createHash('sha256').update(JSON.stringify(assets)).update(template).update(readFileSync(new URL('./index.html',import.meta.url))).update(Buffer.concat(['icon-192.png','icon-512.png','maskable-512.png'].map(name=>readFileSync(new URL('./public/icons/'+name,import.meta.url))))).update(readFileSync(new URL('./public/manifest.webmanifest',import.meta.url))).digest('hex').slice(0,16);
 this.emitFile({type:'asset',fileName:'sw.js',source:template.replace('__CACHE__',JSON.stringify('winter-arc-shell-'+version)).replace('__PRECACHE__',JSON.stringify(assets))});
}}]});
