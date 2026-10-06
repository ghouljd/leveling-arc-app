import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {db,selectPlayerStorage,addEntry,queueClose} from '../src/storage.ts';
import {synchronizeStore} from '../src/sync-engine.ts';
import type {SyncRemote} from '../src/sync-engine.ts';
test('ciclo integrado: offline, reapertura, sesión caducada, respuesta perdida y reconexión sin duplicar',async()=>{
 const pg=new PGlite(),user='00000000-0000-0000-0000-000000000091',day='2026-10-06';
 selectPlayerStorage(user);const store=db;await store.delete();await store.open();
 try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.test_clock() returns timestamptz language sql as $$select '2026-10-06 20:00:00-05'::timestamptz$$;insert into auth.users values('${user}');`);
 for(const f of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','004_shop_sleep.sql','005_sleep_wake_day.sql','006_history_snapshot.sql','007_airofit.sql','008_entry_corrections.sql','009_incremental_sync.sql','010_snapshot_capabilities.sql','011_conflict_audit.sql'])await pg.exec((await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}'`);
 let online=false,sessionValid=false,loseCloseResponse=true,dropPage=0,pageCount=0;
 const calls:{name:string;operation:unknown}[]=[];
 const remote:SyncRemote={auth:{getUser:async()=>({data:{user:online&&sessionValid?{id:user}:null},error:online&&sessionValid?null:{message:'Offline or expired'}})},rpc:async(name,args={})=>{
 if(!online)return {data:null,error:{message:'Offline'}};
 calls.push({name,operation:args.p_operation});
 const params:Record<string,{sql:string;values:unknown[]}>= {
 wa_bootstrap:{sql:'select public.wa_bootstrap() r',values:[]},
 wa_apply_draft:{sql:'select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',values:[args.p_operation,args.p_kind,JSON.stringify(args.p_payload),args.p_base_revision]},
 wa_close:{sql:'select public.wa_close($1::uuid,$2::jsonb) r',values:[args.p_operation,JSON.stringify(args.p_payload)]},
 wa_sync_page:{sql:'select public.wa_sync_page($1::bigint,1) r',values:[args.p_cursor]}
 };
 if(name==='wa_sync_page'&&++pageCount===dropPage)return {data:null,error:{message:'Connection lost while paging'}};
 const query=params[name];assert.ok(query,'Unexpected RPC: '+name);
 const data=(await pg.query<{r:unknown}>(query.sql,query.values)).rows[0].r;
 if(name==='wa_close'&&loseCloseResponse){loseCloseResponse=false;return {data:null,error:{message:'Response lost after commit'}};}
 return {data,error:null};
 }};
 await addEntry({day,mission:'pushups',quantity:10,unit:'repeticiones',note:'Fixture aislado',occurredAt:day+'T12:00'});
 await queueClose(day,[{id:day+':pushups',day,mission:'pushups',result:'fulfilled',detail:'Fixture'}]);
 const initial=await store.operations.toArray(),ids=initial.map(o=>o.id);
 await assert.rejects(synchronizeStore(store,remote),/datos siguen guardados/);assert.equal(calls.length,0);
 store.close();await store.open();assert.deepEqual((await store.operations.toArray()).map(o=>o.id),ids);assert.equal((await store.entries.toArray())[0].quantity,10);
 online=true;await assert.rejects(synchronizeStore(store,remote),/inicia sesión/);assert.equal(calls.length,0);assert.equal(await store.operations.where('status').equals('pending').count(),2);
 sessionValid=true;await assert.rejects(synchronizeStore(store,remote),/cola está conservada/);
 assert.equal(await store.operations.where('status').equals('pending').count(),1);
 const snapshot=async()=>(await pg.query<{r:{balances:{xp:number;mc:number};movements:unknown[]}}>('select public.wa_account_snapshot() r')).rows[0].r;
 assert.deepEqual((await snapshot()).balances,{xp:8,mc:2});assert.equal((await snapshot()).movements.length,2);
 store.close();await store.open();dropPage=2;
 await assert.rejects(synchronizeStore(store,remote),/cursor y los datos locales se conservan/);
 assert.equal(await store.meta.get('account'),undefined);assert.equal(await store.movements.count(),0);assert.equal((await snapshot()).movements.length,2);
 dropPage=0;assert.equal(await synchronizeStore(store,remote),'Registros y contabilidad sincronizados.');
 assert.deepEqual((await store.meta.get('account'))?.value.balances,{xp:8,mc:2});assert.equal(await store.movements.count(),2);assert.equal(await store.operations.where('status').equals('pending').count(),0);
 assert.deepEqual(calls.filter(c=>c.name==='wa_close').map(c=>c.operation),[ids.find(id=>initial.find(o=>o.id===id)?.kind==='close-preview'),ids.find(id=>initial.find(o=>o.id===id)?.kind==='close-preview')]);
 const cursor=(await store.meta.get('account'))!.value.syncCursor;assert.equal(typeof cursor,'number');
 await synchronizeStore(store,remote);assert.equal(await store.movements.count(),2);assert.equal((await store.meta.get('account'))!.value.syncCursor,cursor);
 // Switching account while authenticated for the original identity cannot send its queue.
 selectPlayerStorage('00000000-0000-0000-0000-000000000092');const second=db;await second.delete();await second.open();
 await assert.rejects(synchronizeStore(second,remote),/cuenta cambió/);assert.equal(await second.entries.count(),0);await second.delete();
 }finally{await store.delete();await pg.close();}
});
