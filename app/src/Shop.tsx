import React from 'react';
import {serverMessage} from './server-message';
import {DateInput} from './DateInput';
import { liveQuery } from 'dexie';
import { db,localDay,weekStart,nextDay,queuePurchase } from './storage';
import type {Snapshot,Operation} from './storage';
import {synchronize} from './sync';
export function Shop(){
 const [account,setAccount]=React.useState<Snapshot|null>(null),[ops,setOps]=React.useState<Operation[]>([]);
 const [busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('');
 const today=localDay(),week=weekStart(today);
 const [sleepDay,setSleepDay]=React.useState(nextDay(today));
 React.useEffect(()=>{const sub=liveQuery(async()=>({account:await db.meta.get('account'),ops:await db.operations.toArray()})).subscribe(value=>{setAccount(value.account?.value||null);setOps(value.ops.filter(o=>o.kind==='purchase').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));});return()=>sub.unsubscribe();},[]);
 const pending=ops.some(o=>o.status==='pending');
 async function sync(){setBusy(true);try{setMessage(await synchronize());}catch(error){setMessage(error instanceof Error?error.message:'Could not confirm the purchase. Try again while online.');}finally{setBusy(false);}}
 return <section><h1>Shop</h1><p>{account?.importedUnverified?'Backup balance, awaiting verification':'Confirmed balance'}: <strong>{account?.balances?.mc??'—'} MC</strong></p><p className="muted">Week starting {week} · Bogotá. Buy before the occasion. Tickets cost 250 MC, are non-refundable and do not carry over between weeks.</p>
 {account?.sleepReference!=='wake-day'&&<p role="status">Sleep records require migration 005 followed by a sync.</p>}
 <p role="status">{message}</p>
 {pending&&<section className="hero"><p>Purchase sent and awaiting confirmation. Retrying uses the same request to avoid duplicate charges.</p><button disabled={busy} onClick={()=>void sync()}>Retry confirmation</button></section>}
 {ops.filter(o=>o.status==='discarded').slice(0,1).map(o=><p className="error" key={o.id}>Last rejected purchase: {serverMessage(o.serverResult?.message)}</p>)}
 {(['food','sleep'] as const).map(product=>{const limit=product==='food'?1:2,ticketWeek=product==='sleep'?weekStart(sleepDay):week,used=(account?.tickets||[]).filter(t=>t.weekStart===ticketWeek&&t.product===product).length;return <section className="hero" key={product}><h2>{product==='food'?'Special meal':'Flexible bedtime'}</h2><p><strong>250 MC</strong> · {Math.max(0,limit-used)} / {limit} available for the week of {ticketWeek}</p><p className="muted">{product==='food'?'Covers the portions of one assigned meal. Alcohol penalties still apply.':'Covers the schedule of one assigned night. You must get at least 7 hours of actual sleep; otherwise, 15 MC are deducted.'} No XP or MC rewards when used.</p><form onSubmit={async e=>{e.preventDefault();if(!navigator.onLine){setMessage('You must be online to purchase.');return;}const form=new FormData(e.currentTarget);const assignedAt=String(form.get('assignedAt')),label=String(form.get('label')).trim();setBusy(true);try{await queuePurchase(product,assignedAt,label,product==='sleep'?sleepDay:undefined);setMessage(await synchronize());}catch(error){setMessage(error instanceof Error?error.message:'Could not confirm the purchase.');}finally{setBusy(false);}}}>
 {product==='sleep'&&<><label>Wake-up day<DateInput type="date" min={today} max="2026-12-31" required value={sleepDay} onChange={e=>{if(e.target.value)setSleepDay(e.target.value);}}/></label><p className="muted">The night belongs to your wake-up day. For Monday, you can buy on Sunday before bedtime using Monday's weekly allowance.</p></>}
 <label>{product==='food'?'Meal date and time':'Planned bedtime date and time'} (Bogotá)<DateInput name="assignedAt" type="datetime-local" required min={`${today}T00:00`} defaultValue={`${today}T${product==='food'?'19:00':'22:30'}`}/></label><label>{product==='food'?'Meal name':'Occasion name'}<input name="label" required maxLength={100} placeholder={product==='food'?'Birthday dinner':'Saturday night'}/></label><button disabled={busy||pending||account?.sleepReference!=='wake-day'||account?.importedUnverified||(account?.balances?.mc??0)<250||used>=limit}>Buy for 250 MC</button>
 </form></section>;})}
 <h2>My tickets</h2>{!account?.tickets?.length&&<p className="muted">You have no tickets yet.</p>}{account?.tickets?.map(t=><section className="mission" key={t.id}><h3>{t.product==='food'?'Special meal':'Flexible bedtime'} · {t.label}</h3><p>{t.assignedAt.replace('T',' · ')} · Bogotá{t.product==='sleep'&&t.wakeDay?' · Sleep for '+t.wakeDay:''}</p><p className="muted">{t.state==='used'?'Used':t.state==='expired'?'Expired':'Assigned'} · expires on {t.expiresOn}</p></section>)}
 </section>;
}
