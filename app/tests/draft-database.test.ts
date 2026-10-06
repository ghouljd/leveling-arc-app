import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('draft sync retries are idempotent, stale edits conflict and users remain isolated',async()=>{
 const pg=new PGlite();
 try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 await pg.exec(await readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8'));
 const migration=await readFile(new URL('../supabase/migrations/002_draft_sync.sql',import.meta.url),'utf8');
 await pg.exec(migration);await pg.exec(migration);
 await pg.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';`);
 const entry={id:'10000000-0000-0000-0000-000000000001',day:'2026-10-05',mission:'pushups',quantity:10,unit:'repetición',note:'',occurredAt:'2026-10-05T12:00',revision:1};
 const apply=async(id:string,kind:string,payload:unknown,base:number)=>{
 const result=await pg.query<{result:{status:string;revision:number}}>('select public.wa_apply_draft($1::uuid,$2,$3::jsonb,$4::bigint) as result',[id,kind,JSON.stringify(payload),base]);return result.rows[0].result;
 };
 const op1='20000000-0000-0000-0000-000000000001';
 assert.equal((await apply(op1,'add-entry',entry,0)).status,'accepted');
 assert.equal((await apply(op1,'add-entry',entry,0)).revision,1);
 await assert.rejects(apply(op1,'add-entry',{...entry,quantity:20},0),/identifier reused/);
 assert.equal((await apply('20000000-0000-0000-0000-000000000002','correct-entry',{original:entry,corrected:{...entry,quantity:12},reason:'cantidad corregida'},1)).status,'accepted');
 const stale=await apply('20000000-0000-0000-0000-000000000003','correct-entry',{original:entry,corrected:{...entry,quantity:15},reason:'otra sesión'},1);
 assert.equal(stale.status,'conflict');
 const decision={id:'2026-10-05:coach',day:'2026-10-05',mission:'coach',result:'fulfilled',detail:JSON.stringify({coach:'Descanso prescrito',note:''})};
 assert.equal((await apply('20000000-0000-0000-0000-000000000004','set-decision',decision,0)).status,'accepted');
 const snapshot=await pg.query<{result:{entries:Array<{quantity:number;revision:number}>;decisions:unknown[]}}>('select public.wa_draft_snapshot() as result');
 assert.equal(snapshot.rows[0].result.entries.length,1);
 assert.equal(snapshot.rows[0].result.entries[0].quantity,12);
 assert.equal(snapshot.rows[0].result.entries[0].revision,2);
 assert.equal(snapshot.rows[0].result.decisions.length,1);
 await pg.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';`);
 const other=await pg.query<{result:{entries:unknown[];decisions:unknown[]}}>('select public.wa_draft_snapshot() as result');
 assert.equal(other.rows[0].result.entries.length,0);assert.equal(other.rows[0].result.decisions.length,0);
 await assert.rejects(apply('20000000-0000-0000-0000-000000000005','close-preview',{},0),/Unsupported operation/);
 await pg.exec('reset role');
 assert.equal((await pg.query<{count:number}>('select count(*)::int as count from wa_private.movements')).rows[0].count,0);
 await pg.exec('set role anon');
 await assert.rejects(pg.query('select public.wa_draft_snapshot()'),/permission denied/);
 }finally{await pg.close();}
});
