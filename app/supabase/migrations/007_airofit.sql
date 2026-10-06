-- Reglas 1.2: Airofit diario desde el 5 de octubre de 2026.
-- Seguir el entrenamiento planificado por su app. 8 XP / 2 MC / -10 MC.
-- No crea cumplimientos ni modifica acreditaciones existentes.
begin;
alter table wa_private.decisions drop constraint if exists decisions_mission_check;
alter table wa_private.decisions add constraint decisions_mission_check check(mission in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit'));
create or replace function wa_private.wa_apply_draft(
 p_operation uuid, p_kind text, p_payload jsonb, p_base_revision bigint
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_player uuid:=auth.uid(); v_day date; v_mission text; v_id uuid;
 v_quantity integer; v_entity jsonb; v_existing jsonb; v_response jsonb;
 v_current_revision bigint:=0; v_revision bigint; v_detail jsonb; v_result text;
 v_saved wa_private.operations%rowtype;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_operation is null or p_payload is null or p_kind is null or p_base_revision is null
 or p_base_revision<0 then raise exception 'Invalid operation'; end if;
 if p_kind not in ('add-entry','correct-entry','set-decision') then raise exception 'Unsupported operation'; end if;
 perform public.wa_bootstrap();
 select revision into v_revision from wa_private.players where id=v_player for update;
 select * into v_saved from wa_private.operations where player_id=v_player and id=p_operation;
 if found then
   if v_saved.kind<>p_kind or v_saved.payload<>jsonb_build_object('body',p_payload,'baseRevision',p_base_revision)
   then raise exception 'Operation identifier reused with different content'; end if;
   return v_saved.result;
 end if;
 v_entity:=case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end;
 if jsonb_typeof(v_entity) is distinct from 'object' then raise exception 'Invalid record'; end if;
 v_day:=(v_entity->>'day')::date; v_mission:=v_entity->>'mission';
 if v_day is null or v_day not between date '2026-10-05' and date '2026-12-31'
 or v_day>(now() at time zone 'America/Bogota')::date then raise exception 'Invalid season day'; end if;
 if v_mission is null or v_mission not in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit')
 then raise exception 'Invalid mission'; end if;
 if p_kind in ('add-entry','correct-entry') then
   v_id:=(v_entity->>'id')::uuid; v_quantity:=(v_entity->>'quantity')::integer;
   if v_id is null or v_quantity is null or v_quantity<0 or (p_kind='add-entry' and v_quantity=0)
   or jsonb_typeof(v_entity->'quantity') is distinct from 'number'
   or (v_entity->>'quantity')::numeric<>v_quantity then raise exception 'Invalid quantity'; end if;
   if v_mission in ('sleep','coach','airofit') then raise exception 'Mission requires a decision'; end if;
   if nullif(btrim(v_entity->>'unit'),'') is null or length(v_entity->>'unit')>100
   or length(coalesce(v_entity->>'note',''))>2000 then raise exception 'Invalid unit or note'; end if;
   if (v_entity->>'occurredAt') is null or (v_entity->>'occurredAt')::timestamp::date<>v_day
   then raise exception 'Event must belong to selected day'; end if;
   select e.revision,jsonb_build_object('id',e.id,'day',e.day,'mission',e.mission,'quantity',e.quantity,
    'unit',e.unit,'note',e.note,'occurredAt',to_char(e.occurred_at at time zone 'America/Bogota','YYYY-MM-DD"T"HH24:MI'),
    'revision',e.revision) into v_current_revision,v_existing
   from wa_private.entries e where e.player_id=v_player and e.id=v_id;
   v_current_revision:=coalesce(v_current_revision,0);
   if p_kind='add-entry' and p_base_revision<>0 then raise exception 'New entry must have base zero'; end if;
   if p_kind='correct-entry' then
     if nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>2000 then raise exception 'Correction requires a reason'; end if;
     if v_existing is not null and ((v_existing->>'day')::date<>v_day or v_existing->>'mission'<>v_mission
      or v_existing->>'unit'<>v_entity->>'unit' or v_existing->>'note'<>coalesce(v_entity->>'note','')
      or v_existing->>'occurredAt'<>v_entity->>'occurredAt') then raise exception 'Quantity correction cannot change other fields'; end if;
   end if;
 else
   v_result:=v_entity->>'result';
   v_detail:=case when jsonb_typeof(v_entity->'detail')='string' then (v_entity->>'detail')::jsonb else v_entity->'detail' end;
   if v_result is null or v_result not in ('pending','fulfilled','failed','exempt')
   or jsonb_typeof(v_detail) is distinct from 'object' or length(v_detail::text)>5000 then raise exception 'Invalid decision'; end if;
   if v_result='exempt' and nullif(btrim(v_detail->>'note'),'') is null then raise exception 'Exemption requires a reason'; end if;
   if v_mission='airofit' and v_result='fulfilled' and v_detail->'planCompleted' is distinct from 'true'::jsonb then raise exception 'Confirm completion of the planned Airofit training';end if;
   if v_mission='sleep' and v_result='fulfilled' then
    if v_detail->>'bed'<>'22:30' or v_detail->>'wake'<>'06:30' or coalesce((v_detail->>'minutes')::integer,0)<420
    or v_detail->>'bed' is null or v_detail->>'wake' is null then raise exception 'Invalid strict sleep fulfillment'; end if;
   end if;
   select d.revision,jsonb_build_object('id',d.day::text||':'||d.mission,'day',d.day,'mission',d.mission,
    'result',d.result,'detail',d.detail::text,'revision',d.revision) into v_current_revision,v_existing
   from wa_private.decisions d where d.player_id=v_player and d.season_id='2026' and d.day=v_day and d.mission=v_mission;
   v_current_revision:=coalesce(v_current_revision,0);
 end if;
 if v_current_revision<>p_base_revision or (p_kind='correct-entry' and v_existing is null)
 or (p_kind='add-entry' and v_existing is not null) then
   v_response:=jsonb_build_object('status','conflict','current',v_existing,'baseRevision',p_base_revision,'currentRevision',v_current_revision);
 else
   -- Draft objectives only; closing will verify historical objectives in a later migration.
   insert into wa_private.days(player_id,season_id,day,rule_version,objectives)
   values(v_player,'2026',v_day,'1.2','{"status":"unverified","rank":"D","pushups":10,"abs":10,"squats":10,"steps":1000,"reading":10}')
   on conflict(player_id,season_id,day) do nothing;
   if p_kind in ('add-entry','correct-entry') then
    insert into wa_private.entries(player_id,id,season_id,day,mission,quantity,unit,note,occurred_at,revision)
    values(v_player,v_id,'2026',v_day,v_mission,v_quantity,v_entity->>'unit',coalesce(v_entity->>'note',''),
     (v_entity->>'occurredAt')::timestamp at time zone 'America/Bogota',v_current_revision+1)
    on conflict(player_id,id) do update set quantity=excluded.quantity,revision=excluded.revision;
   else
    insert into wa_private.decisions(player_id,season_id,day,mission,result,detail,revision)
    values(v_player,'2026',v_day,v_mission,v_result,v_detail,v_current_revision+1)
    on conflict(player_id,season_id,day,mission) do update set result=excluded.result,detail=excluded.detail,revision=excluded.revision;
   end if;
   v_response:=jsonb_build_object('status','accepted','revision',v_current_revision+1);
 end if;
 update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
 insert into wa_private.operations(player_id,id,kind,payload,result,revision)
 values(v_player,p_operation,p_kind,jsonb_build_object('body',p_payload,'baseRevision',p_base_revision),v_response,v_revision);
 return v_response;
end;
$$;

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
 update wa_private.days set rule_version='1.2' where player_id=v_player and season_id='2026' and day=v_day;
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
 if jsonb_typeof(p_payload->'results') is distinct from 'array' or jsonb_array_length(p_payload->'results') not between 1 and 13 then raise exception 'Choose missions to close';end if;
 if jsonb_typeof(p_payload->'entries') is distinct from 'array' or jsonb_typeof(p_payload->'decisions') is distinct from 'array' then raise exception 'Missing record snapshot';end if;
 select objectives into v_objectives from wa_private.days where player_id=v_player and season_id='2026' and day=v_day;
 if v_objectives is null or v_objectives->>'status'<>'verified' then
  v_objectives:=wa_private.objectives_for(v_player,v_day);
 end if;
 if ((p_payload->'objectives') - 'status') is distinct from (v_objectives - 'status') then
  v_response:=jsonb_build_object('status','conflict','category','close','message','Los objetivos efectivos difieren; sincroniza y revisa el cierre.');
 end if;
 for v_mission in select distinct value->>'mission' from jsonb_array_elements(p_payload->'results') loop
  if v_mission is null or v_mission not in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit') then raise exception 'Invalid mission';end if;
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
 values(v_player,'2026',v_day,'1.2',v_objectives)
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
declare v_player uuid:=auth.uid();v_base jsonb;v_days jsonb;v_moves jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 v_base:=wa_private.account_snapshot_sleep();
 select coalesce(jsonb_agg(value||jsonb_build_object('ruleVersion',d.rule_version)),'[]') into v_days
 from jsonb_array_elements(v_base->'days') left join wa_private.days d
 on d.player_id=v_player and d.season_id='2026' and d.day=(value->>'day')::date;
 select coalesce(jsonb_agg(value||jsonb_build_object('operationId',m.operation_id,
 'day',coalesce(o.payload->>'day',o.payload->'body'->>'day',o.payload->'body'->'corrected'->>'day',t.wake_day::text),
 'mission',case when split_part(m.reference,':',2) in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit') then split_part(m.reference,':',2) else null end,
 'label',t.label,'product',t.product)),'[]') into v_moves
 from jsonb_array_elements(v_base->'movements')
 join wa_private.movements m on m.player_id=v_player and m.id=(value->>'id')::uuid
 left join wa_private.operations o on o.player_id=m.player_id and o.id=m.operation_id
 left join wa_private.tickets t on t.player_id=m.player_id and t.operation_id=m.operation_id;
 return v_base||jsonb_build_object('days',v_days,'movements',v_moves,'historyEnabled',true,'airofitEnabled',true,'missionCount',13);
end;$$;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';commit;
select 'airofit_ready' as status;
