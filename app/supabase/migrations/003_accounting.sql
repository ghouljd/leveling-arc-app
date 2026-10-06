-- Contabilidad de misiones ordinarias. Tienda y flexibilidad se añaden después.
begin;
create table if not exists wa_private.evaluations (
 player_id uuid not null, season_id text not null, day date not null, mission text not null,
 result text not null, xp integer not null, mc integer not null,
 xp_movement uuid, mc_movement uuid, revision bigint not null default 1,
 primary key(player_id,season_id,day,mission),
 foreign key(player_id,season_id,day) references wa_private.days(player_id,season_id,day)
);
create table if not exists wa_private.ascents (
 player_id uuid not null references wa_private.players(id), operation_id uuid not null,
 level integer not null check(level>=1), effective_on date not null,
 created_at timestamptz not null default now(),
 primary key(player_id,operation_id),
 foreign key(player_id,operation_id) references wa_private.operations(player_id,id)
);
alter table wa_private.evaluations enable row level security;
alter table wa_private.ascents enable row level security;
revoke all on wa_private.evaluations,wa_private.ascents from public,anon,authenticated;

create or replace function wa_private.balances(p_player uuid)
returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('xp',coalesce(sum(amount) filter(where resource='xp'),0),
 'mc',coalesce(sum(amount) filter(where resource='mc'),0))
 from wa_private.movements where player_id=p_player and season_id='2026';
$$;
create or replace function wa_private.level_for(p_xp bigint)
returns integer language plpgsql set search_path='' as $$
declare v_level integer:=1; v_remaining bigint:=p_xp; v_cost bigint;
begin
 if p_xp<0 then raise exception 'Negative XP'; end if;
 loop
  v_cost:=ceil(300*power(1.15::numeric,v_level-1));
  exit when v_remaining<v_cost;
  v_remaining:=v_remaining-v_cost;v_level:=v_level+1;
 end loop;return v_level;
end;$$;
create or replace function wa_private.objectives_for(p_player uuid,p_day date)
returns jsonb language plpgsql set search_path='' as $$
declare v_level integer; v_rank text; v_reps integer; v_steps integer; v_pages integer;
begin
 select a.level into v_level from wa_private.ascents a
 join wa_private.operations o on o.player_id=a.player_id and o.id=a.operation_id
 where a.player_id=p_player and a.effective_on<=p_day order by o.revision desc limit 1;
 v_level:=coalesce(v_level,1);
 if v_level>=13 then v_rank:='S';v_reps:=100;v_steps:=10000;v_pages:=45;
 elsif v_level>=10 then v_rank:='A';v_reps:=75;v_steps:=7500;v_pages:=35;
 elsif v_level>=7 then v_rank:='B';v_reps:=50;v_steps:=5000;v_pages:=25;
 elsif v_level>=4 then v_rank:='C';v_reps:=20;v_steps:=2000;v_pages:=15;
 else v_rank:='D';v_reps:=10;v_steps:=1000;v_pages:=10;end if;
 return jsonb_build_object('status','verified','rank',v_rank,'pushups',v_reps,'abs',v_reps,
 'squats',v_reps,'steps',v_steps,'reading',v_pages);
end;$$;
create or replace function wa_private.evaluate_mission(p_player uuid,p_day date,p_mission text)
returns jsonb language plpgsql set search_path='' as $$
declare v_result text;v_total bigint;v_goal integer;v_objectives jsonb;v_detail jsonb;
 v_xp integer;v_mc integer:=2;v_episodic boolean;
