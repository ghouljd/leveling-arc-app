import {db,syncKinds,entityKey} from './storage.ts';
import type {Entry,Decision,Operation,Day,Evaluation,Movement,Snapshot} from './storage';
import {missions} from './domain/game.ts';
export interface Backup {format:'winter-arc';version:1;owner:string;exportedAt:string;entries:Entry[];decisions:Decision[];operations:Operation[];days:Day[];evaluations:Evaluation[];movements:Movement[];account:Snapshot|null;restores?:RestoreReview[]}
export interface RestoreReview {id:string;type:'entries'|'decisions'|'operations';value:Entry|Decision|Operation;status:'pending'|'kept-local'|'corrected';source:string;reason?:string;resolvedAt?:string}
function owner(){if(!db.name.startsWith('winter-arc-player-'))throw new Error('Inicia sesión para respaldar tu cuenta.');return db.name.slice('winter-arc-player-'.length);}
const missionIds=new Set<string>(missions.map(m=>m.id));
const isObject=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const dateTime=(x:unknown)=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const integer=(x:unknown)=>Number.isSafeInteger(x);
const day=(x:unknown)=>typeof x==='string'&&/^2026-\d{2}-\d{2}$/.test(x)&&x>='2026-10-05'&&x<='2026-12-31'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const result=(x:unknown)=>['pending','fulfilled','failed','ticket','exempt'].includes(String(x));
function validEntity(x:unknown,decision=false){if(!isObject(x)||typeof x.id!=='string'||!day(x.day)||!missionIds.has(String(x.mission)))return false;return decision?result(x.result)&&typeof x.detail==='string'&&x.id===`${x.day}:${x.mission}`:integer(x.quantity)&&Number(x.quantity)>=0&&typeof x.unit==='string'&&typeof x.note==='string'&&dateTime(x.occurredAt);}
function validOperation(x:unknown){if(!isObject(x)||typeof x.id!=='string'||!day(x.day)||!['add-entry','correct-entry','set-decision','close-preview','purchase','conflict-resolution'].includes(String(x.kind))||!['pending','accepted','conflict','discarded'].includes(String(x.status))||!dateTime(x.createdAt)||!isObject(x.payload))return false;
 if(syncKinds.includes(String(x.kind))){const entity=x.kind==='correct-entry'?x.payload.corrected:x.payload;if(!validEntity(entity,x.kind==='set-decision')||!integer(x.baseRevision)||Number(x.baseRevision)<0||x.day!==(entity as Entry|Decision).day||x.entityKey!==entityKey(String(x.kind),entity as unknown as Entry|Decision))return false;}
 if(x.kind==='purchase'&&(!['food','sleep'].includes(String(x.payload.product))||!dateTime(x.payload.assignedAt)||typeof x.payload.label!=='string'||(x.payload.product==='sleep'&&!day(x.payload.sleepDay))))return false;
 if(x.kind==='close-preview'&&(x.payload.day!==x.day||!Array.isArray(x.payload.entries)||!Array.isArray(x.payload.decisions)||!Array.isArray(x.payload.results)||x.payload.entries.some(e=>!validEntity(e))||x.payload.decisions.some(e=>!validEntity(e,true))||x.payload.results.some(e=>!validEntity(e,true))))return false;
 return true;
}
export function validateBackup(value:unknown,player:string):Backup{
 if(!isObject(value)||value.format!=='winter-arc'||value.version!==1||value.owner!==player||!dateTime(value.exportedAt))throw new Error('Copia incompatible o perteneciente a otra cuenta.');
 for(const name of ['entries','decisions','operations','days','evaluations','movements']){const rows=value[name];if(!Array.isArray(rows)||rows.length>100000||rows.some(r=>!isObject(r)||typeof r.id!=='string')||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('La copia contiene registros inválidos o identificadores repetidos.');}
 const b=value as unknown as Backup;
 if(b.restores!==undefined&&(!Array.isArray(b.restores)||b.restores.length>100000||b.restores.some(r=>!isObject(r)||typeof r.id!=='string'||!['entries','decisions','operations'].includes(r.type)||!['pending','kept-local','corrected'].includes(r.status)||!dateTime(r.source)||(r.type==='operations'?!validOperation(r.value):!validEntity(r.value,r.type==='decisions')))))throw new Error('Revisiones de recuperación inválidas.');
 if(b.entries.some(e=>!validEntity(e))||b.decisions.some(d=>!validEntity(d,true))||b.operations.some(o=>!validOperation(o))||b.days.some(d=>!day(d.day)||!isObject(d.objectives)||typeof d.objectives.status!=='string'||!['D','C','B','A','S'].includes(d.objectives.rank)||['pushups','abs','squats','steps','reading'].some(k=>!integer((d.objectives as unknown as Record<string,unknown>)[k])||Number((d.objectives as unknown as Record<string,unknown>)[k])<0))||b.evaluations.some(e=>!day(e.day)||!missionIds.has(e.mission)||!result(e.result)||!integer(e.xp)||e.xp<0||!integer(e.mc))||b.movements.some(m=>!['xp','mc'].includes(m.resource)||!integer(m.amount)||typeof m.cause!=='string'||!dateTime(m.accreditedAt)))throw new Error('La estructura o los valores de la copia no son válidos.');
 if(b.account!==null&&(!isObject(b.account)||b.account.schemaVersion!==2||!Array.isArray(b.account.entries)||!Array.isArray(b.account.decisions)||!integer(b.account.revision)))throw new Error('Consulta contable incompatible.');
 if(b.account){
  const a=b.account;
  if(a.entries.some(e=>!validEntity(e))||a.decisions.some(d=>!validEntity(d,true))||!a.balances||!integer(a.balances.xp)||!integer(a.balances.mc)||!integer(a.level)||Number(a.level)<1)throw new Error('Datos de cuenta incompletos.');
  if(a.tickets!==undefined&&(!Array.isArray(a.tickets)||a.tickets.some(t=>!isObject(t)||typeof t.id!=='string'||!['food','sleep'].includes(t.product)||typeof t.label!=='string'||!dateTime(t.assignedAt)||!dateTime(t.purchasedAt)||!['assigned','used','expired'].includes(t.state)||!day(t.weekStart)||!day(t.expiresOn))))throw new Error('Tickets de la copia inválidos.');
  if(a.flexibility!==undefined&&(!Array.isArray(a.flexibility)||a.flexibility.some(f=>!isObject(f)||!day(f.weekStart)||!day(f.night))))throw new Error('Noches flexibles de la copia inválidas.');
  // The validated tables are authoritative for the imported cache.
  b.account={...a,entries:b.entries,decisions:b.decisions,days:b.days,evaluations:b.evaluations,movements:b.movements};
 }
 for(const m of b.movements)if(m.reversesId&&!b.movements.some(r=>r.id===m.reversesId&&r.resource===m.resource&&r.amount===-m.amount))throw new Error('La copia está incompleta: falta una reversión.');
 if(b.account?.balances){const xp=b.movements.filter(m=>m.resource==='xp').reduce((n,m)=>n+m.amount,0),mc=b.movements.filter(m=>m.resource==='mc').reduce((n,m)=>n+m.amount,0);if(xp<0||xp!==b.account.balances.xp||mc!==b.account.balances.mc)throw new Error('El saldo no coincide con el libro de movimientos.');}
 return b;
}
export async function createBackup():Promise<Backup>{const player=owner(),store=db;return store.transaction('r',[store.entries,store.decisions,store.operations,store.days,store.evaluations,store.movements,store.meta,store.restores],async()=>({restores:await store.restores.toArray(),format:'winter-arc',version:1,owner:player,exportedAt:new Date().toISOString(),entries:await store.entries.toArray(),decisions:await store.decisions.toArray(),operations:await store.operations.toArray(),days:await store.days.toArray(),evaluations:await store.evaluations.toArray(),movements:await store.movements.toArray(),account:(await store.meta.get('account'))?.value||null}));}
function stable(x:unknown):string{if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(isObject(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x);}
function comparable(x:Entry|Decision|Operation){const r={...x} as Record<string,unknown>;delete r.sequence;if('kind' in r){delete r.status;delete r.serverResult;}return stable(r);}
async function plan(b:Backup){const conflicts:RestoreReview[]=[],fresh:{entries:Entry[];decisions:Decision[];operations:Operation[]}={entries:[],decisions:[],operations:[]};let identical=0;
 for(const type of ['entries','decisions','operations'] as const)for(const value of b[type]){const existing=await db[type].get(value.id);if(existing){if(comparable(existing)===comparable(value))identical++;else conflicts.push({id:`${type}:${value.id}:${b.exportedAt}`,type,value,status:'pending',source:b.exportedAt});}else fresh[type].push(value as Entry&Decision&Operation);}
 const keys=new Set(conflicts.filter(c=>c.type!=='operations').map(c=>entityKey(c.type==='decisions'?'set-decision':'add-entry',c.value as Entry|Decision)));
 const conflictDays=new Set(conflicts.map(c=>c.value.day));
 const blocked=(o:Operation)=>!!o.entityKey&&keys.has(o.entityKey)||o.kind==='close-preview'&&conflictDays.has(o.day);
 fresh.operations=fresh.operations.filter(o=>{if(blocked(o)){conflicts.push({id:`operations:${o.id}:${b.exportedAt}`,type:'operations',value:o,status:'pending',source:b.exportedAt});return false;}return true;});
 for(const type of ['entries','decisions'] as const)fresh[type]=fresh[type].filter(v=>{const key=entityKey(type==='entries'?'add-entry':'set-decision',v);if(!b.operations.some(o=>o.entityKey===key&&syncKinds.includes(o.kind))){conflicts.push({id:`${type}:${v.id}:${b.exportedAt}`,type,value:v,status:'pending',source:b.exportedAt});return false;}return true;}) as Entry[]&Decision[];
 return {fresh,conflicts,identical,newRecords:fresh.entries.length+fresh.decisions.length+fresh.operations.length};
}
export async function previewBackup(value:unknown){const b=validateBackup(value,owner()),p=await plan(b);return {backup:b,newRecords:p.newRecords,identical:p.identical,conflicts:p.conflicts.length};}
export async function restoreBackup(value:unknown){const b=validateBackup(value,owner()),store=db;
 return store.transaction('rw',[store.entries,store.decisions,store.operations,store.days,store.evaluations,store.movements,store.meta,store.restores],async()=>{
  const p=await plan(b);await store.entries.bulkAdd(p.fresh.entries);await store.decisions.bulkAdd(p.fresh.decisions);
  let sequence=(await store.operations.orderBy('sequence').last())?.sequence||0;
  for(const op of p.fresh.operations.sort((a,b)=>(a.sequence||0)-(b.sequence||0)))await store.operations.add({...op,sequence:++sequence,status:op.status==='accepted'&&(syncKinds.includes(op.kind)||['purchase','close-preview'].includes(op.kind))?'pending':op.status});
  for(const c of [...p.conflicts,...(b.restores||[])])if(!await store.restores.get(c.id))await store.restores.add(c);
  // Restore accounting only into an empty cache; the server must confirm it again.
  if(!await store.meta.get('account')&&b.account){await store.days.bulkPut(b.days);await store.evaluations.bulkPut(b.evaluations);await store.movements.bulkPut(b.movements);await store.meta.put({id:'account',value:{...b.account,importedUnverified:true}});}
  return {newRecords:p.newRecords,identical:p.identical,conflicts:p.conflicts.length};
 });
}
export function historyCSV(b:Backup){return '\uFEFFFecha,Misión,Resultado,XP,MC\r\n'+b.evaluations.map(e=>[e.day,missions.find(m=>m.id===e.mission)?.name||e.mission,e.result,e.xp,e.mc].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');}
