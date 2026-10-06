import React from 'react';
import {RpgSelect} from './RpgSelect';
import {serverMessage} from './server-message';
import { liveQuery } from 'dexie';
import { db, resolveConflict, commandEntity, discardClose } from './storage';
import {missions,progress} from './domain/game';
import {previewMission} from './domain/preview';
import type {Entry,Decision,Snapshot,Objectives, Operation } from './storage';
import { synchronize } from './sync';
function describeRecord(value:unknown):string{
 if(!value||typeof value!=='object')return 'No confirmed record.';
 const record=value as Record<string,unknown>;
 if('quantity' in record)return `${record.quantity} ${record.unit} · ${record.occurredAt}${record.note?' · '+record.note:''}`;
 const results:Record<string,string>={fulfilled:'Completion',failed:'Failure',pending:'Pending',exempt:'Exemption'};
 return `${results[String(record.result)]||record.result} · ${record.day}`;
}
export function SyncPanel(){
 const [status,setStatus]=React.useState('Ready to sync records and check confirmed balances.');
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
  if(!navigator.onLine){setState('error');if(manual)setToast({message:'Offline. Your records stay saved on this device.',error:true});return;}
  syncing.current=true;setBusy(true);setState('loading');
  try{const message=await synchronize();const needsReview=await db.operations.where('status').equals('conflict').count()>0;setStatus(message);setEnabled(true);setState(needsReview?'error':'success');if(manual||needsReview)setToast({message,error:needsReview});}
  catch(error){const message=error instanceof Error?error.message:'Could not sync.';setStatus(message);setState('error');setToast({message,error:true});}
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
 return <section><h3>Resolution comparison</h3><p>Latest local value: {describeRecord(local)}</p><p>Remote revision: {op.serverResult?.currentRevision??op.serverResult?.current?.revision??'—'} · local operation: {new Date(op.createdAt).toLocaleString('en-GB',{timeZone:'America/Bogota'})}.</p><p>Keeping the confirmed value discards local changes to this record. Applying the local value proposes {next.effect.xp} XP / {next.effect.mc} MC compared with {old.xp} XP / {old.mc} confirmed MC.</p><p>Provisional difference: {next.effect.xp-old.xp} XP / {next.effect.mc-old.mc} MC. Expected level: {progress(Math.max(0,(context.account?.balances?.xp||0)+next.effect.xp-old.xp)).level}.</p><p className="muted">Includes pending local entries for this mission. If its accounted effect changes, the previous effect is reversed and the new one applied; the server validates the result and preserves historical targets.</p></section>;
 }
 const player=progress(context.account?.balances?.xp||0);
 const rankNames:Record<string,string>={D:'Initiated',C:'Disciplined',B:'Elite',A:'Master',S:'Monarch'};
 return <><header className={`winter-header rank-${player.rank}`}><div className="winter-header-inner"><div className="winter-emblem" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M32 4 56 18v28L32 60 8 46V18Z"/><path d="M32 12v40M15 22l34 20M15 42l34-20M25 16l7 7 7-7M25 48l7-7 7 7M16 30l9-2-2-9M48 34l-9 2 2 9M16 34l9 2-2 9M48 30l-9-2 2-9"/></svg></div><div className="winter-heading"><span className="winter-wordmark">WINTER ARC <span>2026</span></span><p><strong>{rankNames[player.rank]}</strong> Player</p><span className="winter-level"><span className="rank-insignia">RANK {player.rank}</span><span>· Level {player.level}</span></span></div><div className="header-actions"><div className="header-wallet" aria-label={`Balance ${context.account?.balances?.mc??'unconfirmed'} MC`} title={context.account?.importedUnverified?'Backup balance awaiting verification':'Confirmed balance'}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 8 5v10l-8 5-8-5V7Z"/><path d="m12 6 4 6-4 6-4-6Z"/></svg><span><strong>{context.account?.balances?.mc??'—'}</strong><small>MC{context.account?.importedUnverified?' *':''}</small></span></div><button className={`icon-button sync-${state}`} disabled={busy} onClick={()=>void sync(true)} aria-label={busy?'Syncing records':'Sync records'} title={busy?'Syncing…':'Sync records'} aria-busy={busy}><svg viewBox="0 0 32 32" fill="none" aria-hidden="true">{state==='success'?<><circle cx="16" cy="16" r="12"/><path d="m10 16 4 4 8-8"/></>:<><g className="sync-arrows"><path d="M24 12a9 9 0 0 0-15-3M8 20a9 9 0 0 0 15 3"/><path d="m20 12 5 1 1-5M12 20l-5-1-1 5"/></g>{state==='loading'&&<circle className="sync-ring" cx="16" cy="16" r="14"/>}{state==='error'&&<path d="M16 12v5m0 4h.01"/>}</>}</svg></button></div><div className="header-xp"><div className="xp-track"><progress value={player.current} max={player.next} aria-label="XP toward the next level"/></div><div className="xp-caption"><span>{context.account?.balances?`${player.current} / ${player.next} XP`:'XP awaiting sync'}{context.account?.importedUnverified?' · awaiting verification':''}</span><span>Level {player.level+1}<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 4 4 4-4 4"/></svg></span></div></div></div></header>{toast&&<div className={`sync-toast ${toast.error?'toast-error':''}`} role={toast.error?'alert':'status'}><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={()=>setToast(null)}>×</button></div>}{(closes.length>0||conflicts.length>0)&&<section className="account-bar sync-review" aria-label="Records requiring attention"><p role="status">{status}</p>{closes.map(op=><details key={op.id}><summary>Saved closure awaiting submission · {op.day}</summary><p>Syncing will account for the missions in this request if their records are still current.</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Closure discarded. Your records remain saved.'))}>Discard closure request</button></details>)}{conflicts.map(op=>op.kind==='close-preview'?<details key={op.id}><summary>Closure needs review · {op.day}</summary><p>{serverMessage(op.serverResult?.message)||'Download the changes and review the results again before closing.'}</p><button disabled={busy} onClick={()=>void discardClose(op.id).then(()=>setStatus('Request discarded. Review the closure using the current records.'))}>Discard request to review closure</button></details>:<details key={op.id}><summary>Conflicting change · {op.day}</summary><p>{serverMessage(op.serverResult?.message)||'Another session changed this record. Local changes are preserved for review.'}</p><h3>Confirmed remote value</h3><p>{describeRecord(op.serverResult?.current)}</p><h3>Conflicting local change</h3><p>{describeRecord(commandEntity(op))}</p>{comparison(op)}<form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);try{await resolveConflict(op.id,String(form.get('choice')) as 'remote'|'local',String(form.get('reason')));setStatus('Resolution saved. Sync to confirm.');}catch{setStatus('Could not resolve the change.');}finally{setBusy(false);}}}><label>Resolution<RpgSelect name="choice"><option value="remote">Keep confirmed value</option><option value="local">Apply my latest local value over the confirmed value</option></RpgSelect></label><label>Reason<input name="reason" maxLength={2000} required/></label><button disabled={busy}>Save resolution</button></form></details>)}</section>}</>;
}
