-- Simplified sleep attestations preserve rewards, ticket checks, weekly flexibility,
-- idempotency, revisions and correction accounting without inventing measurements.
begin;
create or replace function public.wa_apply_draft(p_operation uuid,p_kind text,p_payload jsonb,p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_response jsonb;v_before bigint;v_day date;v_mission text;v_entity jsonb;v_detail jsonb;
 v_saved wa_private.operations%rowtype;v_sanitized jsonb:=p_payload;v_ticket wa_private.tickets%rowtype;
 v_ticket_id uuid;v_bed timestamp;v_wake timestamp;v_minutes integer;v_coverage text;v_result text;v_week date;
 v_other_night date;v_revision bigint;v_current jsonb;v_normalized text;v_self_reported boolean:=false;
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
   v_self_reported:=v_detail->'selfReported'='true'::jsonb;
   if coalesce(v_self_reported,false) then
    if v_result in ('fulfilled','ticket') and v_detail->'minimumSleepMet' is distinct from 'true'::jsonb
    then raise exception 'Confirm at least seven hours of sleep';end if;
    if v_coverage='strict' and v_result='ticket' then raise exception 'A ticket requires ticket coverage';end if;
    if v_coverage='ticket' and v_result='fulfilled' then raise exception 'Ticket coverage grants no rewards';end if;
    if v_coverage='strict' and v_result='fulfilled' then
     if v_detail->'scheduleMet' is distinct from 'true'::jsonb then raise exception 'Confirm the strict sleep schedule';end if;
     if v_day=(now() at time zone 'America/Bogota')::date and (now() at time zone 'America/Bogota')::time<time '06:30'
     then raise exception 'Record strict sleep after the scheduled wake time';end if;
    end if;
    if v_detail ? 'bedAt' or v_detail ? 'wakeAt' or v_detail ? 'bed' or v_detail ? 'wake' or v_detail ? 'minutes'
    then raise exception 'Self-reported sleep must not include measured times';end if;
    v_detail:=v_detail||jsonb_build_object('coverage',v_coverage,'night',v_day,'sleepReference','wake-day');
   else
   v_bed:=coalesce(v_detail->>'bedAt',(v_day-1)::text||'T'||(v_detail->>'bed'))::timestamp;
   v_wake:=coalesce(v_detail->>'wakeAt',v_day::text||'T'||(v_detail->>'wake'))::timestamp;
   v_minutes:=(v_detail->>'minutes')::integer;
   if v_bed is null or v_wake is null or v_minutes is null or v_minutes<0 or v_bed::date not between v_day-1 and v_day
   or v_wake<=v_bed or v_wake::date<>v_day or (v_wake at time zone 'America/Bogota')>now() or v_minutes>extract(epoch from (v_wake-v_bed))/60
   or (v_detail->>'minutes')::numeric<>v_minutes then raise exception 'Invalid effective sleep duration or dates';end if;
   v_detail:=v_detail||jsonb_build_object('bed',to_char(v_bed,'HH24:MI'),'wake',to_char(v_wake,'HH24:MI'),'bedAt',to_char(v_bed,'YYYY-MM-DD"T"HH24:MI'),'wakeAt',to_char(v_wake,'YYYY-MM-DD"T"HH24:MI'),'coverage',v_coverage,'night',v_day,'sleepReference','wake-day');
   end if;
   if v_coverage='ticket' then
    v_ticket_id:=(v_detail->>'ticketId')::uuid;
    select * into v_ticket from wa_private.tickets where player_id=v_player and id=v_ticket_id and product='sleep';
    if not found or v_ticket.wake_day<>v_day or v_ticket.week_start<>v_week
    or (coalesce(v_self_reported,false) and v_ticket.purchased_at>=v_ticket.assigned_at)
    or (not coalesce(v_self_reported,false) and v_ticket.purchased_at>=(v_bed at time zone 'America/Bogota')) then raise exception 'Invalid or late night ticket';end if;
   end if;
   if v_coverage='flexible' then
    select night into v_other_night from wa_private.flexibility where player_id=v_player and week_start=v_week;
    if v_other_night is not null and v_other_night<>v_day then
     select jsonb_build_object('id',day::text||':sleep','day',day,'mission','sleep','result',result,'detail',detail::text,'revision',revision)
     into v_current from wa_private.decisions where player_id=v_player and season_id='2026' and day=v_day and mission='sleep';
     v_response:=jsonb_build_object('status','conflict','category','flexibility','current',v_current,'message','This week''s flexible night is already assigned to another night.');
    end if;
   end if;
   if coalesce(v_self_reported,false) then
    v_normalized:=case when v_result='failed' then 'failed' when v_coverage='ticket' then 'ticket' else 'fulfilled' end;
   else
   v_normalized:=case when v_minutes<420 then 'failed' when v_coverage='ticket' then 'ticket' when v_coverage='flexible' then 'fulfilled'
    when v_bed::date=v_day-1 and v_bed::time=time '22:30' and v_wake::time=time '06:30' then 'fulfilled' else 'failed' end;
   end if;
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


do $$ begin
 if to_regprocedure('wa_private.evaluate_before_simple_sleep(uuid,date,text)') is null then
  alter function wa_private.evaluate_mission(uuid,date,text) rename to evaluate_before_simple_sleep;
 end if;
end $$;
create or replace function wa_private.evaluate_mission(p_player uuid,p_day date,p_mission text)
returns jsonb language plpgsql set search_path='' as $$
declare v_result text;v_detail jsonb;
begin
 if p_mission='sleep' then
  select result,detail into v_result,v_detail from wa_private.decisions where player_id=p_player and season_id='2026' and day=p_day and mission='sleep';
  if v_detail->'selfReported'='true'::jsonb then
   if v_result='failed' then return jsonb_build_object('result','failed','xp',0,'mc',-15);end if;
   if v_result='ticket' then return jsonb_build_object('result','ticket','xp',0,'mc',0);end if;
   if v_result='fulfilled' then return jsonb_build_object('result','fulfilled','xp',15,'mc',3);end if;
  end if;
 end if;
 return wa_private.evaluate_before_simple_sleep(p_player,p_day,p_mission);
end;$$;
revoke all on function wa_private.evaluate_mission(uuid,date,text) from public,anon,authenticated;
revoke all on function wa_private.evaluate_before_simple_sleep(uuid,date,text) from public,anon,authenticated;

create or replace function public.wa_account_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin return wa_private.account_snapshot_before_capabilities()||jsonb_build_object('entryCorrectionsEnabled',true,'simpleSleepEnabled',true);end;$$;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint) to authenticated;
revoke all on function public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
