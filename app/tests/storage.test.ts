import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, addEntry, setDecision, queueClose, correctEntry, selectPlayerStorage, mergeSnapshot, resolveConflict, queuePurchase } from '../src/storage.ts';
test('registro y cola sobreviven a reabrir la base; cierre repetido es idempotente',async()=>{
 await db.delete();await db.open();
 await addEntry({day:'2026-10-05',mission:'pushups',quantity:10,unit:'repetición',note:'',occurredAt:'2026-10-05T12:00'});
 await setDecision({day:'2026-10-05',mission:'coach',result:'fulfilled',detail:'descanso prescrito'});
 const results=[{id:'2026-10-05:pushups',day:'2026-10-05',mission:'pushups',result:'fulfilled' as const,detail:''}];
 await queueClose('2026-10-05',results);await queueClose('2026-10-05',results);
 assert.equal(await db.operations.count(),3);
 db.close();await db.open();
 assert.equal((await db.entries.toArray())[0].quantity,10);
 assert.equal((await db.decisions.toArray())[0].detail,'descanso prescrito');
 const close=(await db.operations.toArray()).find(o=>o.kind==='close-preview')!;
 assert.equal((close.payload as {entries:unknown[]}).entries.length,1);
 const original=(await db.entries.toArray())[0];
 await correctEntry(original.id,0,'Anulación de prueba');
 assert.equal((await db.entries.get(original.id))!.quantity,0);
 const correction=(await db.operations.toArray()).find(o=>o.kind==='correct-entry')!;
 assert.equal((correction.payload as {original:{quantity:number}}).original.quantity,10);
 await db.delete();
});
test('cuentas separadas no heredan datos técnicos ni operaciones de otro Player',async()=>{
 selectPlayerStorage('test-player-a');await db.delete();await db.open();
 await addEntry({day:'2026-10-05',mission:'steps',quantity:500,unit:'paso',note:'',occurredAt:'2026-10-05T12:00'});
 selectPlayerStorage('test-player-b');await db.delete();await db.open();
 assert.equal(await db.entries.count(),0);assert.equal(await db.operations.count(),0);
 await db.delete();selectPlayerStorage('test-player-a');await db.open();
 assert.equal(await db.entries.count(),1);await db.delete();
});
test('descarga respeta un aporte pendiente y una resolución conserva trazabilidad',async()=>{
 selectPlayerStorage('test-merge');await db.delete();await db.open();
 await addEntry({day:'2026-10-05',mission:'pushups',quantity:10,unit:'repetición',note:'',occurredAt:'2026-10-05T12:00'});
 const entry=(await db.entries.toArray())[0];const operation=(await db.operations.toArray())[0];
 await mergeSnapshot(db,{schemaVersion:2,revision:1,entries:[{...entry,quantity:20}],decisions:[]});
 assert.equal((await db.entries.get(entry.id))!.quantity,10);
 await db.operations.update(operation.id,{status:'conflict',serverResult:{status:'conflict',current:{...entry,quantity:20,revision:2}}});
 await resolveConflict(operation.id,'remote','Conservar confirmación de otra sesión');
 assert.equal((await db.entries.get(entry.id))!.quantity,20);
 assert.equal((await db.operations.get(operation.id))!.status,'discarded');
 assert.equal((await db.operations.toArray()).filter(o=>o.kind==='conflict-resolution').length,1);
 await db.delete();
});

test('una compra conserva su identificador al reabrir y bloquea otra solicitud pendiente',async()=>{
 selectPlayerStorage('test-purchase');await db.delete();await db.open();
 await queuePurchase('food','2026-10-05T19:00','Cena');
 const purchase=(await db.operations.toArray())[0];db.close();await db.open();
 assert.equal((await db.operations.toArray())[0].id,purchase.id);
 await assert.rejects(queuePurchase('sleep','2026-10-05T22:30','Noche','2026-10-06'),/pendiente/);
 assert.equal(await db.operations.count(),1);
 await db.operations.update(purchase.id,{status:'accepted'});
 await queuePurchase('sleep','2026-10-05T22:30','Noche','2026-10-06');
 assert.equal(await db.operations.count(),2);await db.delete();
});

test('corrección ampliada exige nueva comparación tras edición concurrente y conserva original',async()=>{
 selectPlayerStorage('test-expanded-correction');await db.delete();await db.open();
 await addEntry({day:'2026-10-05',mission:'alcohol',quantity:3,unit:'trago',note:'',occurredAt:'2026-10-05T12:00'});
 const original=(await db.entries.toArray())[0];
 await correctEntry(original.id,{...original,quantity:1,note:'Nota corregida',unit:'copa',occurredAt:'2026-10-05T13:00'},'Error de registro',original.revision);
 await assert.rejects(correctEntry(original.id,2,'Comparación antigua',original.revision),/cambió/);
 db.close();await db.open();assert.equal((await db.entries.get(original.id))?.unit,'copa');
 const correction=(await db.operations.toArray()).find(o=>o.kind==='correct-entry')!;
 assert.deepEqual((correction.payload as {original:unknown}).original,original);
 await db.delete();
});

test('delta remoto conserva contabilidad completa y cursor sin mezclar datos locales pendientes',async()=>{
 selectPlayerStorage('test-incremental');await db.delete();await db.open();
 const entry={id:crypto.randomUUID(),day:'2026-10-05',mission:'steps',quantity:1000,unit:'paso',note:'',occurredAt:'2026-10-05T12:00',revision:1};
 const movement={id:crypto.randomUUID(),resource:'xp' as const,amount:8,cause:'mission',accreditedAt:'2026-10-05T18:00:00-05:00'};
 await mergeSnapshot(db,{schemaVersion:2,revision:10,syncCursor:10,entries:[entry],decisions:[],movements:[movement],balances:{xp:8,mc:2}});
 await correctEntry(entry.id,1200,'Cambio offline');
 await mergeSnapshot(db,{schemaVersion:2,revision:20,syncCursor:20,entries:[{...entry,quantity:1100,revision:2}],decisions:[],movements:[],balances:{xp:8,mc:2}});
 assert.equal((await db.entries.get(entry.id))?.quantity,1200);
 const canonical=(await db.meta.get('account'))!.value;assert.equal(canonical.entries[0].quantity,1100);assert.equal(canonical.movements?.length,1);assert.equal(canonical.syncCursor,20);
 await mergeSnapshot(db,{schemaVersion:2,revision:21,syncCursor:21,entries:[],decisions:[]},[{collection:'entries',key:entry.id}]);
 assert.equal(await db.entries.count(),1);assert.equal((await db.meta.get('account'))!.value.entries.length,0);
 await db.delete();
});
