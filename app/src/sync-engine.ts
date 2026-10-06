import {db,mergeSnapshot,syncKinds,commandEntity,isDayClosed} from './storage.ts';
import type {Operation,RemoteResult,Snapshot} from './storage';
export interface SyncRemote {
 auth:{getUser:()=>Promise<{data:{user:{id:string}|null};error:unknown}>};
 rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message:string}|null}>;
}
export async function synchronizeStore(store:typeof db,remote:SyncRemote,activeStore:()=>typeof db=()=>db){
 const {data:{user},error:authError}=await remote.auth.getUser();
 if(authError||!user)throw new Error('Connect and sign in to sync. Your data remains saved.');
 if(store.name!==`winter-arc-player-${user.id}`)throw new Error('The account changed. Please try again.');
 const {error:bootstrapError}=await remote.rpc('wa_bootstrap');
 if(bootstrapError)throw new Error('Could not connect to the database.');
 const all=(await store.operations.toArray()).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
 const expiredRemoved:{collection:string;key:string}[]=[];
 let forceFull=false;
 for(const op of all.filter(o=>o.status==='discarded'&&o.serverResult?.category==='closed-day')){
  if(syncKinds.includes(op.kind))expiredRemoved.push({collection:op.kind==='set-decision'?'decisions':'entries',key:commandEntity(op).id});
  forceFull=true;
 }
 const blocked=new Set(all.filter(o=>o.status==='conflict'&&o.entityKey).map(o=>o.entityKey));
 for(const op of all){
  if(activeStore()!==store)throw new Error('The account changed; sync stopped.');
  if(op.status!=='pending'||(!syncKinds.includes(op.kind)&&op.kind!=='close-preview'&&op.kind!=='purchase'&&op.kind!=='conflict-resolution')||(op.entityKey&&blocked.has(op.entityKey)))continue;
  if(op.kind==='close-preview'){
   const newer=(await store.operations.where('day').equals(op.day).toArray()).some(o=>syncKinds.includes(o.kind)&&(o.sequence||0)>(op.sequence||0)&&o.status!=='discarded');
   if(newer){await store.operations.update(op.id,{status:'conflict',serverResult:{status:'conflict',category:'close',message:'You recorded changes after preparing this closure. Review a new closure with the current records.'}});continue;}
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
  if(error?.code==='P0001'&&error.message==='Day is closed. Records can no longer be changed.'){
   // Preserve rejected drafts in the audit queue, and restore the authoritative day.
   for(const related of all.filter(o=>o.day===op.day&&(o.status==='pending'||o.status==='conflict')&&(syncKinds.includes(o.kind)||o.kind==='close-preview'))){
    await store.operations.update(related.id,{status:'discarded',serverResult:{status:'conflict',category:'closed-day',message:error.message}});
    related.status='discarded';
    if(syncKinds.includes(related.kind))expiredRemoved.push({collection:related.kind==='set-decision'?'decisions':'entries',key:commandEntity(related).id});
   }
   forceFull=true;continue;
  }
  if(error&&op.kind==='purchase'&&error.code==='P0001'){
   const messages:Record<string,string>={'Insufficient confirmed MC':'Insufficient confirmed balance: you need 250 MC.','Weekly inventory exhausted':'You have reached this ticket\'s weekly limit.','Choose a future occasion in current season week':'Choose a future occasion in the selected week and within the season.','A ticket is already assigned to that night':'You already have a ticket for that night.'};
   await store.operations.update(op.id,{status:'discarded',serverResult:{status:'conflict',message:messages[error.message]||'Purchase rejected. Check the details and submit a new request.'}});continue;
  }
  if(error)throw new Error(error.code==='PGRST202'?'Apply this stage\'s migration in Supabase to enable the operation.':'The server could not accept a record. The queue is preserved; check its date and details before retrying.');
  const result=data as RemoteResult;
  if(result.status!=='accepted'&&result.status!=='conflict')throw new Error('Unexpected response. The operation is preserved for retrying.');
  await store.operations.update(op.id,{status:result.status,serverResult:result});
  if(result.status==='conflict'&&op.entityKey)blocked.add(op.entityKey);
 }
 const expiredConflictDays=new Set(all.filter(o=>o.status==='conflict'&&syncKinds.includes(o.kind)&&isDayClosed(o.day)).map(o=>o.day));
 for(const op of all.filter(o=>(o.status==='conflict'||o.status==='pending')&&syncKinds.includes(o.kind)&&expiredConflictDays.has(o.day))){
  await store.operations.update(op.id,{status:'discarded',serverResult:{status:'conflict',category:'closed-day',message:'Day is closed. Records can no longer be changed.'}});
  expiredRemoved.push({collection:op.kind==='set-decision'?'decisions':'entries',key:commandEntity(op).id});forceFull=true;
 }
 const saved=(await store.meta.get('account'))?.value;
 let cursor=saved?.importedUnverified?null:saved?.syncCursor??null;
 let snapshot:Snapshot|null=null;
 const removed:{collection:string;key:string}[]=[...expiredRemoved];
 const collections=['entries','decisions','days','evaluations','movements'] as const;
 const records=new Map<string,Map<string,unknown>>(collections.map(key=>[key,new Map()]));
 let incremental=!forceFull;
 for(;incremental;){
  const {data,error}=await remote.rpc('wa_sync_page',{p_cursor:cursor,p_limit:200});
  if(error?.code==='PGRST202'){incremental=false;break;}
  if(error)throw new Error('Could not download the page. The cursor and local data are preserved.');
  const page=data as {cursor:number;hasMore:boolean;snapshot:Snapshot;removed:{collection:string;key:string}[]};
  if(!Number.isSafeInteger(page.cursor)||page.cursor<0||(cursor!==null&&page.cursor<cursor)||(page.hasMore&&page.cursor===cursor)||page.snapshot?.schemaVersion!==2)throw new Error('Incompatible remote page; no changes were applied.');
  for(const item of page.removed){removed.push(item);records.get(item.collection)?.delete(item.key);}
  for(const key of collections)for(const value of page.snapshot[key]||[])records.get(key)!.set(value.id,value);
  snapshot={...page.snapshot,syncCursor:page.cursor};cursor=page.cursor;
  if(activeStore()!==store)throw new Error('The account changed; download stopped.');
  if(!page.hasMore)break;
 }
 if(!incremental){
  let {data,error}=await remote.rpc('wa_account_snapshot');
  if(error?.code==='PGRST202')({data,error}=await remote.rpc('wa_draft_snapshot'));
  if(error)throw new Error('Could not download history. Try again while online.');
  snapshot=data as Snapshot;
 }else if(snapshot){
  for(const key of collections)(snapshot as unknown as Record<string,unknown>)[key]=Array.from(records.get(key)!.values());
 }
 if(!snapshot)throw new Error('Empty download');
 if(activeStore()!==store)throw new Error('The account changed; download stopped.');
 await mergeSnapshot(store,snapshot,removed);
 for(const op of await store.operations.toArray())if(op.status==='discarded'&&op.serverResult?.category==='closed-day')await store.operations.update(op.id,{serverResult:{...op.serverResult,category:'closed-day-restored'}});
 const unresolved=(await store.operations.toArray()).filter((o:Operation)=>o.status==='conflict').length;
 return forceFull?'Closed days synced. Late changes were discarded.':unresolved?`${unresolved} changes need review.`:snapshot.balances?'Records and accounting synced.':'Records synced. Closures do not yet credit rewards.';
}
