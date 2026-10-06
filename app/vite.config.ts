import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export default defineConfig({plugins:[{name:'winter-arc-offline',enforce:'post',generateBundle(_options,bundle){
 const assets=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png',...Object.keys(bundle).filter(name=>name.endsWith('.js')||name.endsWith('.css')).map(name=>'/'+name)];
 const template=readFileSync(new URL('./pwa/service-worker.js',import.meta.url),'utf8');
 const version=createHash('sha256').update(JSON.stringify(assets)).update(template).update(readFileSync(new URL('./index.html',import.meta.url))).update(Buffer.concat(['icon-192.png','icon-512.png','maskable-512.png'].map(name=>readFileSync(new URL('./public/icons/'+name,import.meta.url))))).update(readFileSync(new URL('./public/manifest.webmanifest',import.meta.url))).digest('hex').slice(0,16);
 this.emitFile({type:'asset',fileName:'sw.js',source:template.replace('__CACHE__',JSON.stringify('winter-arc-shell-'+version)).replace('__PRECACHE__',JSON.stringify(assets))});
}}]});