begin
 v_xp:=case p_mission when 'reading' then 10 when 'sleep' then 15 when 'coach' then 13 else 8 end;
 if p_mission='sleep' then v_mc:=3;end if;
 v_episodic:=p_mission in ('word','control','food','alcohol','focus');
 select result,detail into v_result,v_detail from wa_private.decisions
 where player_id=p_player and season_id='2026' and day=p_day and mission=p_mission;
 select coalesce(sum(quantity),0) into v_total from wa_private.entries
 where player_id=p_player and season_id='2026' and day=p_day and mission=p_mission;
 select objectives into v_objectives from wa_private.days where player_id=p_player and season_id='2026' and day=p_day;
 if v_result='exempt' then return jsonb_build_object('result','exempt','xp',0,'mc',0);end if;
 if v_episodic and v_total>0 then
 return jsonb_build_object('result','failed','xp',0,'mc',-5*v_mc*v_total);end if;
 if p_mission in ('pushups','abs','squats','steps','reading') then
   v_goal:=(v_objectives->>p_mission)::integer;
   if v_result is null and v_total>=v_goal then v_result:='fulfilled';end if;
   if v_result='fulfilled' and v_total<v_goal then v_result:='failed';end if;
 end if;
 if p_mission='sleep' and v_result='fulfilled' then
 if coalesce((v_detail->>'minutes')::integer,0)<420 or v_detail->>'bed' is distinct from '22:30'
 or v_detail->>'wake' is distinct from '06:30' then v_result:='failed';end if;end if;
 if v_result='fulfilled' then return jsonb_build_object('result',v_result,'xp',v_xp,'mc',v_mc);end if;
 if v_result='failed' then return jsonb_build_object('result',v_result,'xp',0,'mc',-5*v_mc);end if;
 return jsonb_build_object('result','pending','xp',0,'mc',0);
end;$$;

create or replace function wa_private.account_mission(p_player uuid,p_operation uuid,p_day date,p_mission text)
returns void language plpgsql set search_path='' as $$
declare v_new jsonb;v_old wa_private.evaluations%rowtype;v_xp integer;v_mc integer;
 v_xp_id uuid;v_mc_id uuid;v_revision bigint;
begin
 v_new:=wa_private.evaluate_mission(p_player,p_day,p_mission);
 select * into v_old from wa_private.evaluations where player_id=p_player and season_id='2026' and day=p_day and mission=p_mission;
 v_revision:=coalesce(v_old.revision,0)+1;v_xp:=(v_new->>'xp')::integer;v_mc:=(v_new->>'mc')::integer;
 if v_old.result=v_new->>'result' and v_old.xp=v_xp and v_old.mc=v_mc then return;end if;
 if v_old.xp_movement is not null then
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference,reverses_id)
 values(p_player,gen_random_uuid(),'2026',p_operation,'xp',-v_old.xp,'reversal',p_operation::text||':'||p_mission||':reverse-xp',v_old.xp_movement);end if;
 if v_old.mc_movement is not null then
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference,reverses_id)
 values(p_player,gen_random_uuid(),'2026',p_operation,'mc',-v_old.mc,'reversal',p_operation::text||':'||p_mission||':reverse-mc',v_old.mc_movement);end if;
 if v_xp<>0 then
 v_xp_id:=gen_random_uuid();
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference)
 values(p_player,v_xp_id,'2026',p_operation,'xp',v_xp,'mission',p_operation::text||':'||p_mission||':xp');end if;
 if v_mc<>0 then
 v_mc_id:=gen_random_uuid();
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference)
 values(p_player,v_mc_id,'2026',p_operation,'mc',v_mc,'mission',p_operation::text||':'||p_mission||':mc');end if;
 insert into wa_private.evaluations(player_id,season_id,day,mission,result,xp,mc,xp_movement,mc_movement,revision)
 values(p_player,'2026',p_day,p_mission,v_new->>'result',v_xp,v_mc,v_xp_id,v_mc_id,v_revision)
 on conflict(player_id,season_id,day,mission) do update set result=excluded.result,xp=excluded.xp,mc=excluded.mc,
 xp_movement=excluded.xp_movement,mc_movement=excluded.mc_movement,revision=excluded.revision;
