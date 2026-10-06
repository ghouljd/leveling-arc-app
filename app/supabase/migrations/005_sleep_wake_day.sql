-- Descanso del día D: noche que termina al despertar en D (reglas 1.1).
-- Aplicar después de 004. No cambia XP/MC ni registros de otras misiones.
begin;
-- Esta transición se aplica antes del primer registro de descanso/ticket de noche.
-- Si existen datos con la referencia anterior, detener sin borrar ni reasignar historial.
do $$begin
 if not exists(select 1 from information_schema.columns where table_schema='wa_private' and table_name='tickets' and column_name='wake_day') then
  if exists(select 1 from wa_private.decisions where mission='sleep')
   or exists(select 1 from wa_private.evaluations where mission='sleep')
   or exists(select 1 from wa_private.tickets where product='sleep')
   or exists(select 1 from wa_private.flexibility) then
   raise exception 'Existing sleep history needs an explicit reference migration; no data was changed';
  end if;
 end if;
end$$;
alter table wa_private.tickets add column if not exists wake_day date;
update wa_private.tickets set wake_day=(assigned_at at time zone 'America/Bogota')::date where wake_day is null;
alter table wa_private.tickets alter column wake_day set not null;
drop function if exists public.wa_buy_ticket(uuid,text,text,text);
create or replace function public.wa_buy_ticket(p_operation uuid,p_product text,p_assigned_at text,p_label text,p_sleep_day text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_week date;v_day date;v_at timestamptz;v_payload jsonb;
 v_saved wa_private.operations%rowtype;v_ticket uuid;v_revision bigint;v_response jsonb;v_count integer;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_operation is null or p_product is null or p_product not in ('food','sleep') or nullif(btrim(p_label),'') is null
 or length(p_label)>100 or p_assigned_at is null then raise exception 'Invalid ticket request';end if;
 v_payload:=jsonb_build_object('product',p_product,'assignedAt',p_assigned_at,'label',p_label)||case when p_product='sleep' then jsonb_build_object('sleepDay',p_sleep_day) else '{}'::jsonb end;
 perform public.wa_bootstrap();select revision into v_revision from wa_private.players where id=v_player for update;
 select * into v_saved from wa_private.operations where player_id=v_player and id=p_operation;
 if found then if v_saved.kind<>'purchase' or v_saved.payload<>v_payload then raise exception 'Operation identifier reused';end if;return v_saved.result;end if;
 v_at:=p_assigned_at::timestamp at time zone 'America/Bogota';v_day:=(v_at at time zone 'America/Bogota')::date;
 if p_product='sleep' then
  if p_sleep_day is null then raise exception 'Choose the wake day';end if;
  v_day:=p_sleep_day::date;
  if (v_at at time zone 'America/Bogota')::date not between v_day-1 and v_day then raise exception 'Bedtime must precede the chosen wake day';end if;
 end if;
 v_week:=date_trunc('week',v_day::timestamp)::date;
 if v_at<=now() or v_day not between date '2026-10-05' and date '2026-12-31'
 or (v_week<>date_trunc('week',now() at time zone 'America/Bogota')::date and not
 (p_product='sleep' and v_day=(now() at time zone 'America/Bogota')::date+1 and extract(isodow from v_day)=1)) then raise exception 'Choose a future occasion in current season week';end if;
 if (wa_private.balances(v_player)->>'mc')::bigint<250 then raise exception 'Insufficient confirmed MC';end if;
 select count(*) into v_count from wa_private.tickets where player_id=v_player and product=p_product and week_start=v_week;
 if v_count>=(case when p_product='food' then 1 else 2 end) then raise exception 'Weekly inventory exhausted';end if;
 if p_product='sleep' and exists(select 1 from wa_private.tickets where player_id=v_player and product='sleep' and wake_day=v_day)
 then raise exception 'A ticket is already assigned to that night';end if;
 v_ticket:=gen_random_uuid();v_revision:=v_revision+1;
 update wa_private.players set revision=v_revision where id=v_player;
 v_response:=jsonb_build_object('status','accepted','ticketId',v_ticket);
 insert into wa_private.operations(player_id,id,kind,payload,result,revision)values(v_player,p_operation,'purchase',v_payload,v_response,v_revision);
 insert into wa_private.tickets(player_id,id,product,week_start,assigned_at,label,operation_id,wake_day)
 values(v_player,v_ticket,p_product,v_week,v_at,p_label,p_operation,v_day);
 insert into wa_private.movements(player_id,id,season_id,operation_id,resource,amount,cause,reference)
 values(v_player,gen_random_uuid(),'2026',p_operation,'mc',-250,'purchase',p_operation::text||':purchase');
 return v_response;
end;$$;

create or replace function public.wa_apply_draft(p_operation uuid,p_kind text,p_payload jsonb,p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_response jsonb;v_before bigint;v_day date;v_mission text;v_entity jsonb;v_detail jsonb;
 v_saved wa_private.operations%rowtype;v_sanitized jsonb:=p_payload;v_ticket wa_private.tickets%rowtype;
 v_ticket_id uuid;v_bed timestamp;v_wake timestamp;v_minutes integer;v_coverage text;v_result text;v_week date;
 v_other_night date;v_revision bigint;v_current jsonb;v_normalized text;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_operation is null or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid operation';end if;
 perform public.wa_bootstrap();select revision into v_revision from wa_private.players where id=v_player for update;
 select * into v_saved from wa_private.operations where player_id=v_player and id=p_operation;
 if found then
  if v_saved.kind<>p_kind or v_saved.payload<>jsonb_build_object('body',p_payload,'baseRevision',p_base_revision) then raise exception 'Operation identifier reused';end if;
  return v_saved.result;
 end if;
 v_before:=(wa_private.balances(v_player)->>'xp')::bigint;
 v_entity:=case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end;
 v_day:=(v_entity->>'day')::date;v_mission:=v_entity->>'mission';v_week:=date_trunc('week',v_day::timestamp)::date;
 if v_day is null or v_day not between date '2026-10-05' and least(date '2026-12-31',(now() at time zone 'America/Bogota')::date) then raise exception 'Invalid recording date';end if;
 if p_kind='set-decision' and v_mission='sleep' then
  v_detail:=case when jsonb_typeof(v_entity->'detail')='string' then (v_entity->>'detail')::jsonb else v_entity->'detail' end;
  v_result:=v_entity->>'result';
  if v_result is null or v_result not in ('pending','exempt','fulfilled','failed','ticket') then raise exception 'Invalid sleep result';end if;
  if v_result not in ('pending','exempt') then
   if v_detail->>'sleepReference' is distinct from 'wake-day' then raise exception 'Reload the app: sleep now belongs to the wake day';end if;
   v_coverage:=coalesce(v_detail->>'coverage','strict');
   if v_coverage not in ('strict','flexible','ticket') then raise exception 'Invalid sleep coverage';end if;
   v_bed:=coalesce(v_detail->>'bedAt',(v_day-1)::text||'T'||(v_detail->>'bed'))::timestamp;
   v_wake:=coalesce(v_detail->>'wakeAt',v_day::text||'T'||(v_detail->>'wake'))::timestamp;
   v_minutes:=(v_detail->>'minutes')::integer;
   if v_bed is null or v_wake is null or v_minutes is null or v_minutes<0 or v_bed::date not between v_day-1 and v_day
   or v_wake<=v_bed or v_wake::date<>v_day or (v_wake at time zone 'America/Bogota')>now() or v_minutes>extract(epoch from (v_wake-v_bed))/60
   or (v_detail->>'minutes')::numeric<>v_minutes then raise exception 'Invalid effective sleep duration or dates';end if;
   v_detail:=v_detail||jsonb_build_object('bed',to_char(v_bed,'HH24:MI'),'wake',to_char(v_wake,'HH24:MI'),'bedAt',to_char(v_bed,'YYYY-MM-DD"T"HH24:MI'),'wakeAt',to_char(v_wake,'YYYY-MM-DD"T"HH24:MI'),'coverage',v_coverage,'night',v_day,'sleepReference','wake-day');
   if v_coverage='ticket' then
    v_ticket_id:=(v_detail->>'ticketId')::uuid;
    select * into v_ticket from wa_private.tickets where player_id=v_player and id=v_ticket_id and product='sleep';
    if not found or v_ticket.wake_day<>v_day or v_ticket.week_start<>v_week
    or v_ticket.purchased_at>=(v_bed at time zone 'America/Bogota') then raise exception 'Invalid or late night ticket';end if;
   end if;
   if v_coverage='flexible' then
    select night into v_other_night from wa_private.flexibility where player_id=v_player and week_start=v_week;
    if v_other_night is not null and v_other_night<>v_day then
     select jsonb_build_object('id',day::text||':sleep','day',day,'mission','sleep','result',result,'detail',detail::text,'revision',revision)
     into v_current from wa_private.decisions where player_id=v_player and season_id='2026' and day=v_day and mission='sleep';
     v_response:=jsonb_build_object('status','conflict','category','flexibility','current',v_current,'message','La noche flexible de esta semana ya está asignada a otra noche.');
    end if;
   end if;
   v_normalized:=case when v_minutes<420 then 'failed' when v_coverage='ticket' then 'ticket' when v_coverage='flexible' then 'fulfilled'
    when v_bed::date=v_day-1 and v_bed::time=time '22:30' and v_wake::time=time '06:30' then 'fulfilled' else 'failed' end;
   -- Core validates identities/revisions; masked result avoids its strict-only legacy check.
   v_sanitized:=jsonb_set(jsonb_set(p_payload,'{result}','"failed"'),'{detail}',to_jsonb(v_detail::text));
  end if;
 end if;
 if p_kind in ('add-entry','correct-entry') and nullif(v_entity->>'ticketId','') is not null then
  if v_mission<>'food' then raise exception 'Food ticket cannot cover this mission';end if;
  v_ticket_id:=(v_entity->>'ticketId')::uuid;
  select * into v_ticket from wa_private.tickets where player_id=v_player and id=v_ticket_id and product='food';
  if not found or v_ticket.week_start<>v_week or (v_ticket.assigned_at at time zone 'America/Bogota')::date<>v_day
  or v_ticket.assigned_at is distinct from ((v_entity->>'mealAt')::timestamp at time zone 'America/Bogota')
  or v_ticket.label is distinct from v_entity->>'mealLabel'
  or v_ticket.purchased_at>=v_ticket.assigned_at
  or v_ticket.purchased_at>=((v_entity->>'occurredAt')::timestamp at time zone 'America/Bogota')
  then raise exception 'Ticket does not cover this meal';end if;
 end if;
 if v_response is not null then
  update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
  insert into wa_private.operations(player_id,id,kind,payload,result,revision)
  values(v_player,p_operation,p_kind,jsonb_build_object('body',p_payload,'baseRevision',p_base_revision),v_response,v_revision);
  return v_response;
 end if;
 v_response:=wa_private.wa_apply_draft(p_operation,p_kind,v_sanitized,p_base_revision);
 update wa_private.operations set payload=jsonb_build_object('body',p_payload,'baseRevision',p_base_revision)
 where player_id=v_player and id=p_operation;
 if v_response->>'status'<>'accepted' then return v_response;end if;
 if p_kind='set-decision' and v_mission='sleep' then
  delete from wa_private.flexibility where player_id=v_player and night=v_day;
  if v_coverage='flexible' then insert into wa_private.flexibility(player_id,week_start,night) values(v_player,v_week,v_day);end if;
  if v_normalized is not null then update wa_private.decisions set result=v_normalized,detail=v_detail
   where player_id=v_player and season_id='2026' and day=v_day and mission='sleep';end if;
 end if;
 if p_kind in ('add-entry','correct-entry') then
  delete from wa_private.entry_coverage where player_id=v_player and entry_id=(v_entity->>'id')::uuid;
  if v_ticket_id is not null then insert into wa_private.entry_coverage(player_id,entry_id,ticket_id) values(v_player,(v_entity->>'id')::uuid,v_ticket_id);end if;
 end if;
 if exists(select 1 from wa_private.evaluations where player_id=v_player and season_id='2026' and day=v_day and mission=v_mission) then
  if nullif(btrim(coalesce(p_payload->>'reason',p_payload->>'correctionReason',v_detail->>'note',
    case when jsonb_typeof(v_entity->'detail')='string' then (v_entity->>'detail')::jsonb->>'note' else v_entity->'detail'->>'note' end)), '') is null
  then raise exception 'A closed mission correction requires a reason';end if;
  perform wa_private.account_mission(v_player,p_operation,v_day,v_mission);
  perform wa_private.record_level(v_player,p_operation,v_before);
 end if;
 update wa_private.days set rule_version='1.1' where player_id=v_player and season_id='2026' and day=v_day;
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
 values(v_player,'2026',v_day,'1.1',v_objectives)
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
declare v_player uuid:=auth.uid();v_base jsonb;v_tickets jsonb;v_flex jsonb;v_entries jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 v_base:=wa_private.account_snapshot_base();
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'product',t.product,'weekStart',t.week_start,
 'wakeDay',t.wake_day,'assignedAt',to_char(t.assigned_at at time zone 'America/Bogota','YYYY-MM-DD"T"HH24:MI'),'label',t.label,'purchasedAt',t.purchased_at,
 'expiresOn',least(t.week_start+6,date '2026-12-31'),
 'state',case when exists(select 1 from wa_private.entry_coverage c join wa_private.entries e on e.player_id=c.player_id and e.id=c.entry_id where c.player_id=t.player_id and c.ticket_id=t.id and e.quantity>0)
 or exists(select 1 from wa_private.decisions d where d.player_id=t.player_id and d.mission='sleep' and d.detail->>'ticketId'=t.id::text and d.result not in ('pending','exempt')) then 'used'
 when (now() at time zone 'America/Bogota')::date>least(t.week_start+6,date '2026-12-31') then 'expired' else 'assigned' end) order by t.purchased_at),'[]')
 into v_tickets from wa_private.tickets t where t.player_id=v_player;
 select coalesce(jsonb_agg(jsonb_build_object('weekStart',week_start,'night',night)),'[]') into v_flex from wa_private.flexibility where player_id=v_player;
 select coalesce(jsonb_agg(value||case when c.ticket_id is not null then jsonb_build_object('ticketId',t.id,
 'mealAt',to_char(t.assigned_at at time zone 'America/Bogota','YYYY-MM-DD"T"HH24:MI'),'mealLabel',t.label) else '{}'::jsonb end),'[]')
 into v_entries from jsonb_array_elements(v_base->'entries') left join wa_private.entry_coverage c on c.player_id=v_player and c.entry_id=(value->>'id')::uuid
 left join wa_private.tickets t on t.player_id=c.player_id and t.id=c.ticket_id;
 return v_base||jsonb_build_object('tickets',v_tickets,'flexibility',v_flex,'entries',v_entries,'shopEnabled',true,'sleepReference','wake-day');
end;$$;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_buy_ticket(uuid,text,text,text,text),public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_buy_ticket(uuid,text,text,text,text),public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';commit;
select 'wake_day_sleep_ready' as status;
