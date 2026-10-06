import {missions} from './game.ts';
import type {Evaluation,Decision,Operation,Movement} from '../storage';
export const seasonStart='2026-10-05',seasonEnd='2026-12-31';
export function shiftDay(day:string,offset:number){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
export function dates(from=seasonStart,to=seasonEnd){const days:string[]=[];for(let day=from;day<=to;day=shiftDay(day,1))days.push(day);return days;}
export function daySummary(day:string,evaluations:Evaluation[],operations:Operation[],today:string){
 const rows=evaluations.filter(e=>e.day===day),confirmed=rows.filter(e=>e.result!=='pending').length;
 const dirty=operations.some(o=>o.day===day&&(o.status==='pending'||o.status==='conflict')&&o.kind!=='conflict-resolution'&&o.kind!=='purchase');
 return {confirmed,dirty,status:day>today?'future':dirty?'unsynced':confirmed===missions.length?'complete':confirmed>0?'partial':'pending',xp:rows.reduce((n,e)=>n+e.xp,0),mc:rows.reduce((n,e)=>n+e.mc,0),tickets:rows.filter(e=>e.result==='ticket').length,exempt:rows.filter(e=>e.result==='exempt').length};
}
export function missionCounts(mission:string,days:string[],evaluations:Evaluation[]){
 const counts={fulfilled:0,failed:0,ticket:0,exempt:0,pending:0};
 for(const day of days){const row=evaluations.find(e=>e.day===day&&e.mission===mission);counts[row?.result||'pending']++;}return counts;
}
export function sleepCounts(days:string[],evaluations:Evaluation[],decisions:Decision[]){
 const counts={strict:0,flexible:0,ticket:0,failed:0,exempt:0,pending:0,registered:0};
 for(const day of days){const row=evaluations.find(e=>e.day===day&&e.mission==='sleep');if(!row||row.result==='pending'){counts.pending++;continue;}if(row.result==='exempt'){counts.exempt++;continue;}counts.registered++;
 let detail:{coverage?:string}={};try{detail=JSON.parse(decisions.find(d=>d.day===day&&d.mission==='sleep')?.detail||'{}');}catch{/* Legacy notes carry no coverage. */}
 if(detail.coverage==='flexible')counts.flexible++;if(detail.coverage==='ticket'||row.result==='ticket')counts.ticket++;
 if(row.result==='failed')counts.failed++;if(row.result==='fulfilled'&&(!detail.coverage||detail.coverage==='strict'))counts.strict++;
 }return counts;
}
export function ledgerTotals(movements:Movement[]){return {rewards:movements.filter(m=>m.resource==='mc'&&m.cause==='mission'&&m.amount>0).reduce((n,m)=>n+m.amount,0),penalties:movements.filter(m=>m.resource==='mc'&&m.cause==='mission'&&m.amount<0).reduce((n,m)=>n+m.amount,0),purchases:movements.filter(m=>m.resource==='mc'&&m.cause==='purchase').reduce((n,m)=>n+m.amount,0),reversals:movements.filter(m=>m.resource==='mc'&&m.cause==='reversal').reduce((n,m)=>n+m.amount,0)};}
export const seasonMaximum=dates().length*missions.reduce((n,m)=>n+m.xp,0);
