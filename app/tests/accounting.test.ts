import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('cierre contable: 110/25, reintentos, reversiones y objetivo histórico',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 insert into auth.users values('00000000-0000-0000-0000-000000000001');`);
 for(const file of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','003_accounting.sql'])await pg.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
 const day='2026-10-05';
 const apply=async(kind:string,payload:unknown,base:number,id=crypto.randomUUID())=>(await pg.query<{r:{status:string}}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[id,kind,JSON.stringify(payload),base])).rows[0].r;
 const entries=[];
 for(const [mission,quantity] of Object.entries({pushups:10,abs:10,squats:10,steps:1000,reading:10})){
 const entry={id:crypto.randomUUID(),day,mission,quantity,unit:'unidad',note:'',occurredAt:day+'T12:00',revision:1};entries.push(entry);await apply('add-entry',entry,0);}
 const decisions=[];
 for(const mission of ['word','control','food','alcohol','focus','coach','sleep']){
 const detail=mission==='sleep'?{bed:'22:30',wake:'06:30',minutes:420}:mission==='coach'?{coach:'Descanso prescrito'}:{};
 const decision={id:day+':'+mission,day,mission,result:'fulfilled',detail:JSON.stringify(detail),revision:1};decisions.push(decision);await apply('set-decision',decision,0);}
 const payload={day,results:[...entries,...decisions].map(e=>({mission:e.mission})),entries,decisions,objectives:{status:'unverified',rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10}};
 const close=async(id:string,p=payload)=>(await pg.query<{r:{status:string;balances:{xp:number;mc:number}}}>('select public.wa_close($1::uuid,$2::jsonb) r',[id,JSON.stringify(p)])).rows[0].r;
 const closeId=crypto.randomUUID();
 assert.deepEqual((await close(closeId)).balances,{xp:110,mc:25});
 assert.deepEqual((await close(closeId)).balances,{xp:110,mc:25});
 assert.deepEqual((await close(crypto.randomUUID())).balances,{xp:110,mc:25});
 const alcohol={id:crypto.randomUUID(),day,mission:'alcohol',quantity:3,unit:'trago',note:'',occurredAt:day+'T18:00',revision:1};
 await assert.rejects(apply('add-entry',alcohol,0),/requires a reason/);
 await apply('add-entry',{...alcohol,correctionReason:'Consumo omitido'},0);
 const snapshot=async()=>(await pg.query<{r:{balances:{xp:number;mc:number};movements:unknown[];days:Array<{objectives:{rank:string}}>}}>('select public.wa_account_snapshot() r')).rows[0].r;
 assert.deepEqual((await snapshot()).balances,{xp:102,mc:-7});
 const corrected={...alcohol,quantity:0,revision:2};const correction=crypto.randomUUID();
 await apply('correct-entry',{original:alcohol,corrected,reason:'Error de prueba'},1,correction);
 const fixed=await snapshot();assert.deepEqual(fixed.balances,{xp:110,mc:25});
 await apply('correct-entry',{original:alcohol,corrected,reason:'Error de prueba'},1,correction);
 assert.equal((await snapshot()).movements.length,fixed.movements.length);
 assert.equal(fixed.days[0].objectives.rank,'D');
 const stale=await close(crypto.randomUUID());assert.equal(stale.status,'conflict');
 await pg.exec('set role anon');await assert.rejects(pg.query('select public.wa_account_snapshot()'),/permission denied/);
 }finally{await pg.close();}
});
