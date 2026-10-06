import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('tienda y descanso: saldo, reintentos, cupos, cobertura, flexibilidad y noche final',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function public.test_clock() returns timestamptz language sql as $$ select current_setting('app.test_clock')::timestamptz $$;
 set app.test_clock='2026-10-10 12:00:00-05';
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 for(const name of ['001_initial.sql','002_draft_sync.sql','003_accounting.sql','004_shop_sleep.sql','004_shop_sleep.sql']){
 const source=await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 await pg.exec(source.replaceAll('now()','public.test_clock()'));
 }
 const user='00000000-0000-0000-0000-000000000001';
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='${user}';select public.wa_bootstrap();`);
 async function credit(amount:number){
 const op=crypto.randomUUID();await pg.exec('reset role');
 await pg.query('update wa_private.players set revision=revision+1 where id=$1',[user]);
 await pg.query("insert into wa_private.operations(player_id,id,kind,payload,result,revision) select id,$2,'test-fixture','{}','{}',revision from wa_private.players where id=$1",[user,op]);
 await pg.query("insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference) values($1,$2::uuid,'2026',$3,'mc',$4,'test-fixture',$2::text)",[user,crypto.randomUUID(),op,amount]);
 await pg.exec('set role authenticated');
 }
 async function buy(product:string,at:string,label:string,id=crypto.randomUUID()){
 return (await pg.query<{r:{ticketId:string;status:string}}>('select public.wa_buy_ticket($1::uuid,$2,$3,$4) r',[id,product,at,label])).rows[0].r;
 }
 const snapshot=async()=>(await pg.query<{r:{balances:{xp:number;mc:number};tickets:Array<{id:string;expiresOn:string;state:string}>;flexibility:unknown[]}}>('select public.wa_account_snapshot() r')).rows[0].r;
 async function draft(payload:Record<string,unknown>,base=0,kind='set-decision',id=crypto.randomUUID()){
 return (await pg.query<{r:{status:string;category?:string}}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) r',[id,kind,JSON.stringify(payload),base])).rows[0].r;
 }
 async function close(day:string,mission:string){
 const source=(await pg.query<{r:{entries:unknown[];decisions:unknown[]}}>('select public.wa_draft_snapshot() r')).rows[0].r;
 const payload={day,results:[{mission}],entries:source.entries.filter((e:any)=>e.day===day),decisions:source.decisions.filter((e:any)=>e.day===day),objectives:{rank:'D',pushups:10,abs:10,squats:10,steps:1000,reading:10}};
 return (await pg.query<{r:{status:string}}>('select public.wa_close($1::uuid,$2::jsonb) r',[crypto.randomUUID(),JSON.stringify(payload)])).rows[0].r;
 }
 await credit(249);await assert.rejects(buy('food','2026-10-10T13:00','Almuerzo'),/Insufficient/);
 await credit(1);const purchaseId=crypto.randomUUID();const food=await buy('food','2026-10-10T13:00','Almuerzo',purchaseId);
 assert.equal((await snapshot()).balances.mc,0);
 assert.equal((await buy('food','2026-10-10T13:00','Almuerzo',purchaseId)).ticketId,food.ticketId);
 await credit(1500);await assert.rejects(buy('food','2026-10-10T14:00','Otra comida'),/inventory exhausted/);
 const entry={id:crypto.randomUUID(),day:'2026-10-10',mission:'food',quantity:2,unit:'porción',note:'',occurredAt:'2026-10-10T13:30',ticketId:food.ticketId,mealAt:'2026-10-10T13:00',mealLabel:'Almuerzo'};
 assert.equal((await draft(entry,0,'add-entry')).status,'accepted');
 await close('2026-10-10','food');assert.deepEqual((await snapshot()).balances,{xp:0,mc:1500});
 await assert.rejects(draft({...entry,id:crypto.randomUUID(),mission:'alcohol'},0,'add-entry'),/cannot cover/);
 await draft({id:crypto.randomUUID(),day:'2026-10-10',mission:'food',quantity:1,unit:'porción',note:'',occurredAt:'2026-10-10T18:00',correctionReason:'Otro consumo fuera del plan'},0,'add-entry');
 assert.equal((await snapshot()).balances.mc,1490);
 const night=await buy('sleep','2026-10-10T20:00','Noche del sábado');
 await buy('sleep','2026-10-11T21:00','Noche del domingo');
 await assert.rejects(buy('sleep','2026-10-10T21:00','Otra noche'),/inventory exhausted/);
 const sleep={id:'2026-10-10:sleep',day:'2026-10-10',mission:'sleep',result:'ticket',detail:JSON.stringify({bedAt:'2026-10-10T20:00',wakeAt:'2026-10-11T04:00',minutes:420,coverage:'ticket',ticketId:night.ticketId})};
 await assert.rejects(draft(sleep),/Invalid effective sleep/);
 await pg.exec("set app.test_clock='2026-10-11 12:00:00-05'");
 await draft(sleep);await close('2026-10-10','sleep');const before=(await snapshot()).balances;
 assert.equal(before.xp,0);
 await draft({...sleep,result:'failed',detail:JSON.stringify({bedAt:'2026-10-10T20:00',wakeAt:'2026-10-11T04:00',minutes:390,coverage:'ticket',ticketId:night.ticketId,note:'Duración corregida'})},1);
 assert.equal((await snapshot()).balances.mc,before.mc-15);
 const flex={id:'2026-10-05:sleep',day:'2026-10-05',mission:'sleep',result:'fulfilled',detail:JSON.stringify({bedAt:'2026-10-05T23:30',wakeAt:'2026-10-06T07:30',minutes:420,coverage:'flexible'})};
 await draft(flex);await close('2026-10-05','sleep');
 assert.equal((await snapshot()).balances.xp,15);assert.equal((await snapshot()).balances.mc,before.mc-15+3);
 const clash=await draft({...flex,id:'2026-10-06:sleep',day:'2026-10-06',detail:JSON.stringify({bedAt:'2026-10-06T23:30',wakeAt:'2026-10-07T07:30',minutes:420,coverage:'flexible'})});
 assert.equal(clash.status,'conflict');assert.equal(clash.category,'flexibility');
 await draft({...flex,result:'failed',detail:JSON.stringify({bedAt:'2026-10-05T23:30',wakeAt:'2026-10-06T07:30',minutes:420,coverage:'strict',note:'Retiro de flexibilidad'})},1);
 assert.equal((await snapshot()).flexibility.length,0);
 assert.equal((await draft({...flex,id:'2026-10-06:sleep',day:'2026-10-06',detail:JSON.stringify({bedAt:'2026-10-06T23:30',wakeAt:'2026-10-07T07:30',minutes:420,coverage:'flexible'})})).status,'accepted');
 await pg.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';select public.wa_bootstrap()");
 assert.equal((await snapshot()).tickets.length,0);
 await assert.rejects(draft({...entry,id:crypto.randomUUID()},0,'add-entry'),/does not cover/);
 await assert.rejects(pg.query('select * from wa_private.tickets'),/permission denied/);
 await pg.exec(`set request.jwt.claim.sub='${user}'`);
 await pg.exec("set app.test_clock='2026-10-14 12:00:00-05'");
 await buy('food','2026-10-14T13:00','Nueva semana');
 assert.equal((await snapshot()).tickets.find(t=>t.id===food.ticketId)?.state,'used');
 await pg.exec("set app.test_clock='2026-12-31 12:00:00-05'");await credit(1000);
 const final=await buy('sleep','2026-12-31T23:00','Noche final');
 await pg.exec("set app.test_clock='2027-01-01 08:00:00-05'");
 await draft({id:'2026-12-31:sleep',day:'2026-12-31',mission:'sleep',result:'ticket',detail:JSON.stringify({bedAt:'2026-12-31T23:00',wakeAt:'2027-01-01T07:00',minutes:420,coverage:'ticket',ticketId:final.ticketId})});
 await pg.exec("set app.test_clock='2027-01-01 08:00:00-05'");await close('2026-12-31','sleep');
 assert.equal((await snapshot()).tickets.find(t=>t.id===final.ticketId)?.expiresOn,'2026-12-31');
 assert.equal((await snapshot()).tickets.find(t=>t.id===final.ticketId)?.state,'used');
 }finally{await pg.close();}
});
