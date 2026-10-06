import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {db,selectPlayerStorage,isDayClosed,assertDayEditable,previousDay,localDay} from '../src/storage.ts';
import {synchronizeStore} from '../src/sync-engine.ts';
import type {Entry,Snapshot} from '../src/storage.ts';
import type {SyncRemote} from '../src/sync-engine.ts';
test('expired offline changes are audited, removed and recovered even after an interrupted snapshot download',async()=>{
 const user='expired-sync';selectPlayerStorage(user);const store=db;await store.delete();await store.open();
 try{
 const day=previousDay(previousDay(localDay()));
 assert.equal(isDayClosed(day),true);assert.equal(isDayClosed(previousDay(localDay())),false);assert.throws(()=>assertDayEditable(day),/Day is closed/);
 const original:Entry={id:crypto.randomUUID(),day,mission:'pushups',quantity:10,unit:'rep',note:'',occurredAt:day+'T12:00',revision:1};
 const late={...original,id:crypto.randomUUID(),quantity:5};
 await store.entries.bulkPut([{...original,quantity:20},late]);
 for(const [index,entry] of [original,late].entries())await store.operations.add({id:crypto.randomUUID(),day,kind:index===0?'correct-entry':'add-entry',payload:index===0?{original,corrected:{...original,quantity:20},reason:'Edit'}:late,entityKey:'entry:'+entry.id,sequence:index+1,baseRevision:index===0?1:0,status:'pending',createdAt:new Date().toISOString()});
 const authoritative:Snapshot={schemaVersion:2,revision:10,entries:[original],decisions:[],days:[{id:day,day,objectives:{status:'verified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10},closedAt:day+'T05:00:00Z'}],balances:{xp:8,mc:-100}};
 let failDownload=true,writes=0;
 const remote:SyncRemote={auth:{getUser:async()=>({data:{user:{id:user}},error:null})},rpc:async(name)=>{
  if(name==='wa_bootstrap')return {data:null,error:null};
  if(name==='wa_apply_draft'){writes++;return {data:null,error:{code:'P0001',message:'Day is closed. Records can no longer be changed.'}};}
  assert.equal(name,'wa_account_snapshot');return failDownload?{data:null,error:{message:'Offline'}}:{data:authoritative,error:null};
 }};
 await assert.rejects(synchronizeStore(store,remote),/download history/);assert.equal(writes,1);assert.equal(await store.operations.where('status').equals('discarded').count(),2);
 failDownload=false;assert.match(await synchronizeStore(store,remote),/Late changes were discarded/);
 assert.equal(writes,1);assert.equal((await store.entries.get(original.id))?.quantity,10);assert.equal(await store.entries.get(late.id),undefined);assert.deepEqual((await store.meta.get('account'))?.value.balances,authoritative.balances);
 assert.equal((await store.operations.toArray()).every(o=>o.serverResult?.category==='closed-day-restored'),true);
 }finally{await store.delete();}
});
