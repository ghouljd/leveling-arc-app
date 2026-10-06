import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { RestoreReview } from './backup';
import type { Result } from './domain/game';
export interface Entry { id:string; day:string; mission:string; quantity:number; unit:string; note:string; occurredAt:string; revision?:number; correctionReason?:string; ticketId?:string;mealAt?:string;mealLabel?:string }
export interface Decision { id:string; day:string; mission:string; result:Result; detail:string; revision?:number }
export interface RemoteResult { status:'accepted'|'conflict'; revision?:number; current?:Entry|Decision|null; currentRevision?:number;category?:string;message?:string }
export interface Operation { id:string; day:string; kind:string; payload:unknown; createdAt:string; status:'pending'|'accepted'|'conflict'|'discarded'; sequence?:number; entityKey?:string; baseRevision?:number; serverResult?:RemoteResult }
export interface Objectives {status:string;rank:string;pushups:number;abs:number;squats:number;steps:number;reading:number}
export interface Day {id:string;day:string;objectives:Objectives;ruleVersion?:string;closedAt?:string}
export interface Evaluation {id:string;day:string;mission:string;result:Result;xp:number;mc:number}
export interface Movement {id:string;resource:'xp'|'mc';amount:number;cause:string;accreditedAt:string;reversesId?:string;day?:string;mission?:string;operationId?:string;reference?:string;label?:string;product?:string}
export interface Ticket {id:string;product:"food"|"sleep";weekStart:string;assignedAt:string;wakeDay?:string;label:string;purchasedAt:string;expiresOn:string;state:"assigned"|"used"|"expired"}
export interface Snapshot { automaticDayClosureEnabled?:boolean;simpleSleepEnabled?:boolean;automaticAccountingEnabled?:boolean; entryCorrectionsEnabled?:boolean;syncCursor?:number; schemaVersion:number; revision:number; entries:Entry[]; decisions:Decision[];days?:Day[];evaluations?:Evaluation[];movements?:Movement[];balances?:{xp:number;mc:number};level?:number;tickets?:Ticket[];flexibility?:{weekStart:string;night:string}[];shopEnabled?:boolean;sleepReference?:'wake-day';historyEnabled?:boolean;airofitEnabled?:boolean;missionCount?:number;importedUnverified?:boolean }
export const syncKinds=['add-entry','correct-entry','set-decision'];
export function commandEntity(op:Operation):Entry|Decision {
 return (op.kind==='correct-entry'?(op.payload as {corrected:Entry}).corrected:op.payload) as Entry|Decision;
}
export function entityKey(kind:string,entity:Entry|Decision){return `${kind==='set-decision'?'decision':'entry'}:${entity.id}`;}
class WinterDB extends Dexie {
 restores!:Table<RestoreReview,string>;entries!:Table<Entry,string>; decisions!:Table<Decision,string>; operations!:Table<Operation,string>;
 days!:Table<Day,string>;evaluations!:Table<Evaluation,string>;movements!:Table<Movement,string>;meta!:Table<{id:string;value:Snapshot},string>;
 constructor(name='winter-arc-local-v1'){
 super(name);this.version(1).stores({entries:'id,day,mission',decisions:'id,day,mission',operations:'id,day,status'});
 this.version(2).stores({entries:'id,day,mission',decisions:'id,day,mission',operations:'id,day,status,sequence,entityKey'}).upgrade(async tx=>{
  const ops=(await tx.table('operations').toArray() as Operation[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const revisions=new Map<string,number>();
  for(const [index,op] of ops.entries()){
   op.sequence=index+1;
   if(syncKinds.includes(op.kind)){
    const entity=commandEntity(op);const key=entityKey(op.kind,entity);op.entityKey=key;
    op.baseRevision=revisions.get(key)||0;revisions.set(key,op.baseRevision+1);
    const table=op.kind==='set-decision'?'decisions':'entries';
    await tx.table(table).update(entity.id,{revision:op.baseRevision+1});
   }
   await tx.table('operations').put(op);
  }
 });
 this.version(3).stores({days:'id,day',evaluations:'id,day,mission',movements:'id',meta:'id'});
 this.version(4).stores({restores:'id,status,type'});
 }
}
export let db=new WinterDB();
export function selectPlayerStorage(userId:string){
 const name=`winter-arc-player-${userId}`;if(db.name===name)return;
 db.close();db=new WinterDB(name);
}
export function localDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function isDayClosed(day:string,today=localDay()){return day<previousDay(today);}
export function assertDayEditable(day:string){
 if(isDayClosed(day))throw new Error('Day is closed. Records can no longer be changed.');
 if(day>localDay())throw new Error('Future days cannot be recorded.');
}
async function enqueue(store:WinterDB,op:Omit<Operation,'id'|'status'|'sequence'|'createdAt'>){
 const sequence=(await store.operations.orderBy('sequence').last())?.sequence||0;
 await store.operations.add({...op,id:crypto.randomUUID(),status:'pending',sequence:sequence+1,createdAt:new Date().toISOString()});
}
export async function addEntry(entry:Omit<Entry,'id'|'revision'>){
 assertDayEditable(entry.day);
 const store=db;const value={...entry,id:crypto.randomUUID(),revision:1};
 await store.transaction('rw',store.entries,store.operations,async()=>{
 await store.entries.add(value);await enqueue(store,{day:value.day,kind:'add-entry',payload:value,entityKey:entityKey('add-entry',value),baseRevision:0});
 });
}
export async function setDecision(value:Omit<Decision,'id'|'revision'>){
 assertDayEditable(value.day);
 const store=db;const id=`${value.day}:${value.mission}`;
 await store.transaction('rw',store.decisions,store.operations,async()=>{
 const previous=await store.decisions.get(id);const baseRevision=previous?.revision||0;
 const decision={...value,id,revision:baseRevision+1};
 await store.decisions.put(decision);await enqueue(store,{day:value.day,kind:'set-decision',payload:decision,entityKey:entityKey('set-decision',decision),baseRevision});
 });
}
export async function correctEntry(id:string,change:number|Pick<Entry,'quantity'|'unit'|'note'|'occurredAt'|'ticketId'|'mealAt'|'mealLabel'>,reason:string,expectedRevision?:number){
 const patch:Partial<Entry>&{quantity:number}=typeof change==='number'?{quantity:change}:change;
 if(!Number.isSafeInteger(patch.quantity)||patch.quantity<0||!reason.trim()||reason.length>2000)throw new Error('Invalid correction');
 const store=db;
 await store.transaction('rw',store.entries,store.operations,async()=>{
 const original=await store.entries.get(id);if(!original)throw new Error('Record not found');assertDayEditable(original.day);
 if(expectedRevision!==undefined&&original.revision!==expectedRevision)throw new Error('The record changed; review a new comparison');
 if(typeof change!=='number'&&(!patch.unit?.trim()||patch.unit.length>100||(patch.note?.length||0)>2000||patch.occurredAt?.slice(0,10)!==original.day))throw new Error('Invalid correction data');
 const baseRevision=original.revision||1;
 const corrected={...original,...patch,revision:baseRevision+1};await store.entries.put(corrected);
 await enqueue(store,{day:original.day,kind:'correct-entry',payload:{original,corrected,reason},entityKey:entityKey('correct-entry',corrected),baseRevision});
 });
}
export async function queueClose(day:string, results:Decision[],objectives:Objectives={status:'unverified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10}){
 assertDayEditable(day);
 const store=db;
 await store.transaction('rw',store.entries,store.decisions,store.operations,async()=>{
 const entries=await store.entries.where('day').equals(day).toArray();
 const decisions=await store.decisions.where('day').equals(day).toArray();
 const payload={day,results,entries,decisions,objectives,ruleVersion:'1.2'};
 const previous=await store.operations.where('day').equals(day).toArray();
 if(previous.some(op=>op.kind==='close-preview'&&(op.status==='pending'||op.status==='accepted')&&JSON.stringify(op.payload)===JSON.stringify(payload)))return;
 await enqueue(store,{day,kind:'close-preview',payload});
 });
}
export async function mergeSnapshot(store:WinterDB,snapshot:Snapshot,removed:{collection:string;key:string}[]=[]){
 if(snapshot.schemaVersion!==2)throw new Error('Incompatible remote version');
 await store.transaction('rw',[store.entries,store.decisions,store.operations,store.days,store.evaluations,store.movements,store.meta],async()=>{
 const unresolved=(await store.operations.toArray()).filter(o=>o.status==='pending'||o.status==='conflict');
 const protectedKeys=new Set(unresolved.map(o=>o.entityKey));
 for(const item of removed){
 if(item.collection==='entries'&&!protectedKeys.has('entry:'+item.key))await store.entries.delete(item.key);
 if(item.collection==='decisions'&&!protectedKeys.has('decision:'+item.key))await store.decisions.delete(item.key);
 if(item.collection==='days')await store.days.delete(item.key);
 if(item.collection==='movements')await store.movements.delete(item.key);
 if(item.collection==='evaluations'){const split=item.key.lastIndexOf(':');const values=await store.evaluations.where('day').equals(item.key.slice(0,split)).toArray();for(const value of values)if(value.mission===item.key.slice(split+1))await store.evaluations.delete(value.id);}
 }

 for(const entry of snapshot.entries)if(!protectedKeys.has(entityKey('add-entry',entry)))await store.entries.put(entry);
 for(const decision of snapshot.decisions)if(!protectedKeys.has(entityKey('set-decision',decision)))await store.decisions.put(decision);
 if(snapshot.days)await store.days.bulkPut(snapshot.days);
 if(snapshot.evaluations)await store.evaluations.bulkPut(snapshot.evaluations);
 if(snapshot.movements)await store.movements.bulkPut(snapshot.movements);
 const previous=(await store.meta.get('account'))?.value;
 const canonical={...snapshot};
 for(const collection of ['entries','decisions','days','evaluations','movements'] as const){
 const values=new Map((previous?.[collection]||[]).map(value=>[value.id,value]));
 for(const item of removed)if(item.collection===collection)values.delete(item.key);
 for(const value of snapshot[collection]||[])values.set(value.id,value);
 (canonical as unknown as Record<string,unknown>)[collection]=Array.from(values.values());
 }
 await store.meta.put({id:'account',value:canonical});
 });
}
export async function discardClose(id:string){
 const op=await db.operations.get(id);if(!op||op.kind!=='close-preview')throw new Error('Closure not found');
 await db.operations.update(id,{status:'discarded'});
}
export async function resolveConflict(id:string,choice:'remote'|'local',reason:string){
 if(!reason.trim())throw new Error('A resolution requires a reason');
 const store=db;
 await store.transaction('rw',store.entries,store.decisions,store.operations,async()=>{
 const conflict=await store.operations.get(id);
 if(!conflict||conflict.status!=='conflict'||!conflict.entityKey)throw new Error('Conflict not found');
 if(choice==='local')assertDayEditable(conflict.day);
 const current=conflict.serverResult?.current;
 const local=conflict.kind==='set-decision'?await store.decisions.get(commandEntity(conflict).id):await store.entries.get(commandEntity(conflict).id);
 const related=(await store.operations.where('entityKey').equals(conflict.entityKey).toArray()).filter(o=>o.status==='pending'||o.status==='conflict');
 for(const op of related)await store.operations.update(op.id,{status:'discarded'});
 const table=conflict.kind==='set-decision'?store.decisions:store.entries;
 if(choice==='remote'){
  if(current)await table.put(current as Entry&Decision);else if(local)await table.delete(local.id);
 }else if(local){
  const baseRevision=current?.revision||0;const corrected={...local,revision:baseRevision+1};
  await table.put(corrected as Entry&Decision);
  const kind=conflict.kind==='set-decision'?'set-decision':current?'correct-entry':'add-entry';
  await enqueue(store,{day:local.day,kind,entityKey:conflict.entityKey,baseRevision,
   payload:kind==='correct-entry'?{original:current,corrected,reason}:corrected});
 }
 await enqueue(store,{day:conflict.day,kind:'conflict-resolution',payload:{conflictId:id,discardedIds:related.map(o=>o.id),choice,reason}});
 });
}

export function weekStart(day:string){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);}
export function previousDay(day:string){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);}
export function nextDay(day:string){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);}
export async function queuePurchase(product:'food'|'sleep',assignedAt:string,label:string,sleepDay?:string){
 if(product==='sleep'&&!sleepDay)throw new Error('Select your wake-up day.');
 const store=db;
 await store.transaction('rw',store.operations,async()=>{
  if((await store.operations.where('status').equals('pending').toArray()).some(o=>o.kind==='purchase'))throw new Error('A purchase is awaiting confirmation. Retry it before buying another ticket.');
  await enqueue(store,{day:localDay(),kind:'purchase',payload:{product,assignedAt,label,...(product==='sleep'?{sleepDay}:{})}});
 });
}
