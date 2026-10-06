import React from 'react';
import { liveQuery } from 'dexie';
import { db, resolveConflict, commandEntity, discardClose } from './storage';
import {missions,progress} from './domain/game';
import {previewMission} from './domain/preview';
import type {Entry,Decision,Snapshot,Objectives, Operation } from './storage';
import { synchronize } from './sync';
function describeRecord(value:unknown):string{
 if(!value||typeof value!=='object')return 'Sin registro confirmado.';
 const record=value as Record<string,unknown>;
 if('quantity' in record)return `${record.quantity} ${record.unit} · ${record.occurredAt}${record.note?' · '+record.note:''}`;
 const results:Record<string,string>={fulfilled:'Cumplimiento',failed:'Incumplimiento',pending:'Pendiente',exempt:'Exención'};
 return `${results[String(record.result)]||record.result} · ${record.day}`;
}
export function SyncPanel(){
 const [status,setStatus]=React.useState('Lista para sincronizar registros y consultar saldos confirmados.');
 const [busy,setBusy]=React.useState(false),[conflicts,setConflicts]=React.useState<Operation[]>([]),[enabled,setEnabled]=React.useState(true);
 const [closes,setCloses]=React.useState<Operation[]>([]);
 const [context,setContext]=React.useState<{account:Snapshot|null;entries:Entry[];decisions:Decision[]}>({account:null,entries:[],decisions:[]});
 React.useEffect(()=>{const sub=liveQuery(async()=>({account:(await db.meta.get('account'))?.value||null,entries:await db.entries.toArray(),decisions:await db.decisions.toArray()})).subscribe(setContext);return()=>sub.unsubscribe();},[]);
 const [last,setLast]=React.useState('');
 React.useEffect(()=>{const sub=liveQuery(()=>db.operations.where('status').anyOf('pending','conflict').toArray()).subscribe(ops=>{setConflicts(ops.filter(o=>o.status==='conflict'));setCloses(ops.filter(o=>o.status==='pending'&&o.kind==='close-preview'));});return()=>sub.unsubscribe();},[]);
 const sync=React.useCallback(async()=>{
  if(!navigator.onLine){setStatus('Sin conexión. Los registros y solicitudes quedan guardados en este dispositivo.');return;}
  setBusy(true);setStatus('Sincronizando registros…');
  try{setStatus(await synchronize());setEnabled(true);setLast(new Date().toLocaleTimeString('es-CO',{timeZone:'America/Bogota'}));}
  catch(error){setStatus(error instanceof Error?error.message:'No se pudo sincronizar.');}
  finally{setBusy(false);}
 },[]);
 React.useEffect(()=>{
 let timer:number|undefined,previous='';
 const sub=liveQuery(()=>db.operations.where('status').equals('pending').toArray()).subscribe(ops=>{
  const signature=ops.map(o=>o.id).sort().join('|');if(signature===previous)return;previous=signature;
  window.clearTimeout(timer);if(signature)timer=window.setTimeout(()=>{if(navigator.onLine)void sync();},800);
 });
 return()=>{sub.unsubscribe();window.clearTimeout(timer);};
 },[sync]);
 React.useEffect(()=>{
 if(!enabled)return;
 const resume=()=>{if(navigator.onLine&&document.visibilityState==='visible')void sync();};
 window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
 resume();
 const timer=window.setInterval(resume,30000);
 return()=>{window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);window.clearInterval(timer);};
 },[enabled,sync]);
 function comparison(op:Operation){
 const entity=commandEntity(op),m=missions.find(m=>m.id===entity.mission);if(!m)return null;
 const local=(op.kind==='set-decision'?context.decisions:context.entries).find(e=>e.id===entity.id)||entity;
 const objectives=context.account?.days?.find(d=>d.day===entity.day)?.objectives||{status:'unverified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10} as Objectives;
 const previous=context.account?.evaluations?.find(e=>e.day===entity.day&&e.mission===entity.mission);
 const next=previewMission(m,context.entries.filter(e=>e.day===entity.day),context.decisions.filter(e=>e.day===entity.day),objectives);
 const old=previous||{xp:0,mc:0};
 return <section><h3>Comparación de resolución</h3><p>Último valor local: {describeRecord(local)}</p><p>Revisión remota: {op.serverResult?.currentRevision??op.serverResult?.current?.revision??'—'} · operación local: {new Date(op.createdAt).toLocaleString('es-CO',{timeZone:'America/Bogota'})}.</p><p>Conservar el confirmado descarta los cambios locales de este registro. Aplicar el local propone {next.effect.xp} XP / {next.effect.mc} MC frente a {old.xp} XP / {old.mc} MC confirmados.</p><p>Diferencia provisional: {next.effect.xp-old.xp} XP / {next.effect.mc-old.mc} MC. Nivel previsto: {progress(Math.max(0,(context.account?.balances?.xp||0)+next.effect.xp-old.xp)).level}.</p><p className="muted">Incluye los aportes locales pendientes de esta misión. Si cambia su efecto contabilizado, se revierte el anterior y se aplica el nuevo; el servidor valida el resultado y conserva objetivos históricos.</p></section>;
 }
 return <section className="account-bar"><button disabled={busy} onClick={()=>void sync()}>{busy?'Sincronizando…':'Sincronizar registros'}</button><p role="status">{status}</p>{last&&<p className="muted">Última descarga: {last} · Bogotá</p>}{closes.map(op=><details key={op.id}><summary>Cierre guardado pendiente de enviar · {op.day}</summary><p>Al sincronizar se contabilizarán las misiones incluidas en esta solicitud si sus registros siguen vigentes.</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Cierre descartado. Los registros permanecen guardados.'))}>Descartar solicitud de cierre</button></details>)}{conflicts.map(op=>op.kind==='close-preview'?<details key={op.id}><summary>Cierre requiere revisión · {op.day}</summary><p>{op.serverResult?.message||'Descarga los cambios y revisa nuevamente los resultados antes de cerrar.'}</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Solicitud descartada. Revisa el cierre con los registros actuales.'))}>Descartar solicitud para revisar cierre</button></details>:<details key={op.id}><summary>Cambio en conflicto · {op.day}</summary><p>{op.serverResult?.message||'Otra sesión modificó este registro. Los cambios locales se conservan para revisión.'}</p><h3>Valor confirmado remoto</h3><p>{describeRecord(op.serverResult?.current)}</p><h3>Cambio local en conflicto</h3><p>{describeRecord(commandEntity(op))}</p>{comparison(op)}<form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);try{await resolveConflict(op.id,String(form.get('choice')) as 'remote'|'local',String(form.get('reason')));setStatus('Resolución guardada. Sincroniza para confirmar.');}catch{setStatus('No se pudo resolver el cambio.');}finally{setBusy(false);}}}><label>Resolución<select name="choice"><option value="remote">Conservar valor confirmado</option><option value="local">Aplicar mi último valor local sobre el confirmado</option></select></label><label>Motivo<input name="reason" maxLength={2000} required/></label><button disabled={busy}>Guardar resolución</button></form></details>)}</section>;
}
