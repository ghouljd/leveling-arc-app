import React from 'react';
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
 async function sync(){setBusy(true);try{setMessage(await synchronize());}catch(error){setMessage(error instanceof Error?error.message:'No se pudo confirmar la compra. Reintenta con conexión.');}finally{setBusy(false);}}
 return <section><h1>Tienda</h1><p>{account?.importedUnverified?'Saldo de respaldo, por verificar':'Saldo confirmado'}: <strong>{account?.balances?.mc??'—'} MC</strong></p><p className="muted">Semana desde el {week} · Bogotá. Compra antes de la ocasión. Los tickets cuestan 250 MC, no se reembolsan ni se acumulan entre semanas.</p>
 {account?.sleepReference!=='wake-day'&&<p role="status">La referencia de descanso requiere la migración 005 y una sincronización posterior.</p>}
 <p role="status">{message}</p>
 {pending&&<section className="hero"><p>Compra enviada pendiente de confirmación. El reintento usa la misma solicitud para evitar cargos duplicados.</p><button disabled={busy} onClick={()=>void sync()}>Reintentar confirmación</button></section>}
 {ops.filter(o=>o.status==='discarded').slice(0,1).map(o=><p className="error" key={o.id}>Última compra rechazada: {o.serverResult?.message}</p>)}
 {(['food','sleep'] as const).map(product=>{const limit=product==='food'?1:2,ticketWeek=product==='sleep'?weekStart(sleepDay):week,used=(account?.tickets||[]).filter(t=>t.weekStart===ticketWeek&&t.product===product).length;return <section className="hero" key={product}><h2>{product==='food'?'Comida libre':'Noche libre'}</h2><p><strong>250 MC</strong> · {Math.max(0,limit-used)} / {limit} disponibles en la semana del {ticketWeek}</p><p className="muted">{product==='food'?'Cubre las porciones de una sola comida asignada. El alcohol conserva su sanción.':'Cubre las horas de una noche asignada. Debes dormir al menos 7 h efectivas; si no, se descuentan 15 MC.'} Sin premio de XP ni MC al utilizarlo.</p><form onSubmit={async e=>{e.preventDefault();if(!navigator.onLine){setMessage('Necesitas conexión para comprar.');return;}const form=new FormData(e.currentTarget);const assignedAt=String(form.get('assignedAt')),label=String(form.get('label')).trim();setBusy(true);try{await queuePurchase(product,assignedAt,label,product==='sleep'?sleepDay:undefined);setMessage(await synchronize());}catch(error){setMessage(error instanceof Error?error.message:'No se pudo confirmar la compra.');}finally{setBusy(false);}}}>
 {product==='sleep'&&<><label>Día en que te levantarás<DateInput type="date" min={today} max="2026-12-31" required value={sleepDay} onChange={e=>{if(e.target.value)setSleepDay(e.target.value);}}/></label><p className="muted">La noche pertenece al día de despertar. Para el lunes puedes comprar el domingo antes de acostarte; usa el cupo de la semana del lunes.</p></>}
 <label>{product==='food'?'Fecha y hora de la comida':'Fecha y hora prevista de acostarte'} (Bogotá)<DateInput name="assignedAt" type="datetime-local" required min={`${today}T00:00`} defaultValue={`${today}T${product==='food'?'19:00':'22:30'}`}/></label><label>{product==='food'?'Nombre de la comida':'Nombre de la ocasión'}<input name="label" required maxLength={100} placeholder={product==='food'?'Cena de cumpleaños':'Noche del sábado'}/></label><button disabled={busy||pending||account?.sleepReference!=='wake-day'||account?.importedUnverified||(account?.balances?.mc??0)<250||used>=limit}>Comprar por 250 MC</button>
 </form></section>;})}
 <h2>Mis tickets</h2>{!account?.tickets?.length&&<p className="muted">Todavía no tienes tickets.</p>}{account?.tickets?.map(t=><section className="mission" key={t.id}><h3>{t.product==='food'?'Comida libre':'Noche libre'} · {t.label}</h3><p>{t.assignedAt.replace('T',' · ')} · Bogotá{t.product==='sleep'&&t.wakeDay?' · Descanso del '+t.wakeDay:''}</p><p className="muted">{t.state==='used'?'Utilizado':t.state==='expired'?'Vencido':'Asignado'} · vence el {t.expiresOn}</p></section>)}
 </section>;
}
