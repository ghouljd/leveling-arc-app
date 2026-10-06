import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missions, evaluate, levelThreshold, progress, sleepResult } from '../src/domain/game.ts';
test('día perfecto y un fallo', () => {
 const total = missions.map(m => evaluate(m, 'fulfilled')).reduce((a,b) => ({xp:a.xp+b.xp,mc:a.mc+b.mc}),{xp:0,mc:0});
 assert.deepEqual(total,{xp:118,mc:27});
 assert.equal(total.mc - 2 + evaluate(missions[5],'failed').mc,15);
});
test('episodios no tienen límite y ticket no cubre los restantes', () => {
 assert.deepEqual(evaluate(missions[3],'failed',3),{xp:0,mc:-30});
 assert.deepEqual(evaluate(missions[2],'ticket',2),{xp:0,mc:-20});
 assert.deepEqual(evaluate(missions[3],'pending'),{xp:0,mc:0});
 assert.deepEqual(evaluate(missions[3],'exempt'),{xp:0,mc:0});
});
test('umbrales y días de desbloqueo', () => {
 [4,7,10,13].forEach((level,i)=>{
 assert.equal(levelThreshold(level),[1042,2628,5039,8705][i]);
 assert.equal(Math.ceil(levelThreshold(level)/118),[9,23,43,74][i]);
 assert.equal(progress(levelThreshold(level)).level,level);
 });
});
test('horario exacto, sueño efectivo y excepciones', () => {
 assert.equal(sleepResult('22:30','06:30',420,'strict'),'fulfilled');
 assert.equal(sleepResult('22:29','06:31',480,'strict'),'failed');
 assert.equal(sleepResult('01:00','09:00',420,'flexible'),'fulfilled');
 assert.equal(sleepResult('01:00','09:00',420,'ticket'),'ticket');
 assert.deepEqual(evaluate(missions[6],sleepResult('01:00','09:00',419,'ticket')),{xp:0,mc:-15});
});
