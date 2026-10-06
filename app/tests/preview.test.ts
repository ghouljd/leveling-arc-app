import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missions} from '../src/domain/game.ts';
import {previewMission} from '../src/domain/preview.ts';
const objectives={status:'verified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10};
test('progreso sigue objetivos del rango, suma aportes y conserva exenciones',()=>{
 const m=missions.find(m=>m.id==='pushups')!,day='2026-10-05';
 const entry={id:'original',day,mission:m.id,quantity:5,unit:'repeticiones',note:'',occurredAt:day+'T12:00'};
 assert.equal(previewMission(m,[entry],[],objectives).result,'pending');
 assert.deepEqual(previewMission(m,[entry,{...entry,id:'segunda'}],[],objectives).effect,{xp:8,mc:2});
 assert.equal(previewMission(m,[{...entry,quantity:10}],[],{...objectives,rank:'C',pushups:20}).result,'pending');
 const decision={id:day+':pushups',day,mission:m.id,result:'exempt' as const,detail:'{"note":"Motivo"}'};
 assert.deepEqual(previewMission(m,[entry],[decision],objectives).effect,{xp:0,mc:0});
 assert.deepEqual(previewMission(m,[entry],[{...decision,result:'fulfilled'}],objectives).effect,{xp:0,mc:-10});
});
