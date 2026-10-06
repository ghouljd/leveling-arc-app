import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('sleep attestations preserve accounting, weekly limits and legacy records without invented times',async()=>{
 const pg=new PGlite();try{
 const user='00000000-0000-0000-0000-000000000001';
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.test_clock() returns timestamptz language sql as $$select '2026-10-07 20:00:00-05'::timestamptz$$;insert into auth.users values('${user}');`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')&&f<'013').sort())await pg.exec((await readFile(new URL(file,dir),'utf8')).replaceAll('now()','public.test_clock()'));
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap();`);
 const snapshot=async()=>(await pg.query<{r:any}>('select public.wa_account_snapshot() r')).rows[0].r;
 const value=(day:string,result:string,coverage='strict',extra={})=>({id:day+':sleep',day,mission:'sleep',result,detail:JSON.stringify({selfReported:true,sleepReference:'wake-day',coverage,...(result==='fulfilled'||result==='ticket'?{minimumSleepMet:true}:{}),...(coverage==='strict'&&result==='fulfilled'?{scheduleMet:true}:{}),...extra})});
 const apply=async(v:any,base=0,op=crypto.randomUUID(),kind='set-decision')=>(await pg.query<{r:any}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[op,kind,JSON.stringify(v),base])).rows[0].r;
 const close=async(day:string)=>{const s=await snapshot();return(await pg.query<{r:any}>('select public.wa_close($1::uuid,$2::jsonb) r',[crypto.randomUUID(),JSON.stringify({day,results:[{mission:'sleep'}],entries:s.entries.filter((e:any)=>e.day===day),decisions:s.decisions.filter((e:any)=>e.day===day),objectives:{rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10},ruleVersion:'1.2'})])).rows[0].r;};
 assert.equal((await snapshot()).simpleSleepEnabled,true);
 await assert.rejects(apply(value('2026-10-05','fulfilled','strict',{minimumSleepMet:false})),/seven hours/);
 await assert.rejects(apply(value('2026-10-05','fulfilled','strict',{scheduleMet:false})),/strict sleep schedule/);
 await assert.rejects(apply(value('2026-10-05','fulfilled','strict',{minutes:420})),/must not include measured/);
 await assert.rejects(apply(value('2026-10-08','fulfilled')),/recording date/);
 const strict=value('2026-10-05','fulfilled'),op=crypto.randomUUID();await apply(strict,0,op);await apply(strict,0,op);
 assert.deepEqual((await snapshot()).balances,{xp:15,mc:3});await close('2026-10-05');assert.deepEqual((await snapshot()).balances,{xp:15,mc:3});
 const detail=JSON.parse((await snapshot()).decisions.find((d:any)=>d.day==='2026-10-05').detail);assert.equal(detail.selfReported,true);assert.equal('bedAt' in detail,false);assert.equal('minutes' in detail,false);
 await apply(value('2026-10-05','failed','strict',{note:'Player changed the recorded result.'}),1);assert.deepEqual((await snapshot()).balances,{xp:0,mc:-15});
 await apply(value('2026-10-06','fulfilled','flexible'));await close('2026-10-06');assert.deepEqual((await snapshot()).balances,{xp:15,mc:-12});
 assert.equal((await apply(value('2026-10-07','fulfilled','flexible'))).status,'conflict');
 await assert.rejects(apply(value('2026-10-07','ticket','ticket',{ticketId:crypto.randomUUID()})),/Invalid or late night ticket/);
 await apply({id:'2026-10-07:sleep',day:'2026-10-07',mission:'sleep',result:'fulfilled',detail:JSON.stringify({sleepReference:'wake-day',coverage:'strict',bedAt:'2026-10-06T22:30',wakeAt:'2026-10-07T06:30',minutes:420})});await close('2026-10-07');assert.deepEqual((await snapshot()).balances,{xp:30,mc:-9});
 assert.equal((await snapshot()).automaticAccountingEnabled,true);
 const entry=(quantity:number)=>({id:crypto.randomUUID(),day:'2026-10-07',mission:'pushups',quantity,unit:'rep',note:'',occurredAt:'2026-10-07T12:00',correctionReason:'Player added progress.'});
 await apply(entry(5),0,crypto.randomUUID(),'add-entry');assert.deepEqual((await snapshot()).balances,{xp:30,mc:-9});
 const completed=entry(5),completedOp=crypto.randomUUID();await apply(completed,0,completedOp,'add-entry');assert.deepEqual((await snapshot()).balances,{xp:38,mc:-7});
 const movementCount=(await snapshot()).movements.length;await apply(completed,0,completedOp,'add-entry');assert.equal((await snapshot()).movements.length,movementCount);
 await apply({...entry(2),mission:'alcohol',unit:'drink'},0,crypto.randomUUID(),'add-entry');assert.deepEqual((await snapshot()).balances,{xp:38,mc:-27});
 await apply({...entry(1),mission:'alcohol',unit:'drink'},0,crypto.randomUUID(),'add-entry');assert.deepEqual((await snapshot()).balances,{xp:38,mc:-37});
 const confirmed=(await snapshot()).days.find((d:any)=>d.day==='2026-10-07');assert.equal(confirmed.objectives.status,'verified');
 await pg.exec('set role anon');await assert.rejects(pg.query('select public.wa_account_snapshot()'),/permission denied/);
 }finally{await pg.close();}
});