end;$$;
create or replace function wa_private.record_level(p_player uuid,p_operation uuid,p_before bigint)
returns void language plpgsql set search_path='' as $$
declare v_level integer;
begin
 v_level:=wa_private.level_for((wa_private.balances(p_player)->>'xp')::bigint);
 if v_level<>wa_private.level_for(p_before) then
 insert into wa_private.ascents(player_id,operation_id,level,effective_on)
 values(p_player,p_operation,v_level,(now() at time zone 'America/Bogota')::date+1)
 on conflict(player_id,operation_id) do nothing;end if;
end;$$;

-- Preserve the validated draft writer internally; only the accounting wrapper is exposed.
do $$ begin
 if to_regprocedure('wa_private.wa_apply_draft(uuid,text,jsonb,bigint)') is null then
 alter function public.wa_apply_draft(uuid,text,jsonb,bigint) set schema wa_private;
 end if;
end $$;
revoke all on function wa_private.wa_apply_draft(uuid,text,jsonb,bigint) from public,anon,authenticated;

create or replace function public.wa_apply_draft(p_operation uuid,p_kind text,p_payload jsonb,p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_response jsonb;v_before bigint;v_day date;v_mission text;v_entity jsonb;v_old_result jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 perform public.wa_bootstrap();perform 1 from wa_private.players where id=v_player for update;
 select result into v_old_result from wa_private.operations where player_id=v_player and id=p_operation;
 v_before:=(wa_private.balances(v_player)->>'xp')::bigint;
 v_response:=wa_private.wa_apply_draft(p_operation,p_kind,p_payload,p_base_revision);
 if v_old_result is not null or v_response->>'status'<>'accepted' then return v_response;end if;
 v_entity:=case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end;
 v_day:=(v_entity->>'day')::date;v_mission:=v_entity->>'mission';
 if exists(select 1 from wa_private.evaluations where player_id=v_player and season_id='2026' and day=v_day and mission=v_mission) then
  if nullif(btrim(coalesce(p_payload->>'reason',p_payload->>'correctionReason',
   case when jsonb_typeof(v_entity->'detail')='string' then (v_entity->>'detail')::jsonb->>'note' else v_entity->'detail'->>'note' end)), '') is null
  then raise exception 'A closed mission correction requires a reason';end if;
  perform wa_private.account_mission(v_player,p_operation,v_day,v_mission);
  perform wa_private.record_level(v_player,p_operation,v_before);
 end if;
 return v_response;
end;$$;

create or replace function public.wa_close(p_operation uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_day date;v_mission text;v_expected jsonb;v_actual jsonb;
 v_objectives jsonb;v_saved wa_private.operations%rowtype;v_revision bigint;v_before bigint;v_response jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid close';end if;
 perform public.wa_bootstrap();select revision into v_revision from wa_private.players where id=v_player for update;
 select * into v_saved from wa_private.operations where player_id=v_player and id=p_operation;
 if found then
  if v_saved.kind<>'close' or v_saved.payload<>p_payload then raise exception 'Operation identifier reused';end if;return v_saved.result;
 end if;
 v_day:=(p_payload->>'day')::date;
 if v_day is null or v_day not between date '2026-10-05' and date '2026-12-31'
 or v_day>(now() at time zone 'America/Bogota')::date then raise exception 'Invalid close date';end if;
 if jsonb_typeof(p_payload->'results') is distinct from 'array' or jsonb_array_length(p_payload->'results') not between 1 and 12 then raise exception 'Choose missions to close';end if;
 if jsonb_typeof(p_payload->'entries') is distinct from 'array' or jsonb_typeof(p_payload->'decisions') is distinct from 'array' then raise exception 'Missing record snapshot';end if;
 select objectives into v_objectives from wa_private.days where player_id=v_player and season_id='2026' and day=v_day;
 if v_objectives is null or v_objectives->>'status'<>'verified' then
  v_objectives:=wa_private.objectives_for(v_player,v_day);
 end if;
 if ((p_payload->'objectives') - 'status') is distinct from (v_objectives - 'status') then
  v_response:=jsonb_build_object('status','conflict','category','close','message','Los objetivos efectivos difieren; sincroniza y revisa el cierre.');
 end if;
 for v_mission in select distinct value->>'mission' from jsonb_array_elements(p_payload->'results') loop
  if v_mission is null or v_mission not in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach') then raise exception 'Invalid mission';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision) order by e.id),'[]') into v_actual
  from wa_private.entries e where e.player_id=v_player and e.season_id='2026' and e.day=v_day and e.mission=v_mission;
  select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','revision',(value->>'revision')::bigint) order by value->>'id'),'[]') into v_expected
  from jsonb_array_elements(p_payload->'entries') where value->>'mission'=v_mission;
  if v_actual<>v_expected then v_response:=jsonb_build_object('status','conflict','category','close','message','Cambió un aporte: descarga los registros y revisa el cierre.');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.day::text||':'||d.mission,'revision',d.revision)),'[]') into v_actual
  from wa_private.decisions d where d.player_id=v_player and d.season_id='2026' and d.day=v_day and d.mission=v_mission;
  select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','revision',(value->>'revision')::bigint)),'[]') into v_expected
  from jsonb_array_elements(p_payload->'decisions') where value->>'mission'=v_mission;
  if v_actual<>v_expected then v_response:=jsonb_build_object('status','conflict','category','close','message','Cambió una decisión: descarga los registros y revisa el cierre.');end if;
 end loop;
 update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
 insert into wa_private.operations(player_id,id,kind,payload,result,revision)
 values(v_player,p_operation,'close',p_payload,coalesce(v_response,'{}'),v_revision);
 if v_response is not null then return v_response;end if;
 insert into wa_private.days(player_id,season_id,day,rule_version,objectives)
 values(v_player,'2026',v_day,'1.0',v_objectives)
 on conflict(player_id,season_id,day) do update set objectives=excluded.objectives;
 v_before:=(wa_private.balances(v_player)->>'xp')::bigint;
 for v_mission in select distinct value->>'mission' from jsonb_array_elements(p_payload->'results') loop
  perform wa_private.account_mission(v_player,p_operation,v_day,v_mission);
 end loop;
 perform wa_private.record_level(v_player,p_operation,v_before);
 v_response:=jsonb_build_object('status','accepted','balances',wa_private.balances(v_player));
 update wa_private.operations set result=v_response where player_id=v_player and id=p_operation;
 return v_response;
