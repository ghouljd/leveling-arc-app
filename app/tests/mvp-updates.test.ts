import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('edición ampliada y páginas por Player: auditoría, conflictos, rollback y aislamiento',async()=>{
 const pg=new PGlite();try{
 const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',day='2026-10-05';
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.test_clock() returns timestamptz language sql as $$select '2026-10-06 20:00:00-05'::timestamptz$$;
 insert into auth.users values('${user}'),('${other}');`);
 for(const f of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','004_shop_sleep.sql','005_sleep_wake_day.sql','006_history_snapshot.sql','007_airofit.sql','008_entry_corrections.sql','009_incremental_sync.sql','010_snapshot_capabilities.sql','011_conflict_audit.sql'])await pg.exec((await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}'`);
 const page=async(cursor:number|null,limit=1)=>(await pg.query<{r:any}>('select public.wa_sync_page($1::bigint,$2::integer) r',[cursor,limit])).rows[0].r;
 const first=await page(null);assert.equal(first.hasMore,false);
 const entry={id:crypto.randomUUID(),day,mission:'alcohol',quantity:3,unit:'trago',note:'',occurredAt:day+'T12:00'};
 const apply=async(payload:unknown,kind:string,base=0,id=crypto.randomUUID())=>(await pg.query<{r:any}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[id,kind,JSON.stringify(payload),base])).rows[0].r;
 await apply(entry,'add-entry');
 const snapshot=async()=>(await pg.query<{r:any}>('select public.wa_account_snapshot() r')).rows[0].r;
 let s=await snapshot();await pg.query('select public.wa_close($1::uuid,$2::jsonb)',[crypto.randomUUID(),JSON.stringify({day,results:[{mission:'alcohol'}],entries:s.entries,decisions:[],objectives:{rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10}})]);
 assert.equal((await snapshot()).balances.mc,-30);
 const corrected={...entry,quantity:1,unit:'copa',note:'Corrección aislada',occurredAt:day+'T13:00'},payload={original:entry,corrected,reason:'Ajuste de error'},op=crypto.randomUUID();
 await apply(payload,'correct-entry',1,op);s=await snapshot();assert.equal(s.balances.mc,-10);assert.equal(s.entries.find((e:any)=>e.id===entry.id).note,corrected.note);assert.equal(s.entries.find((e:any)=>e.id===entry.id).unit,'copa');assert.equal(s.entries.find((e:any)=>e.id===entry.id).occurredAt,corrected.occurredAt);
 const movementCount=s.movements.length;await apply(payload,'correct-entry',1,op);assert.equal((await snapshot()).movements.length,movementCount);
 const conflictId=crypto.randomUUID();assert.equal((await apply({...payload,corrected:{...corrected,quantity:2}},'correct-entry',1,conflictId)).status,'conflict');
 const auditId=crypto.randomUUID(),auditPayload={conflictId,discardedIds:[conflictId],choice:'remote',reason:'Mantener dato confirmado'};
 const audit=async()=>(await pg.query<{r:any}>('select public.wa_audit_resolution($1::uuid,$2::jsonb) r',[auditId,JSON.stringify(auditPayload)])).rows[0].r;
 assert.equal((await audit()).status,'accepted');assert.equal((await audit()).status,'accepted');

 await assert.rejects(apply({...payload,corrected:{...corrected,day:'2026-10-06',occurredAt:'2026-10-06T13:00'}},'correct-entry',2),/preserve day/);
 let cursor=first.cursor,pages=0;const ids=new Set();for(;;){const p=await page(cursor);assert.ok(p.cursor>cursor);cursor=p.cursor;pages++;for(const e of p.snapshot.entries)ids.add(e.id);if(!p.hasMore)break;assert.ok(pages<100);}
 assert.ok(pages>1);assert.ok(ids.has(entry.id));assert.equal(cursor,(await snapshot()).revision);
 const empty=await page(cursor);assert.deepEqual(empty.snapshot.entries,[]);assert.deepEqual(empty.snapshot.movements,[]);
 await pg.exec('reset role;begin');await pg.query('update wa_private.entries set note=$1 where player_id=$2::uuid',['rollback',user]);await pg.exec('rollback;set role authenticated');assert.equal((await page(cursor)).cursor,cursor);
 const firstPaged=await page(null,1);assert.equal(firstPaged.hasMore,true);assert.ok(firstPaged.snapshot.entries.length<=1);
 const beforeReseed=await snapshot();
 await pg.exec('reset role;delete from wa_private.sync_changes');
 await pg.exec((await readFile(new URL('../supabase/migrations/009_incremental_sync.sql',import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));
 await pg.exec('set role authenticated');
 const reseeded=await page(null,1);assert.equal(reseeded.hasMore,true);assert.deepEqual((await snapshot()).balances,beforeReseed.balances);assert.deepEqual((await snapshot()).entries,beforeReseed.entries);
 await pg.exec(`set request.jwt.claim.sub='${other}'`);const isolated=await page(null);assert.equal(isolated.snapshot.entries.length,0);assert.deepEqual(isolated.snapshot.balances,{xp:0,mc:0});
 await pg.exec('set role anon');await assert.rejects(page(null),/permission denied/);
 }finally{await pg.close();}
});
