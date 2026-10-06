import {evaluate} from './game.ts';
import type {Mission,Result} from './game.ts';
import type {Entry,Decision,Objectives} from '../storage';
export function previewMission(m:Mission,entries:Entry[],decisions:Decision[],objectives:Objectives){
 const decision=decisions.find(d=>d.mission===m.id);
 const goal=objectives[m.id as keyof Objectives];
 const relevant=entries.filter(e=>e.mission===m.id);
 const total=relevant.reduce((sum,e)=>sum+e.quantity,0),uncovered=relevant.filter(e=>!(m.id==='food'&&e.ticketId)).reduce((sum,e)=>sum+e.quantity,0);
 let result:Result=decision?.result==='exempt'?'exempt':m.episodic&&uncovered>0?'failed':m.id==='food'&&total>0?'ticket':decision?.result||'pending';
 if(typeof goal==='number'){
 if(!decision&&total>=goal)result='fulfilled';
 if(result==='fulfilled'&&total<goal)result='failed';
 }
 return {m,total,result,effect:evaluate(m,result,m.episodic?uncovered:0)};
}
