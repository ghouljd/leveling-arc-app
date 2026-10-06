export interface InstallPrompt extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
export let pwaStatus='Preparing offline access…';
export let pwaRegistration:ServiceWorkerRegistration|null=null;
export let installPrompt:InstallPrompt|null=null;
const changed=()=>window.dispatchEvent(new Event('winter-arc-pwa'));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event as InstallPrompt;changed();});
window.addEventListener('appinstalled',()=>{installPrompt=null;pwaStatus='App installed.';changed();});
export async function startPWA(){
 if(!import.meta.env.PROD){pwaStatus='Development mode. Offline access is enabled in the production version.';changed();return;}
 if(!('serviceWorker' in navigator)){pwaStatus='This browser does not support offline access.';changed();return;}
 try{
  const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});pwaRegistration=reg;
  const update=async()=>{
   const paths=['/',...Array.from(document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>('script[src],link[rel="stylesheet"]')).map(element=>new URL(element instanceof HTMLScriptElement?element.src:element.href,location.href).pathname)];
   let complete=false;
   for(const key of (await caches.keys()).filter(key=>key.startsWith('winter-arc-shell-'))){const cache=await caches.open(key);if((await Promise.all(paths.map(path=>cache.match(path)))).every(Boolean)){complete=true;break;}}
   pwaStatus=reg.waiting?'An update is ready. Save your forms before applying it.':reg.active&&navigator.serviceWorker.controller&&complete?'App files are ready for offline access.':'Preparing files and offline access…';changed();
  };
  navigator.serviceWorker.addEventListener('controllerchange',()=>void update());
  reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',update);});update();await navigator.serviceWorker.ready;update();
 }catch{pwaStatus='Could not prepare offline access. Try again while online.';changed();}
}

export async function requestInstall(){const prompt=installPrompt;if(!prompt)return;installPrompt=null;changed();await prompt.prompt();await prompt.userChoice;}
