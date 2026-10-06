import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Bogotá midnight locks expired days, preserves rewards and accounts missing missions exactly once',async()=>{
 const pg=new PGlite();try{
 const user='00000000-0000-0000-0000-000000000001';
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.test_clock() returns timestamptz language sql as $$select current_setting('test.clock')::timestamptz$$;set test.clock='2026-10-06 23:59:59-05';insert into auth.users values('${user}');`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await pg.exec((await readFile(new URL(file,dir),'utf8')).replaceAll('now()','public.test_clock()'));
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap();`);
 const snapshot=async()=>(await pg.query<{r:any}>('select public.wa_account_snapshot() r')).rows[0].r;
 const apply=async(v:any,base=0,op=crypto.randomUUID(),kind='set-decision')=>(await pg.query<{r:any}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[op,kind,JSON.stringify(v),base])).rows[0].r;
 const day='2026-10-05',entry={id:crypto.randomUUID(),day,mission:'pushups',quantity:10,unit:'rep',note:'',occurredAt:day+'T12:00'},op=crypto.randomUUID();
 await apply(entry,0,op,'add-entry');
 await apply({...entry,id:crypto.randomUUID(),mission:'reading',quantity:1,unit:'page'},0,crypto.randomUUID(),'add-entry');
 await apply({...entry,id:crypto.randomUUID(),mission:'alcohol',quantity:2,unit:'drink'},0,crypto.randomUUID(),'add-entry');
 let s=await snapshot();assert.equal(s.days.find((d:any)=>d.day===day).closedAt,null);assert.equal(s.evaluations.length,2);
 await pg.exec("set test.clock='2026-10-07 00:00:00-05'");
 const page=(await pg.query<{r:any}>('select public.wa_sync_page(null,200) r')).rows[0].r;
 assert.equal(page.hasMore,false);assert.equal(page.snapshot.evaluations.filter((e:any)=>e.day===day).length,13);
 s=await snapshot();assert.equal(s.automaticDayClosureEnabled,true);
 assert.equal(new Date(s.days.find((d:any)=>d.day===day).closedAt).toISOString(),'2026-10-07T05:00:00.000Z');
 const results=s.evaluations.filter((e:any)=>e.day===day);assert.equal(results.length,13);assert.equal(results.find((e:any)=>e.mission==='pushups').result,'fulfilled');
 assert.equal(results.find((e:any)=>e.mission==='reading').result,'failed');assert.equal(results.find((e:any)=>e.mission==='alcohol').mc,-20);assert.equal(results.find((e:any)=>e.mission==='sleep').mc,-15);assert.equal(results.filter((e:any)=>e.result==='failed').length,12);
 const balance=s.balances,movements=s.movements.length;assert.deepEqual((await snapshot()).balances,balance);assert.equal((await snapshot()).movements.length,movements);
 await assert.rejects(apply({...entry,id:crypto.randomUUID()},0,crypto.randomUUID(),'add-entry'),/Day is closed/);
 await assert.rejects(apply({day,mission:'coach',result:'fulfilled',detail:'{}'}),/Day is closed/);
 await assert.rejects(apply({original:entry,corrected:{...entry,quantity:20},reason:'Correction'},1,crypto.randomUUID(),'correct-entry'),/Day is closed/);
 // A forged new date must not bypass the original entry's closed date.
 await assert.rejects(apply({original:entry,corrected:{...entry,day:'2026-10-07',quantity:20},reason:'Correction'},1,crypto.randomUUID(),'correct-entry'),/Day is closed/);
 await assert.rejects(pg.query('select public.wa_close($1::uuid,$2::jsonb)',[crypto.randomUUID(),JSON.stringify({day})]),/Day is closed/);
 assert.equal((await apply(entry,0,op,'add-entry')).status,'accepted');assert.equal((await snapshot()).movements.length,movements);
 for(const d of ['2026-10-06','2026-10-07'])assert.equal((await apply({...entry,id:crypto.randomUUID(),day:d,occurredAt:d+'T00:00'},0,crypto.randomUUID(),'add-entry')).status,'accepted');
 await pg.exec('reset role;select wa_private.finalize_all_expired_days();set role authenticated;');assert.equal((await snapshot()).evaluations.filter((e:any)=>e.day===day).length,13);
 await pg.exec('set role anon');await assert.rejects(pg.query('select wa_private.finalize_all_expired_days()'),/permission denied/);
 }finally{await pg.close();}
});
