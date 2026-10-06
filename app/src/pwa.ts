export interface InstallPrompt extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
export let pwaStatus='Preparando apertura sin conexión…';
export let pwaRegistration:ServiceWorkerRegistration|null=null;
export let installPrompt:InstallPrompt|null=null;
const changed=()=>window.dispatchEvent(new Event('winter-arc-pwa'));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event as InstallPrompt;changed();});
window.addEventListener('appinstalled',()=>{installPrompt=null;pwaStatus='Aplicación instalada.';changed();});
export async function startPWA(){
 if(!import.meta.env.PROD){pwaStatus='Modo desarrollo. La apertura sin conexión se activa en la versión de producción.';changed();return;}
 if(!('serviceWorker' in navigator)){pwaStatus='Este navegador no admite la apertura sin conexión.';changed();return;}
 try{
  const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});pwaRegistration=reg;
  const update=async()=>{
   const paths=['/',...Array.from(document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>('script[src],link[rel="stylesheet"]')).map(element=>new URL(element instanceof HTMLScriptElement?element.src:element.href,location.href).pathname)];
   let complete=false;
   for(const key of (await caches.keys()).filter(key=>key.startsWith('winter-arc-shell-'))){const cache=await caches.open(key);if((await Promise.all(paths.map(path=>cache.match(path)))).every(Boolean)){complete=true;break;}}
   pwaStatus=reg.waiting?'Hay una actualización preparada. Guarda los formularios antes de aplicarla.':reg.active&&navigator.serviceWorker.controller&&complete?'Archivos de la aplicación preparados para abrir sin conexión.':'Preparando archivos y control de apertura sin conexión…';changed();
  };
  navigator.serviceWorker.addEventListener('controllerchange',()=>void update());
  reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',update);});update();await navigator.serviceWorker.ready;update();
 }catch{pwaStatus='No se pudo preparar la apertura sin conexión. Reintenta con conexión.';changed();}
}

export async function requestInstall(){const prompt=installPrompt;if(!prompt)return;installPrompt=null;changed();await prompt.prompt();await prompt.userChoice;}
