import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('migration bootstraps only authenticated Player, isolates records and denies direct writes',async()=>{
 const pg=new PGlite();
 try{
 await pg.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 const sql=await readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8');
 await pg.exec(sql);await pg.exec(sql);
 await assert.rejects(pg.query('select public.wa_bootstrap()'),/Authentication required/);
 await pg.exec(`set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';`);
 const first=await pg.query<{result:{xp:number;mc:number;player:string}}>('select public.wa_bootstrap() as result');
 assert.equal(first.rows[0].result.xp,0);assert.equal(first.rows[0].result.mc,0);
 await pg.query('select public.wa_bootstrap()');
 await assert.rejects(pg.query('select * from wa_private.players'),/permission denied/);
 await pg.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';`);
 const second=await pg.query<{result:{player:string}}>('select public.wa_bootstrap() as result');
 assert.notEqual(first.rows[0].result.player,second.rows[0].result.player);
 await pg.exec('reset role');
 const count=await pg.query<{count:number}>('select count(*)::int as count from wa_private.players');
 assert.equal(count.rows[0].count,2);
 const rls=await pg.query<{enabled:boolean}>("select bool_and(rowsecurity) as enabled from pg_tables where schemaname='wa_private'");
 assert.equal(rls.rows[0].enabled,true);
 await pg.exec('set role anon');
 await assert.rejects(pg.query('select public.wa_bootstrap()'),/permission denied/);
 }finally{await pg.close();}
});
