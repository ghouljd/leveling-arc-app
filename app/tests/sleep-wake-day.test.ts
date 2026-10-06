import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const user='00000000-0000-0000-0000-000000000001';
async function setup(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function public.test_clock() returns timestamptz language sql as $$ select current_setting('app.test_clock')::timestamptz $$;
 set app.test_clock='2026-10-05 18:00:00-05';insert into auth.users values('${user}');`);
 for(const file of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','004_shop_sleep.sql'])await pg.exec((await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));
 return pg;
}
async function migration(pg:PGlite){await pg.exec((await readFile(new URL('../supabase/migrations/005_sleep_wake_day.sql',import.meta.url),'utf8')).replaceAll('now()','public.test_clock()'));}
test('descanso al despertar: cierre completo hoy, domingo, límites, flexibilidad y tickets de la semana correcta',async()=>{
 const pg=await setup();try{
 await migration(pg);await migration(pg);
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap()`);
 type Snapshot={entries:Array<{day:string}>;decisions:Array<{day:string;mission:string}>;evaluations:Array<{day:string;mission:string}>;balances:{xp:number;mc:number};tickets:Array<{id:string;weekStart:string;wakeDay:string;state:string}>;flexibility:Array<{weekStart:string;night:string}>;sleepReference:string};
 const snapshot=async()=>(await pg.query<{r:Snapshot}>('select public.wa_account_snapshot() r')).rows[0].r;
 async function draft(value:Record<string,unknown>,kind='set-decision',base=0,id=crypto.randomUUID()){
  return (await pg.query<{r:{status:string}}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[id,kind,JSON.stringify(value),base])).rows[0].r;
 }
 const sleep=(day:string,bedAt:string,wakeAt:string,coverage='strict',minutes=420,ticketId?:string)=>({id:day+':sleep',day,mission:'sleep',result:'fulfilled',detail:JSON.stringify({bedAt,wakeAt,minutes,coverage,ticketId,sleepReference:'wake-day'})});
 async function close(day:string,ids:string[]){const source=await snapshot();return(await pg.query<{r:{status:string}}>('select public.wa_close($1::uuid,$2::jsonb) r',[crypto.randomUUID(),JSON.stringify({day,results:ids.map(mission=>({mission})),entries:source.entries.filter(e=>e.day===day),decisions:source.decisions.filter(d=>d.day===day),objectives:{rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10},ruleVersion:'1.1'})])).rows[0].r;}
 async function fullDay(day:string,bed:string,wake:string){
  await draft(sleep(day,bed,wake));
  for(const mission of ['word','control','food','alcohol','focus','coach'])await draft({id:day+':'+mission,day,mission,result:'fulfilled',detail:'{}'});
  for(const [mission,quantity] of [['pushups',10],['abs',10],['squats',10],['steps',1000],['reading',10]] as const)await draft({id:crypto.randomUUID(),day,mission,quantity,unit:'unidad',note:'',occurredAt:day+'T17:00'},'add-entry');
  const ids=['word','control','food','alcohol','focus','coach','pushups','abs','squats','steps','reading','sleep'];
  assert.equal((await close(day,ids)).status,'accepted');
  assert.equal((await snapshot()).evaluations.filter(e=>e.day===day).length,12);
 }
 assert.equal((await snapshot()).sleepReference,'wake-day');
 await fullDay('2026-10-05','2026-10-04T22:30','2026-10-05T06:30');
 assert.deepEqual((await snapshot()).balances,{xp:110,mc:25});
 await assert.rejects(draft(sleep('2026-10-05','2026-10-05T22:30','2026-10-06T06:30'),'set-decision',1),/Invalid effective sleep/);
 await assert.rejects(draft({id:'2026-10-05:sleep',day:'2026-10-05',mission:'sleep',result:'fulfilled',detail:JSON.stringify({bed:'22:30',wake:'06:30',minutes:420})},'set-decision',1),/Reload the app/);
 await pg.exec("set app.test_clock='2026-10-11 18:00:00-05'");
 await fullDay('2026-10-11','2026-10-10T22:30','2026-10-11T06:30');
 assert.deepEqual((await snapshot()).balances,{xp:220,mc:50});
 await draft(sleep('2026-10-10','2026-10-09T23:30','2026-10-10T07:30','flexible'));
 assert.equal((await draft(sleep('2026-10-09','2026-10-08T23:30','2026-10-09T07:30','flexible'))).status,'conflict');
 await pg.exec("set app.test_clock='2026-10-12 18:00:00-05'");
 await draft(sleep('2026-10-12','2026-10-11T23:30','2026-10-12T07:30','flexible'));
 assert.deepEqual((await snapshot()).flexibility.map(f=>f.weekStart).sort(),['2026-10-05','2026-10-12']);
 // Fixture credit remains confined to this embedded database.
 await pg.exec(`reset role;update wa_private.players set revision=revision+1 where id='${user}';
 insert into wa_private.operations(player_id,id,kind,payload,result,revision) select id,'00000000-0000-0000-0000-000000000099','test-fixture','{}','{}',revision from wa_private.players;
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference) values('${user}',gen_random_uuid(),'2026','00000000-0000-0000-0000-000000000099','mc',2000,'test-fixture','test-credit');set role authenticated;`);
 const buy=async(day:string,bed:string,id=crypto.randomUUID())=>(await pg.query<{r:{ticketId:string}}>('select public.wa_buy_ticket($1::uuid,$2,$3,$4,$5) r',[id,'sleep',bed,'Noche',day])).rows[0].r;
 await pg.exec("set app.test_clock='2026-10-11 19:00:00-05'");
 const id=crypto.randomUUID(),ticket=await buy('2026-10-12','2026-10-11T23:30',id);
 assert.equal((await buy('2026-10-12','2026-10-11T23:30',id)).ticketId,ticket.ticketId);
 assert.equal((await snapshot()).tickets.find(t=>t.id===ticket.ticketId)?.weekStart,'2026-10-12');
 await assert.rejects(buy('2026-10-13','2026-10-12T23:30'),/future occasion/);
 await pg.exec("set app.test_clock='2026-10-12 18:00:00-05'");
 await draft({...sleep('2026-10-12','2026-10-11T23:30','2026-10-12T07:30','ticket',420,ticket.ticketId),result:'ticket'},'set-decision',1);
 await close('2026-10-12',['sleep']);
 assert.equal((await snapshot()).tickets.find(t=>t.id===ticket.ticketId)?.state,'used');
 await buy('2026-10-14','2026-10-13T22:00');
 await assert.rejects(buy('2026-10-15','2026-10-14T22:00'),/inventory exhausted/);
 await assert.rejects(draft(sleep('2026-10-13','2026-10-12T23:30','2026-10-13T07:30','ticket',420,ticket.ticketId)),/Invalid recording date/);
 await pg.exec("set app.test_clock='2026-10-13 18:00:00-05'");
 await assert.rejects(draft(sleep('2026-10-13','2026-10-12T23:30','2026-10-13T07:30','ticket',420,ticket.ticketId)),/Invalid or late night ticket/);
 assert.equal((await draft(sleep('2026-10-13','2026-10-13T00:30','2026-10-13T08:30','flexible'))).status,'accepted');
 await pg.exec("set app.test_clock='2026-12-30 18:00:00-05'");
 const final=await buy('2026-12-31','2026-12-30T23:00');
 await assert.rejects(buy('2027-01-01','2026-12-31T23:00'),/future occasion/);
 await pg.exec("set app.test_clock='2026-12-31 18:00:00-05'");
 await draft({...sleep('2026-12-31','2026-12-30T23:00','2026-12-31T07:00','ticket',420,final.ticketId),result:'ticket'});
 await close('2026-12-31',['sleep']);
 assert.equal((await snapshot()).tickets.find(t=>t.id===final.ticketId)?.wakeDay,'2026-12-31');
 assert.equal((await snapshot()).tickets.find(t=>t.id===final.ticketId)?.state,'used');
 const before=await snapshot();await pg.exec('reset role');await migration(pg);await pg.exec('set role authenticated');
 assert.deepEqual((await snapshot()).balances,before.balances);assert.equal((await snapshot()).decisions.length,before.decisions.length);
 await pg.exec('reset role');
 const historySql=(await readFile(new URL('../supabase/migrations/006_history_snapshot.sql',import.meta.url),'utf8')).replaceAll('now()','public.test_clock()');
 await pg.exec(historySql);await pg.exec(historySql);await pg.exec('set role authenticated');
 const history=(await pg.query<{r:Snapshot&{historyEnabled:boolean;movements:Array<{day:string;mission:string;amount:number;resource:string}>;days:Array<{day:string;ruleVersion:string}>}}>('select public.wa_account_snapshot() r')).rows[0].r;
 assert.equal(history.historyEnabled,true);assert.deepEqual(history.balances,before.balances);
 assert.equal(history.movements.filter(m=>m.day==='2026-10-05'&&m.mission==='sleep'&&m.resource==='xp')[0].amount,15);
 assert.equal(history.days.find(d=>d.day==='2026-10-05')?.ruleVersion,'1.1');
 await assert.rejects(pg.query('select wa_private.account_snapshot_sleep()'),/permission denied/);
 await pg.exec('set role anon');await assert.rejects(pg.query('select public.wa_account_snapshot()'),/permission denied/);

 }finally{await pg.close();}
});
test('la transición no reasigna ni borra un descanso registrado con la referencia anterior',async()=>{
 const pg=await setup();try{
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap();
 select public.wa_apply_draft(gen_random_uuid(),'set-decision','{"id":"2026-10-05:sleep","day":"2026-10-05","mission":"sleep","result":"pending","detail":"{}"}',0);reset role;`);
 await assert.rejects(migration(pg),/Existing sleep history/);await pg.exec('rollback');
 assert.equal((await pg.query<{count:number}>("select count(*)::integer count from wa_private.decisions where mission='sleep'")).rows[0].count,1);
 }finally{await pg.close();}
});
