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
export function SyncPanel({onSignOut,signingOut}:{onSignOut:()=>Promise<void>;signingOut:boolean}){
 const [status,setStatus]=React.useState('Lista para sincronizar registros y consultar saldos confirmados.');
 const [busy,setBusy]=React.useState(false),[conflicts,setConflicts]=React.useState<Operation[]>([]),[enabled,setEnabled]=React.useState(true);
 const [closes,setCloses]=React.useState<Operation[]>([]);
 const [context,setContext]=React.useState<{account:Snapshot|null;entries:Entry[];decisions:Decision[]}>({account:null,entries:[],decisions:[]});
 React.useEffect(()=>{const sub=liveQuery(async()=>({account:(await db.meta.get('account'))?.value||null,entries:await db.entries.toArray(),decisions:await db.decisions.toArray()})).subscribe(setContext);return()=>sub.unsubscribe();},[]);
 const [state,setState]=React.useState<'idle'|'loading'|'success'|'error'>('idle');
 const [toast,setToast]=React.useState<{message:string;error:boolean}|null>(null);
 const syncing=React.useRef(false);
 React.useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(null),3000);return()=>window.clearTimeout(timer);},[toast]);
 React.useEffect(()=>{if(state!=='success'&&state!=='error')return;const timer=window.setTimeout(()=>setState('idle'),3000);return()=>window.clearTimeout(timer);},[state]);
 React.useEffect(()=>{const sub=liveQuery(()=>db.operations.where('status').anyOf('pending','conflict').toArray()).subscribe(ops=>{setConflicts(ops.filter(o=>o.status==='conflict'));setCloses(ops.filter(o=>o.status==='pending'&&o.kind==='close-preview'));});return()=>sub.unsubscribe();},[]);
 const sync=React.useCallback(async(manual=false)=>{
  if(syncing.current)return;
  if(!navigator.onLine){setState('error');if(manual)setToast({message:'Sin conexión. Tus registros quedan guardados en este dispositivo.',error:true});return;}
  syncing.current=true;setBusy(true);setState('loading');
  try{const message=await synchronize();const needsReview=await db.operations.where('status').equals('conflict').count()>0;setStatus(message);setEnabled(true);setState(needsReview?'error':'success');if(manual||needsReview)setToast({message,error:needsReview});}
  catch(error){const message=error instanceof Error?error.message:'No se pudo sincronizar.';setStatus(message);setState('error');setToast({message,error:true});}
  finally{syncing.current=false;setBusy(false);}
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
 const player=progress(context.account?.balances?.xp||0);
 const rankNames:Record<string,string>={D:'Iniciado',C:'Disciplinado',B:'Élite',A:'Maestro',S:'Monarca'};
 return <><header className={`winter-header rank-${player.rank}`}><div className="winter-header-inner"><div className="winter-emblem" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M32 4 56 18v28L32 60 8 46V18Z"/><path d="M32 12v40M15 22l34 20M15 42l34-20M25 16l7 7 7-7M25 48l7-7 7 7M16 30l9-2-2-9M48 34l-9 2 2 9M16 34l9 2-2 9M48 30l-9-2 2-9"/></svg></div><div className="winter-heading"><span className="winter-wordmark">WINTER ARC <span>2026</span></span><p><strong>{rankNames[player.rank]}</strong> Player</p><span className="winter-level"><span className="rank-insignia">RANGO {player.rank}</span><span>· Nivel {player.level}</span></span></div><div className="header-actions"><div className="header-wallet" aria-label={`Saldo ${context.account?.balances?.mc??'sin confirmar'} MC`} title={context.account?.importedUnverified?'Saldo de respaldo por verificar':'Saldo confirmado'}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 8 5v10l-8 5-8-5V7Z"/><path d="m12 6 4 6-4 6-4-6Z"/></svg><span><strong>{context.account?.balances?.mc??'—'}</strong><small>MC{context.account?.importedUnverified?' *':''}</small></span></div><button className={`icon-button sync-${state}`} disabled={busy} onClick={()=>void sync(true)} aria-label={busy?'Sincronizando registros':'Sincronizar registros'} title={busy?'Sincronizando…':'Sincronizar registros'} aria-busy={busy}><svg viewBox="0 0 32 32" fill="none" aria-hidden="true">{state==='success'?<><circle cx="16" cy="16" r="12"/><path d="m10 16 4 4 8-8"/></>:<><g className="sync-arrows"><path d="M24 12a9 9 0 0 0-15-3M8 20a9 9 0 0 0 15 3"/><path d="m20 12 5 1 1-5M12 20l-5-1-1 5"/></g>{state==='loading'&&<circle className="sync-ring" cx="16" cy="16" r="14"/>}{state==='error'&&<path d="M16 12v5m0 4h.01"/>}</>}</svg></button><button className="icon-button" disabled={signingOut||busy} aria-label="Cerrar sesión" title="Cerrar sesión" onClick={()=>void onSignOut().catch(()=>setToast({message:'No se pudo cerrar sesión. Intenta nuevamente.',error:true}))}><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M14 6H7v20h7M13 16h14m-5-5 5 5-5 5"/></svg></button></div><div className="header-xp"><div className="xp-track"><progress value={player.current} max={player.next} aria-label="XP hacia el siguiente nivel"/></div><div className="xp-caption"><span>{context.account?.balances?`${player.current} / ${player.next} XP`:'XP pendiente de sincronizar'}{context.account?.importedUnverified?' · por verificar':''}</span><span>Nivel {player.level+1}<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 4 4 4-4 4"/></svg></span></div></div></div></header>{toast&&<div className={`sync-toast ${toast.error?'toast-error':''}`} role={toast.error?'alert':'status'}><span>{toast.message}</span><button aria-label="Cerrar notificación" onClick={()=>setToast(null)}>×</button></div>}{(closes.length>0||conflicts.length>0)&&<section className="account-bar sync-review" aria-label="Registros que requieren atención"><p role="status">{status}</p>{closes.map(op=><details key={op.id}><summary>Cierre guardado pendiente de enviar · {op.day}</summary><p>Al sincronizar se contabilizarán las misiones incluidas en esta solicitud si sus registros siguen vigentes.</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Cierre descartado. Los registros permanecen guardados.'))}>Descartar solicitud de cierre</button></details>)}{conflicts.map(op=>op.kind==='close-preview'?<details key={op.id}><summary>Cierre requiere revisión · {op.day}</summary><p>{op.serverResult?.message||'Descarga los cambios y revisa nuevamente los resultados antes de cerrar.'}</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Solicitud descartada. Revisa el cierre con los registros actuales.'))}>Descartar solicitud para revisar cierre</button></details>:<details key={op.id}><summary>Cambio en conflicto · {op.day}</summary><p>{op.serverResult?.message||'Otra sesión modificó este registro. Los cambios locales se conservan para revisión.'}</p><h3>Valor confirmado remoto</h3><p>{describeRecord(op.serverResult?.current)}</p><h3>Cambio local en conflicto</h3><p>{describeRecord(commandEntity(op))}</p>{comparison(op)}<form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);try{await resolveConflict(op.id,String(form.get('choice')) as 'remote'|'local',String(form.get('reason')));setStatus('Resolución guardada. Sincroniza para confirmar.');}catch{setStatus('No se pudo resolver el cambio.');}finally{setBusy(false);}}}><label>Resolución<select name="choice"><option value="remote">Conservar valor confirmado</option><option value="local">Aplicar mi último valor local sobre el confirmado</option></select></label><label>Motivo<input name="reason" maxLength={2000} required/></label><button disabled={busy}>Guardar resolución</button></form></details>)}</section>}</>;
}
