import React from 'react';
import {RpgSelect} from './RpgSelect';
import {previewMission} from './domain/preview';
import {correctEntry} from './storage';
import {missions} from './domain/game';
import type {Entry,Decision,Evaluation,Snapshot,Objectives} from './storage';
export function EntryCorrection({entry,entries,decisions,evaluations,account,objectives,onSaved,locked=false}:{entry:Entry;entries:Entry[];decisions:Decision[];evaluations:Evaluation[];account:Snapshot|null;objectives:Objectives;onSaved:()=>void;locked?:boolean}){
 const detailsRef=React.useRef<HTMLDetailsElement>(null);
 const initialMode=entry.ticketId?`meal:${entry.ticketId}`:'quantity';
 const [mode,setMode]=React.useState(initialMode),[review,setReview]=React.useState<{original:Entry;corrected:Entry;reason:string}|null>(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
 const mission=missions.find(m=>m.id===entry.mission)!;
 const effect=(list:Entry[])=>{const preview=previewMission(mission,list,decisions,objectives);return {result:preview.result,...preview.effect};};
 const before=evaluations.find(e=>e.mission===entry.mission)||effect(entries),after=review?effect(entries.map(e=>e.id===entry.id?review.corrected:e)):before;
 const delta={xp:after.xp-before.xp,mc:after.mc-before.mc};
 if(locked)return <p className="muted">Closed day · record locked</p>;
 return <details ref={detailsRef} className="entry-correction"><summary>Correct record</summary>{!review&&<form onSubmit={e=>{
 e.preventDefault();setError('');const form=new FormData(e.currentTarget),quantity=mode==='void'?0:Number(form.get('quantity'));
 if(!Number.isSafeInteger(quantity)||quantity<0){setError('Enter a whole number of zero or more.');return;}
 const ticket=mode.startsWith('meal:')?account?.tickets?.find(t=>t.id===mode.slice(5)&&t.product==='food'&&t.assignedAt.startsWith(entry.day)):undefined;
 const corrected={...entry,quantity,...(entry.mission==='food'&&account?.entryCorrectionsEnabled&&mode!=='void'?{ticketId:ticket?.id,mealAt:ticket?.assignedAt,mealLabel:ticket?.label}:{})};
 const reason=mode==='void'?'Player voided this record.':`Player corrected quantity from ${entry.quantity} to ${quantity}${corrected.ticketId!==entry.ticketId?'; meal ticket coverage changed':''}.`;
 setReview({original:{...entry},corrected,reason});
 }}><label>Record type<RpgSelect value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><option value="quantity">{mission.episodic?'Penalty episode':'Progress'}</option>{entry.mission==='food'&&account?.tickets?.filter(t=>t.product==='food'&&t.assignedAt.startsWith(entry.day)).map(t=><option key={t.id} value={`meal:${t.id}`} disabled={!account.entryCorrectionsEnabled}>Ticket meal · {t.label}</option>)}<option value="void">Void record</option></RpgSelect></label>{mode!=='void'&&<label>Quantity<input name="quantity" type="number" min="0" step="1" defaultValue={entry.quantity} required disabled={busy}/></label>}<button disabled={busy}>Review correction</button></form>}
 {review&&<section className="record-comparison" aria-label="Correction comparison"><h3>Review correction</h3><p>Quantity: {review.original.quantity} → {review.corrected.quantity}</p>{review.original.ticketId!==review.corrected.ticketId&&<p>Coverage: {review.original.mealLabel||'No ticket'} → {review.corrected.mealLabel||'No ticket'}</p>}<p>Result: {before.result} → {after.result}</p><p>Balance change: <span className={delta.xp>=0?'mission-reward':'mission-penalty'}>{delta.xp>=0?'+':''}{delta.xp} XP</span> · <span className={delta.mc>=0?'mission-reward':'mission-penalty'}>{delta.mc>=0?'+':''}{delta.mc} MC</span></p><div className="actions"><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await correctEntry(entry.id,review.corrected,review.reason,review.original.revision);setReview(null);if(detailsRef.current){detailsRef.current.open=false;detailsRef.current.querySelector('summary')?.focus();}onSaved();}catch(e){setError(e instanceof Error?e.message:'Could not save');}finally{setBusy(false);}}}>{busy?'Saving…':'Confirm correction'}</button><button disabled={busy} onClick={()=>{setReview(null);setError('');}}>Back</button></div></section>}{error&&<p className="error" role="alert">{error}</p>}</details>;
}
