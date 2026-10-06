import React from 'react';
import {RpgSelect} from './RpgSelect';
import {RecordModal} from './RecordModal';
import {MissionDatePicker} from './MissionDatePicker';
import {BottomNav} from './BottomNav';
import type {AppView} from './BottomNav';
import { missions, progress } from './domain/game';
import {previewMission} from './domain/preview';
import {synchronize} from './sync';
import type { Result } from './domain/game';
import { db, localDay, isDayClosed, addEntry, setDecision, weekStart } from './storage';
import type { Entry, Decision, Snapshot, Objectives, Evaluation, Movement } from './storage';
import './style.css';
import { liveQuery } from 'dexie';
const Shop=React.lazy(()=>import('./Shop').then(module=>({default:module.Shop})));
const Tools=React.lazy(()=>import('./Tools').then(module=>({default:module.Tools})));
const History=React.lazy(()=>import('./Reports').then(module=>({default:module.History})));
const Progress=React.lazy(()=>import('./Reports').then(module=>({default:module.Progress})));
const Rules=React.lazy(()=>import('./Rules').then(module=>({default:module.Rules})));
import {EntryCorrection} from './EntryCorrection';
const initialObjectives:Objectives={status:'unverified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10};
const order=['pushups','abs','squats','steps','reading','coach','airofit','word','control','food','alcohol','focus','sleep'];
const labels:Record<Result,string>={pending:'Pending',fulfilled:'Completed',failed:'Failed',ticket:'Ticket',exempt:'Exempt'};
export function App(){
 const [view,setView]=React.useState<AppView>('today');
 React.useEffect(()=>{window.scrollTo(0,0);},[view]);
 const [today,setToday]=React.useState(localDay);
 React.useEffect(()=>{const refresh=()=>setToday(localDay());const timer=window.setInterval(refresh,1000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 const [day,setDay]=React.useState(()=>{const current=localDay();return current>'2026-12-31'?'2026-12-31':current<'2026-10-05'?'2026-10-05':current;});
 const closed=isDayClosed(day,today);
 const [correctionToast,setCorrectionToast]=React.useState<number|null>(null);
 React.useEffect(()=>{if(!correctionToast)return;const timer=window.setTimeout(()=>setCorrectionToast(null),3000);return()=>window.clearTimeout(timer);},[correctionToast]);
 const [logPanel,setLogPanel]=React.useState<'records'|'ledger'|null>(null);
 React.useEffect(()=>{setLogPanel(null);setCorrectionToast(null);},[day,view]);
 const [recordMode,setRecordMode]=React.useState('entry');
 const [entries,setEntries]=React.useState<Entry[]>([]),[decisions,setDecisions]=React.useState<Decision[]>([]);
 const [account,setAccount]=React.useState<Snapshot|null>(null),[objectives,setObjectives]=React.useState(initialObjectives),[evaluations,setEvaluations]=React.useState<Evaluation[]>([]),[movements,setMovements]=React.useState<Movement[]>([]);
 const goals:Record<string,number>={pushups:objectives.pushups,abs:objectives.abs,squats:objectives.squats,steps:objectives.steps,reading:objectives.reading};
 const player=progress(account?.balances?.xp||0);
 const [active,setActive]=React.useState<string|null>(null),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false),[loaded,setLoaded]=React.useState(false);

 const load=React.useCallback(async()=>{const [a,b,state,record,closed,ledger]=await Promise.all([db.entries.where('day').equals(day).toArray(),db.decisions.where('day').equals(day).toArray(),db.meta.get('account'),db.days.get(day),db.evaluations.where('day').equals(day).toArray(),db.movements.toArray()]);return {a,b,state,record,closed,ledger};},[day]);
 React.useEffect(()=>{setLoaded(false);const sub=liveQuery(load).subscribe({next:({a,b,state,record,closed,ledger})=>{setEntries(a);setDecisions(b);setAccount(state?.value||null);setObjectives(record?.objectives||initialObjectives);setEvaluations(closed);setMovements(ledger);setLoaded(true);},error:()=>setError('Could not open local storage. Resolve this issue before recording any data.')});return()=>sub.unsubscribe();},[load]);
 async function save(action:()=>Promise<void>){
 if(isDayClosed(day)){setError('Day is closed. Records can no longer be changed.');return;}
 if(day>localDay()){setError('Future days cannot be recorded.');return;}
 setBusy(true);setError('');
 try{
  await action();setActive(null);
  if(!navigator.onLine){setNotice('Saved offline. Your XP and MC will update when you reconnect.');return;}
  setNotice('Updating XP and MC…');
  try{await synchronize();if(await db.operations.where('status').equals('pending').count())await synchronize();const state=(await db.meta.get('account'))?.value;const conflicts=await db.operations.where('status').equals('conflict').count();setNotice(conflicts?'Saved. Some changes need review before your balance can update.':state?.automaticAccountingEnabled?'Saved. Your XP and MC are up to date.':'Saved. Automatic XP and MC updates require server migration 012.');}
  catch{setNotice('Saved on this device. Your XP and MC will update when sync succeeds.');}
 }catch(e){setError(e instanceof Error?e.message:'Could not save. Your form is still open; please try again.');}
 finally{setBusy(false);}
 }

 const outcomes=missions.map(m=>{const preview=previewMission(m,entries,decisions,objectives),confirmed=evaluations.find(e=>e.mission===m.id);return closed?{...preview,result:confirmed?.result||(preview.result==='pending'?'failed':preview.result)}:preview;});
 const allResolved=outcomes.every(o=>o.result!=='pending');
 const allAccounted=allResolved&&outcomes.every(o=>evaluations.some(e=>e.mission===o.m.id&&e.result===o.result&&e.xp===o.effect.xp&&e.mc===o.effect.mc));
 const [changeReview,setChangeReview]=React.useState<{action:()=>Promise<void>;mission:string;before:string;after:string;old:{xp:number;mc:number};next:{xp:number;mc:number};signature:string}|null>(null);
 const signature=(a:Entry[],b:Decision[])=>JSON.stringify([a.slice().sort((x,y)=>x.id.localeCompare(y.id)),b.slice().sort((x,y)=>x.id.localeCompare(y.id))]);
 function reviewChange(action:()=>Promise<void>,mission:string,nextEntries:Entry[],nextDecisions:Decision[],description:string){
 const m=missions.find(m=>m.id===mission)!,old=evaluations.find(e=>e.mission===mission)||previewMission(m,entries,decisions,objectives).effect,next=previewMission(m,nextEntries,nextDecisions,objectives).effect;
 const original=decisions.find(d=>d.mission===mission);

 setChangeReview({action,mission,before:original?`${original.result} · ${original.detail}`:'No previous decision',after:description,old,next,signature:signature(entries,decisions)});
 }
 function requestDecision(value:Omit<Decision,'id'|'revision'>){if(!evaluations.some(e=>e.mission===value.mission)){void save(()=>setDecision(value));return;}const next={...value,id:`${day}:${value.mission}`};reviewChange(()=>setDecision(value),value.mission,entries,[...decisions.filter(d=>d.mission!==value.mission),next],`${value.result} · ${value.detail}`);}
 function requestEntry(value:Omit<Entry,'id'|'revision'>){if(!evaluations.some(e=>e.mission===value.mission)){void save(()=>addEntry(value));return;}reviewChange(()=>addEntry(value),value.mission,[...entries,{...value,id:'preview'}],decisions,`Add ${value.quantity} ${value.unit} · ${value.occurredAt} · ${value.note}`);}
 const selected=missions.find(m=>m.id===active);
 const tabs=<BottomNav view={view} onNavigate={setView}/>;
 if(view==='rules')return <main className="app-main">{tabs}<Rules/></main>;
 if(view==='tools')return <main className="app-main">{tabs}<Tools canUpdate={!active&&!busy}/></main>;
 if(view==='history'||view==='progress')return <main className="app-main">{tabs}{view==='history'?<History onEdit={value=>{setDay(value);setActive(null);setView('today');}}/>:<Progress/>}</main>;
 if(view==='shop')return <main className="app-main">{tabs}<Shop/></main>;
 return <main className="app-main">{tabs}<MissionDatePicker value={day} today={today} disabled={busy} onChange={value=>{if(value<=today){setDay(value);setChangeReview(null);setActive(null);}}}/>{account?.importedUnverified&&<p role="status">Restored backup awaiting verification. Sync to confirm XP and MC with the server.</p>}{error&&!active&&<p role="alert" className="error">{error}</p>}<p aria-live="polite">{notice}</p><h1 className="missions-title">Daily missions</h1><p className="muted">{closed?'Closed day · records are locked':allAccounted?`Day complete · ${outcomes.length} missions accounted for`:allResolved?`${outcomes.length} missions resolved`:'Day in progress · some missions still need to be resolved'}</p>{outcomes.slice().sort((a,b)=>Number(a.result==='fulfilled')-Number(b.result==='fulfilled')||order.indexOf(a.m.id)-order.indexOf(b.m.id)).map(({m,total,result})=><section className="mission mission-card" key={m.id}><div className="mission-card-heading"><span className={`mission-pill pill-${result}`}><svg viewBox="0 0 16 16" fill="none" aria-hidden="true">{result==='fulfilled'?<path d="m3 8 3 3 7-7"/>:result==='failed'?<path d="m4 4 8 8M4 12l8-8"/>:result==='pending'?<><circle cx="8" cy="8" r="5"/><path d="M8 5v3l2 1"/></>:<path d="m8 2 5 3v6l-5 3-5-3V5Z"/>}</svg>{labels[result]}</span><h3>{m.name}</h3><button className="mission-record-button" disabled={closed||!loaded||busy||day<'2026-10-05'||day>'2026-12-31'||day>today} onClick={()=>{setRecordMode(goals[m.id]||m.episodic?'entry':'fulfilled');setError('');setChangeReview(null);setActive(m.id);}}>Record</button></div><p className="muted mission-goal">{goals[m.id]?`${total} / ${goals[m.id]} ${m.id==='steps'?'steps':m.id==='reading'?'pages':'reps'}`:m.episodic?`${total} episodes recorded`:m.id==='sleep'?'Meet your sleep requirements':m.id==='airofit'?'Follow your daily Airofit training plan':'Follow your prescribed plan'}</p><div className="mission-resources"><span className="mission-reward">+{m.xp} XP · +{m.mc} MC</span><span className="mission-penalty">−{m.mc*5} MC {m.episodic?'per episode':m.id==='sleep'?'per night':'per day'}</span></div></section>)}

 {selected&&!closed&&<RecordModal title={selected.name} busy={busy} onClose={()=>{setActive(null);setChangeReview(null);setError('');}}>
 {!changeReview&&<form onSubmit={e=>{
 e.preventDefault();const form=new FormData(e.currentTarget),mode=recordMode;
 const correction=evaluations.some(e=>e.mission===selected.id)?`Player updated ${selected.name} using record type: ${mode}.`:'';
 if(selected.id==='airofit'&&!account?.airofitEnabled){setError('Sync to enable Airofit training.');return;}
 if(mode==='entry'||mode.startsWith('meal:')){
 const quantity=Number(form.get('quantity'));if(!Number.isSafeInteger(quantity)||quantity<=0){setError('Enter a positive whole number.');return;}
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
 const occurredAt=`${day}T${clock}`,ticket=account?.tickets?.find(t=>t.id===mode.slice(5)&&t.product==='food'&&t.assignedAt.startsWith(day));
 requestEntry({day,mission:selected.id,quantity,correctionReason:correction,unit:selected.id==='reading'?'page':selected.id==='steps'?'step':selected.id==='alcohol'?'drink':goals[selected.id]?'rep':'episode',note:'',occurredAt,...(ticket?{ticketId:ticket.id,mealAt:ticket.assignedAt,mealLabel:ticket.label}:{})});
 }else if(selected.id==='sleep'){
 if(!account?.simpleSleepEnabled){setError('Simplified sleep recording requires the latest server update. Sync after migration 011 is applied.');return;}
 const coverage=mode.startsWith('sleep-ticket:')?'ticket':mode==='flexible'?'flexible':'strict';
 const result=mode==='failed'?'failed':coverage==='ticket'?'ticket':'fulfilled';
 requestDecision({day,mission:'sleep',result,detail:JSON.stringify({selfReported:true,coverage,sleepReference:'wake-day',night:day,...(result!=='failed'?{minimumSleepMet:true,...(coverage==='strict'?{scheduleMet:true}:{})}:{}),...(coverage==='ticket'?{ticketId:mode.slice(13)}:{}),note:correction})});
 }else requestDecision({day,mission:selected.id,result:mode as Result,detail:JSON.stringify({note:correction,...(selected.id==='airofit'?{planCompleted:mode==='fulfilled'}:{})})});
 }}><label>Record type<RpgSelect value={recordMode} onChange={e=>setRecordMode(e.target.value)} disabled={busy}>
 {goals[selected.id]&&<option value="entry">Add progress</option>}
 {selected.episodic&&<option value="entry">Record penalty episode</option>}
 {(!goals[selected.id]||entries.filter(e=>e.mission===selected.id).reduce((n,e)=>n+e.quantity,0)>=goals[selected.id])&&<option value="fulfilled">{selected.id==='sleep'?'Completed · strict schedule and 7+ hours':'Completed'}</option>}
 {!selected.episodic&&<option value="failed">Failed</option>}
 {selected.id==='sleep'&&<><option value="flexible" disabled={!!account?.flexibility?.some(f=>f.weekStart===weekStart(day)&&f.night!==day)}>Completed · flexible night and 7+ hours</option>{account?.tickets?.filter(t=>t.product==='sleep'&&t.wakeDay===day).map(t=><option key={t.id} value={`sleep-ticket:${t.id}`}>Ticket · 7+ hours · {t.label}</option>)}</>}
 {selected.id==='food'&&account?.tickets?.filter(t=>t.product==='food'&&t.assignedAt.startsWith(day)).map(t=><option key={t.id} value={`meal:${t.id}`}>Ticket meal · {t.label}</option>)}
 </RpgSelect></label>{(recordMode==='entry'||recordMode.startsWith('meal:'))&&<label>Quantity<input name="quantity" type="number" min="1" step="1" defaultValue="1" required disabled={busy}/></label>}
 <div className="actions record-modal-actions"><button disabled={busy} type="submit">{busy?'Saving…':'Save record'}</button><button type="button" disabled={busy} onClick={()=>{setActive(null);setError('');}}>Cancel</button></div></form>}
 {changeReview&&<section className="record-comparison" aria-label="Compare before saving"><h2>Review change for {missions.find(m=>m.id===changeReview.mission)?.name}</h2><p>Previous: {changeReview.before}</p><p>Proposed: {changeReview.after}</p><p>Resource impact: {changeReview.old.xp} XP / {changeReview.old.mc} MC → {changeReview.next.xp} XP / {changeReview.next.mc} MC.</p><p>Change: {changeReview.next.xp-changeReview.old.xp} XP / {changeReview.next.mc-changeReview.old.mc} MC. Expected level: {progress(Math.max(0,(account?.balances?.xp||0)+changeReview.next.xp-changeReview.old.xp)).level}.</p><p>If an accounted mission changes, the server reverses its previous effect and applies the new one. Historical targets are preserved. Open missions are accounted for when closing the day.</p><button disabled={busy} onClick={()=>void save(async()=>{const store=db;await store.transaction('rw',store.entries,store.decisions,store.operations,async()=>{const a=await store.entries.where('day').equals(day).toArray(),b=await store.decisions.where('day').equals(day).toArray();if(signature(a,b)!==changeReview.signature)throw new Error('The day\'s records changed; prepare a new comparison.');await changeReview.action();});setChangeReview(null);})}>Confirm change</button><button disabled={busy} onClick={()=>setChangeReview(null)}>Back</button></section>}{error&&<p role="alert" className="error">{error}</p>}</RecordModal>}


 <div className="mission-log-actions" aria-label="Mission records and transactions"><button aria-haspopup="dialog" onClick={()=>setLogPanel('records')}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h6v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm6 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-8M6 8h2m-2 4h2m7-4h3m-3 4h3"/></svg><span>Saved records<small>For this day</small></span><span aria-hidden="true">›</span></button><button aria-haspopup="dialog" onClick={()=>setLogPanel('ledger')}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/></svg><span>Transaction ledger<small>XP and MC</small></span><span aria-hidden="true">›</span></button></div>
 {logPanel==='records'&&<RecordModal title="Saved records for this day" busy={false} kicker="ADVENTURE JOURNAL" onClose={()=>setLogPanel(null)}>{correctionToast&&<div className="journal-toast" role="status"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>Record updated successfully.</span><button type="button" aria-label="Dismiss notification" onClick={()=>setCorrectionToast(null)}>×</button></div>}<p className="muted">{day}</p>{!entries.length&&!decisions.length&&<p className="muted">No records saved for this day yet.</p>}{entries.map(e=><section className="log-entry" key={e.id}><p>{missions.find(m=>m.id===e.mission)?.name}: {e.quantity} {e.unit} · {e.occurredAt.split('T')[1]?.slice(0,5)||'—'} {e.note}</p><EntryCorrection entry={e} entries={entries} decisions={decisions} evaluations={evaluations} account={account} objectives={objectives} locked={closed} onSaved={()=>{setCorrectionToast(Date.now());}}/></section>)}{decisions.map(d=><section className="log-entry" key={d.id}><p>{missions.find(m=>m.id===d.mission)?.name}: <span className={`mission-pill pill-${d.result}`}>{labels[d.result]}</span></p></section>)}</RecordModal>}
 {logPanel==='ledger'&&<RecordModal title="Transaction ledger · XP and MC" busy={false} kicker="TREASURY" onClose={()=>setLogPanel(null)}>{!movements.length&&<p className="muted">No confirmed transactions yet.</p>}{movements.slice().sort((a,b)=>b.accreditedAt.localeCompare(a.accreditedAt)).map(m=><section className="log-entry" key={m.id}><strong className={m.amount>=0?'mission-reward':'mission-penalty'}>{m.amount>0?'+':''}{m.amount} {m.resource.toUpperCase()}</strong><p>{m.cause==='reversal'?'Reversal':m.cause==='purchase'?'Purchase':'Mission'}</p><p className="muted">{new Date(m.accreditedAt).toLocaleString('en-GB',{timeZone:'America/Bogota'})}</p></section>)}</RecordModal>}
 </main>;
}
