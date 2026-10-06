import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('PWA: instalación completa, navegación offline, Supabase fuera de caché y actualización explícita',async()=>{
 const handlers:Record<string,(e:any)=>void>={},stores=new Map<string,Map<string,Response>>();stores.set('winter-arc-shell-old',new Map());stores.set('other-app',new Map());let claimed=0,activated=0,networkCalls=0;
 const caches={open:async(key:string)=>{let store=stores.get(key);if(!store){store=new Map();stores.set(key,store);}return {addAll:async(paths:string[])=>{for(const path of paths)store!.set(path,new Response(`cached:${path}`));},match:async(path:string)=>store!.get(path)?.clone()};},keys:async()=>[...stores.keys()],delete:async(key:string)=>stores.delete(key)};
 const template=await readFile(new URL('../pwa/service-worker.js',import.meta.url),'utf8');
 vm.runInNewContext(template.replace('__CACHE__',JSON.stringify('winter-arc-shell-new')).replace('__PRECACHE__',JSON.stringify(['/','/index.html','/assets/main.js'])),{URL,Response,caches,fetch:async()=>{networkCalls++;throw new Error('offline');},self:{location:{origin:'http://localhost'},clients:{claim:async()=>{claimed++;}},skipWaiting:()=>activated++,addEventListener:(kind:string,fn:any)=>handlers[kind]=fn}});
 async function lifecycle(kind:string){let task:Promise<unknown>|undefined;handlers[kind]({waitUntil:(p:Promise<unknown>)=>task=p});await task;}
 await lifecycle('install');assert.equal(activated,0);await lifecycle('activate');assert.equal(claimed,1);assert.equal(stores.has('winter-arc-shell-old'),false);assert.equal(stores.has('other-app'),true);
 function request(url:string,mode='cors',method='GET'){let response:Promise<unknown>|undefined;handlers.fetch({request:{url,mode,method},respondWith:(p:Promise<unknown>)=>response=p});return response;}
 assert.equal(await (await request('http://localhost/some/page','navigate') as Response).text(),'cached:/');assert.equal(await (await request('http://localhost/assets/main.js') as Response).text(),'cached:/assets/main.js');
 assert.equal(request('https://backend.example.invalid/rest/v1/account'),undefined);assert.equal(request('http://localhost/rpc','cors','POST'),undefined);assert.equal(networkCalls,0);
 handlers.message({data:{type:'ACTIVATE_UPDATE'}});assert.equal(activated,1);
});
test('PWA: si falla precargar un archivo, no confirma una instalación incompleta',async()=>{
 const handlers:Record<string,(e:any)=>void>={};const template=await readFile(new URL('../pwa/service-worker.js',import.meta.url),'utf8');
 vm.runInNewContext(template.replace('__CACHE__','"test"').replace('__PRECACHE__','["/index.html"]'),{caches:{open:async()=>({addAll:async()=>{throw new Error('download failed');}})},self:{addEventListener:(kind:string,fn:any)=>handlers[kind]=fn}});
 let task:Promise<unknown>|undefined;handlers.install({waitUntil:(p:Promise<unknown>)=>task=p});await assert.rejects(task!,/download failed/);
});

test('Safari: HTML previamente redirigido se reconstruye sin redirect',async()=>{
 const handlers:Record<string,(e:any)=>void>={};
 const cached=new Response('<html>Winter Arc</html>',{headers:{'Content-Type':'text/html'}});
 Object.defineProperty(cached,'redirected',{value:true});
 const template=await readFile(new URL('../pwa/service-worker.js',import.meta.url),'utf8');
 vm.runInNewContext(template.replace('__CACHE__','"test"').replace('__PRECACHE__','["/"]'),{URL,Response,caches:{open:async()=>({match:async(path:string)=>path==='/'?cached:undefined})},fetch:async()=>{throw new Error('offline');},self:{location:{origin:'https://app.example.invalid'},addEventListener:(kind:string,fn:any)=>handlers[kind]=fn}});
 let task:Promise<Response>|undefined;
 handlers.fetch({request:{url:'https://app.example.invalid/',method:'GET',mode:'navigate',redirect:'manual'},respondWith:(p:Promise<Response>)=>task=p});
 const response=await task!;assert.equal(response.redirected,false);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'text/html');assert.equal(await response.text(),'<html>Winter Arc</html>');
});