end;$$;

create or replace function public.wa_account_snapshot()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_drafts jsonb;v_days jsonb;v_results jsonb;v_movements jsonb;v_balances jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 v_drafts:=public.wa_draft_snapshot();
 select coalesce(jsonb_agg(jsonb_build_object('id',day::text,'day',day,'objectives',case when objectives->>'status'='verified' then objectives else wa_private.objectives_for(v_player,day) end)),'[]')
 into v_days from wa_private.days where player_id=v_player and season_id='2026';
 select coalesce(jsonb_agg(jsonb_build_object('id',day::text||':'||mission,'day',day,'mission',mission,'result',result,'xp',xp,'mc',mc)),'[]')
 into v_results from wa_private.evaluations where player_id=v_player and season_id='2026';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'resource',resource,'amount',amount,'cause',cause,'reference',reference,'accreditedAt',accredited_at,'reversesId',reverses_id) order by accredited_at,id),'[]')
 into v_movements from wa_private.movements where player_id=v_player and season_id='2026';
 v_balances:=wa_private.balances(v_player);
 return v_drafts||jsonb_build_object('days',v_days,'evaluations',v_results,'movements',v_movements,'balances',v_balances,'level',wa_private.level_for((v_balances->>'xp')::bigint));
end;$$;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';commit;
select 'accounting_ready' as status;
