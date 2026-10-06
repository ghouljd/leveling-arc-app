import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Airofit: saldo previo, 13 misiones, confirmación del plan, correcciones e aislamiento',async()=>{
 const pg=new PGlite();try{
 const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',day='2026-10-05';
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.test_clock() returns timestamptz language sql as $$select '2026-10-05 20:00:00-05'::timestamptz$$;
 insert into auth.users values('${user}'),('${other}');`);
 const load=async(file:string)=>pg.exec((await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));
 for(const f of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','004_shop_sleep.sql','005_sleep_wake_day.sql','006_history_snapshot.sql'])await load(f);
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap();`);
 type Snapshot={entries:unknown[];decisions:unknown[];balances:{xp:number;mc:number};movements:Array<{mission:string;day:string}>;evaluations:Array<{mission:string;result:string}>;airofitEnabled:boolean;missionCount:number};
 const snapshot=async()=>(await pg.query<{r:Snapshot}>('select public.wa_account_snapshot() r')).rows[0].r;
 async function apply(value:Record<string,unknown>,kind='set-decision',base=0,id=crypto.randomUUID()){return(await pg.query<{r:{status:string}}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[id,kind,JSON.stringify(value),base])).rows[0].r;}
 async function close(ids:string[]){const s=await snapshot();return(await pg.query<{r:{status:string;balances:{xp:number;mc:number}}}>('select public.wa_close($1::uuid,$2::jsonb) r',[crypto.randomUUID(),JSON.stringify({day,results:ids.map(mission=>({mission})),entries:s.entries,decisions:s.decisions,objectives:{rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10},ruleVersion:'1.2'})])).rows[0].r;}
 await apply({id:crypto.randomUUID(),day,mission:'pushups',quantity:10,unit:'repetición',note:'',occurredAt:day+'T12:00'},'add-entry');await close(['pushups']);
 assert.deepEqual((await snapshot()).balances,{xp:8,mc:2});
 await pg.exec('reset role');await load('007_airofit.sql');await load('007_airofit.sql');await pg.exec('set role authenticated');
 assert.deepEqual((await snapshot()).balances,{xp:8,mc:2});assert.equal((await snapshot()).airofitEnabled,true);assert.equal((await snapshot()).missionCount,13);
 assert.equal((await snapshot()).evaluations.some(e=>e.mission==='airofit'),false);
 const airofit={id:day+':airofit',day,mission:'airofit',result:'fulfilled',detail:JSON.stringify({planCompleted:true})};
 await assert.rejects(apply({...airofit,detail:'{}'}),/Confirm completion/);
 await assert.rejects(apply({id:crypto.randomUUID(),day,mission:'airofit',quantity:1,unit:'sesión',note:'',occurredAt:day+'T12:00'},'add-entry'),/requires a decision/);
 await apply(airofit);assert.deepEqual((await snapshot()).balances,{xp:8,mc:2});
 for(const [mission,quantity] of Object.entries({abs:10,squats:10,steps:1000,reading:10}))await apply({id:crypto.randomUUID(),day,mission,quantity,unit:'unidad',note:'',occurredAt:day+'T12:00'},'add-entry');
 for(const mission of ['word','control','food','alcohol','focus','coach','sleep'])await apply({id:day+':'+mission,day,mission,result:'fulfilled',detail:JSON.stringify(mission==='sleep'?{bedAt:'2026-10-04T22:30',wakeAt:'2026-10-05T06:30',minutes:420,coverage:'strict',sleepReference:'wake-day'}:{})});
 const ids=['word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit'];
 assert.deepEqual((await close(ids)).balances,{xp:118,mc:27});assert.deepEqual((await close(ids)).balances,{xp:118,mc:27});
 assert.equal((await snapshot()).evaluations.length,13);assert.equal((await snapshot()).movements.filter(m=>m.mission==='airofit'&&m.day===day).length,2);
 await assert.rejects(apply({...airofit,result:'failed',detail:'{}'},'set-decision',1),/requires a reason/);
 const corrected={...airofit,result:'failed',detail:JSON.stringify({planCompleted:false,note:'No completé el plan de hoy'})},op=crypto.randomUUID();
 await apply(corrected,'set-decision',1,op);assert.deepEqual((await snapshot()).balances,{xp:110,mc:15});
 const count=(await snapshot()).movements.length;await apply(corrected,'set-decision',1,op);assert.equal((await snapshot()).movements.length,count);
 await apply({...airofit,result:'exempt',detail:JSON.stringify({note:'Motivo documentado'})},'set-decision',2);assert.deepEqual((await snapshot()).balances,{xp:110,mc:25});
 await apply({...airofit,detail:JSON.stringify({planCompleted:true,note:'Corregí el registro del plan'})},'set-decision',3);assert.deepEqual((await snapshot()).balances,{xp:118,mc:27});
 await pg.exec(`set request.jwt.claim.sub='${other}';select public.wa_bootstrap()`);assert.deepEqual((await snapshot()).balances,{xp:0,mc:0});assert.equal((await snapshot()).evaluations.length,0);
 await pg.exec('set role anon');await assert.rejects(pg.query('select public.wa_account_snapshot()'),/permission denied/);
 }finally{await pg.close();}
});
