import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dates,seasonMaximum,daySummary,missionCounts,sleepCounts,ledgerTotals} from '../src/domain/reports.ts';
import {missions} from '../src/domain/game.ts';
import type {Evaluation,Decision,Movement,Operation} from '../src/storage.ts';
test('historial diferencia completo, parcial, pendiente, futuro y cambios sin confirmar',()=>{
 assert.equal(dates().length,88);assert.equal(seasonMaximum,10384);
 const rows:Evaluation[]=missions.map(m=>({id:m.id,day:'2026-10-05',mission:m.id,result:'fulfilled' as const,xp:m.xp,mc:m.mc}));
 rows[0]={...rows[0],result:'ticket',xp:0,mc:0};
 assert.equal(daySummary('2026-10-05',rows,[],'2026-10-05').status,'complete');
 assert.equal(daySummary('2026-10-05',rows.slice(0,1),[],'2026-10-05').status,'partial');
 const ops=[{id:'edit',day:'2026-10-05',kind:'set-decision',status:'pending',createdAt:'',payload:{}}] as Operation[];
 assert.equal(daySummary('2026-10-05',rows,ops,'2026-10-05').status,'unsynced');
 assert.equal(daySummary('2026-10-06',[],[],'2026-10-05').status,'future');
 assert.equal(daySummary('2026-10-05',[],[],'2026-10-05').status,'pending');
});
test('semana incompleta: pendientes visibles, tickets y exenciones separados del cumplimiento',()=>{
 const days=dates('2026-10-05','2026-10-07');
 const rows=[{day:days[0],mission:'sleep',result:'fulfilled'}, {day:days[1],mission:'sleep',result:'ticket'}].map((r,i)=>({...r,id:String(i),xp:0,mc:0})) as Evaluation[];
 assert.deepEqual(missionCounts('sleep',days,rows),{fulfilled:1,failed:0,ticket:1,exempt:0,pending:1});
 const decisions=[{id:'a',day:days[0],mission:'sleep',result:'fulfilled',detail:'{"coverage":"flexible"}'},{id:'b',day:days[1],mission:'sleep',result:'ticket',detail:'{"coverage":"ticket"}'}] as Decision[];
 assert.deepEqual(sleepCounts(days,rows,decisions),{strict:0,flexible:1,ticket:1,failed:0,exempt:0,pending:1,registered:2});
 assert.equal(dates('2026-12-28','2026-12-31').length,4);
});
test('libro conserva premios, sanciones y reversión por separado',()=>{
 const moves=[{resource:'mc',amount:25,cause:'mission'},{resource:'mc',amount:-15,cause:'mission'},{resource:'mc',amount:15,cause:'reversal'},{resource:'mc',amount:-250,cause:'purchase'}] as Movement[];
 assert.deepEqual(ledgerTotals(moves),{rewards:25,penalties:-15,reversals:15,purchases:-250});
});
