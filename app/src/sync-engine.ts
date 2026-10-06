import {db,mergeSnapshot,syncKinds} from './storage.ts';
import type {Operation,RemoteResult,Snapshot} from './storage';
export interface SyncRemote {
 auth:{getUser:()=>Promise<{data:{user:{id:string}|null};error:unknown}>};
 rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message:string}|null}>;
}
export async function synchronizeStore(store:typeof db,remote:SyncRemote,activeStore:()=>typeof db=()=>db){
 const {data:{user},error:authError}=await remote.auth.getUser();
 if(authError||!user)throw new Error('Conéctate e inicia sesión para sincronizar. Los datos siguen guardados.');
 if(store.name!==`winter-arc-player-${user.id}`)throw new Error('La cuenta cambió. Vuelve a intentar.');
 const {error:bootstrapError}=await remote.rpc('wa_bootstrap');
 if(bootstrapError)throw new Error('No se pudo conectar con la base de datos.');
 const all=(await store.operations.toArray()).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
 const blocked=new Set(all.filter(o=>o.status==='conflict'&&o.entityKey).map(o=>o.entityKey));
 for(const op of all){
  if(activeStore()!==store)throw new Error('La cuenta cambió; sincronización detenida.');
  if(op.status!=='pending'||(!syncKinds.includes(op.kind)&&op.kind!=='close-preview'&&op.kind!=='purchase'&&op.kind!=='conflict-resolution')||(op.entityKey&&blocked.has(op.entityKey)))continue;
  if(op.kind==='close-preview'){
   const newer=(await store.operations.where('day').equals(op.day).toArray()).some(o=>syncKinds.includes(o.kind)&&(o.sequence||0)>(op.sequence||0)&&o.status!=='discarded');
   if(newer){await store.operations.update(op.id,{status:'conflict',serverResult:{status:'conflict',category:'close',message:'Registraste cambios después de preparar este cierre. Revisa un cierre nuevo con los datos actuales.'}});continue;}
   const unaccepted=(await store.operations.where('day').equals(op.day).toArray()).some(o=>syncKinds.includes(o.kind)&&(o.status==='pending'||o.status==='conflict'));
   if(unaccepted)continue;
  }
  const purchase=op.payload as {product:string;assignedAt:string;label:string;sleepDay?:string};
  const {data,error}=op.kind==='conflict-resolution'
   ?await remote.rpc('wa_audit_resolution',{p_operation:op.id,p_payload:op.payload})
   :op.kind==='purchase'
   ?await remote.rpc('wa_buy_ticket',{p_operation:op.id,p_product:purchase.product,p_assigned_at:purchase.assignedAt,p_label:purchase.label,p_sleep_day:purchase.sleepDay||null})
   :op.kind==='close-preview'
   ?await remote.rpc('wa_close',{p_operation:op.id,p_payload:op.payload})
   :await remote.rpc('wa_apply_draft',{p_operation:op.id,p_kind:op.kind,p_payload:op.payload,p_base_revision:op.baseRevision||0});
  if(error&&op.kind==='purchase'&&error.code==='P0001'){
   const messages:Record<string,string>={'Insufficient confirmed MC':'Saldo confirmado insuficiente: necesitas 250 MC.','Weekly inventory exhausted':'Ya alcanzaste el cupo semanal de este ticket.','Choose a future occasion in current season week':'Elige una ocasión futura de la semana seleccionada y dentro de la temporada.','A ticket is already assigned to that night':'Ya tienes un ticket para esa noche.'};
   await store.operations.update(op.id,{status:'discarded',serverResult:{status:'conflict',message:messages[error.message]||'Compra rechazada. Revisa los datos e intenta una nueva solicitud.'}});continue;
  }
  if(error)throw new Error(error.code==='PGRST202'?'Ejecuta la migración de esta etapa en Supabase para habilitar la operación.':'El servidor no pudo aceptar un registro. La cola está conservada; revisa su fecha y datos antes de reintentar.');
  const result=data as RemoteResult;
  if(result.status!=='accepted'&&result.status!=='conflict')throw new Error('Respuesta inesperada. La operación se conserva para reintentar.');
  await store.operations.update(op.id,{status:result.status,serverResult:result});
  if(result.status==='conflict'&&op.entityKey)blocked.add(op.entityKey);
 }
 const saved=(await store.meta.get('account'))?.value;
 let cursor=saved?.importedUnverified?null:saved?.syncCursor??null;
 let snapshot:Snapshot|null=null;
 const removed:{collection:string;key:string}[]=[];
 const collections=['entries','decisions','days','evaluations','movements'] as const;
 const records=new Map<string,Map<string,unknown>>(collections.map(key=>[key,new Map()]));
 let incremental=true;
 for(;;){
  const {data,error}=await remote.rpc('wa_sync_page',{p_cursor:cursor,p_limit:200});
  if(error?.code==='PGRST202'){incremental=false;break;}
  if(error)throw new Error('No se pudo descargar la página. El cursor y los datos locales se conservan.');
  const page=data as {cursor:number;hasMore:boolean;snapshot:Snapshot;removed:{collection:string;key:string}[]};
  if(!Number.isSafeInteger(page.cursor)||page.cursor<0||(cursor!==null&&page.cursor<cursor)||(page.hasMore&&page.cursor===cursor)||page.snapshot?.schemaVersion!==2)throw new Error('Página remota incompatible; no se aplicaron cambios.');
  for(const item of page.removed){removed.push(item);records.get(item.collection)?.delete(item.key);}
  for(const key of collections)for(const value of page.snapshot[key]||[])records.get(key)!.set(value.id,value);
  snapshot={...page.snapshot,syncCursor:page.cursor};cursor=page.cursor;
  if(activeStore()!==store)throw new Error('La cuenta cambió; descarga detenida.');
  if(!page.hasMore)break;
 }
 if(!incremental){
  let {data,error}=await remote.rpc('wa_account_snapshot');
  if(error?.code==='PGRST202')({data,error}=await remote.rpc('wa_draft_snapshot'));
  if(error)throw new Error('No se pudo descargar el historial. Reintenta con conexión.');
  snapshot=data as Snapshot;
 }else if(snapshot){
  for(const key of collections)(snapshot as unknown as Record<string,unknown>)[key]=Array.from(records.get(key)!.values());
 }
 if(!snapshot)throw new Error('Descarga vacía');
 if(activeStore()!==store)throw new Error('La cuenta cambió; descarga detenida.');
 await mergeSnapshot(store,snapshot,removed);
 const unresolved=(await store.operations.toArray()).filter((o:Operation)=>o.status==='conflict').length;
 return unresolved?`${unresolved} cambios requieren revisión.`:snapshot.balances?'Registros y contabilidad sincronizados.':'Registros sincronizados. Los cierres todavía no acreditan premios.';
}
