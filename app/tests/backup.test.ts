import {before,after,mock} from 'node:test';
before(()=>mock.timers.enable({apis:['Date'],now:new Date('2026-10-06T20:00:00-05:00')}));
after(()=>mock.timers.reset());
import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import {db,selectPlayerStorage,addEntry,correctEntry,mergeSnapshot} from '../src/storage.ts';
import {createBackup,previewBackup,restoreBackup,validateBackup,historyCSV} from '../src/backup.ts';
const player='backup-test';
async function reset(){selectPlayerStorage(player);await db.delete();await db.open();}
test('respaldo: recuperación repetida conserva UUID, cola, saldo por verificar y no acredita otra vez',async()=>{
 await reset();await addEntry({day:'2026-10-05',mission:'pushups',quantity:10,unit:'repetición',note:'Nota, privada',occurredAt:'2026-10-05T12:00'});
 const entry=(await db.entries.toArray())[0],op=(await db.operations.toArray())[0];
 await db.operations.update(op.id,{status:'accepted'});
 const snapshot={schemaVersion:2,revision:1,entries:[entry],decisions:[],days:[],evaluations:[{id:'2026-10-05:pushups',day:'2026-10-05',mission:'pushups',result:'fulfilled' as const,xp:8,mc:2}],movements:[{id:'xp-1',resource:'xp' as const,amount:8,cause:'reward',accreditedAt:'2026-10-05T17:00:00Z'},{id:'mc-1',resource:'mc' as const,amount:2,cause:'reward',accreditedAt:'2026-10-05T17:00:00Z'}],balances:{xp:8,mc:2},level:1};
 await mergeSnapshot(db,snapshot);const copy=await createBackup();
 assert.equal('session' in copy,false);assert.equal(copy.owner,player);assert.match(historyCSV(copy),/Push-ups/);
 await db.delete();await db.open();
 const preview=await previewBackup(copy);assert.equal(preview.newRecords,2);assert.equal(preview.conflicts,0);
 await restoreBackup(copy);assert.equal((await db.operations.get(op.id))!.status,'pending');assert.equal((await db.meta.get('account'))!.value.importedUnverified,true);
 await restoreBackup(copy);assert.equal(await db.entries.count(),1);assert.equal(await db.operations.count(),1);assert.equal(await db.movements.count(),2);
 db.close();await db.open();assert.equal((await db.entries.get(entry.id))!.quantity,10);
 await mergeSnapshot(db,snapshot);assert.equal((await db.meta.get('account'))!.value.importedUnverified,undefined);assert.equal(await db.movements.count(),2);await db.delete();
});
test('respaldo: diferencias no sobrescriben y registros sin operación quedan en revisión',async()=>{
 await reset();await addEntry({day:'2026-10-05',mission:'steps',quantity:1000,unit:'paso',note:'',occurredAt:'2026-10-05T12:00'});
 const copy=await createBackup(),entry=copy.entries[0];await correctEntry(entry.id,1200,'Medición corregida');
 assert.equal((await previewBackup(copy)).conflicts,1);await restoreBackup(copy);assert.equal((await db.entries.get(entry.id))!.quantity,1200);assert.equal(await db.restores.count(),1);
 await restoreBackup(copy);assert.equal(await db.restores.count(),1);
 await db.delete();await db.open();await restoreBackup({...copy,operations:[]});assert.equal(await db.entries.count(),0);assert.equal(await db.restores.count(),1);await db.delete();
});
test('respaldo: rechaza otra identidad, valores corruptos, duplicados y contabilidad incompleta',async()=>{
 await reset();await addEntry({day:'2026-10-05',mission:'pushups',quantity:10,unit:'repetición',note:'',occurredAt:'2026-10-05T12:00'});const copy=await createBackup();
 assert.throws(()=>validateBackup({...copy,owner:'someone-else'},player),/another account/);
 assert.throws(()=>validateBackup({...copy,exportedAt:'bad'},player),/incompatible/);
 assert.throws(()=>validateBackup({...copy,entries:[copy.entries[0],copy.entries[0]]},player),/duplicate IDs/);
 assert.throws(()=>validateBackup({...copy,entries:[{...copy.entries[0],quantity:-1}]},player),/invalid/);
 assert.throws(()=>validateBackup({...copy,operations:[{...copy.operations[0],entityKey:'entry:wrong'}]},player),/invalid/);
 assert.throws(()=>validateBackup({...copy,account:{schemaVersion:2,revision:1,entries:[],decisions:[],balances:{xp:8,mc:2},level:1}},player),/balance/);
 assert.throws(()=>validateBackup({...copy,movements:[{id:'reverse',resource:'xp',amount:-8,cause:'reversal',accreditedAt:copy.exportedAt,reversesId:'missing'}]},player),/reversal/);await db.delete();
});
test('actualización IndexedDB v3→v4 conserva registros y cola existentes',async()=>{
 selectPlayerStorage('backup-upgrade');await db.delete();db.close();
 const old=new Dexie(db.name);old.version(3).stores({entries:'id,day,mission',decisions:'id,day,mission',operations:'id,day,status,sequence,entityKey',days:'id,day',evaluations:'id,day,mission',movements:'id',meta:'id'});
 await old.table('entries').add({id:'old-entry',day:'2026-10-05',mission:'steps',quantity:1000});await old.table('operations').add({id:'old-command',status:'pending',sequence:1});old.close();await db.open();
 assert.equal(await db.entries.count(),1);assert.equal(await db.operations.count(),1);assert.equal(await db.restores.count(),0);await db.delete();
});
