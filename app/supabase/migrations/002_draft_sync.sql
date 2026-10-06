-- Synchronizes draft records only. No XP/MC accreditation or ticket purchases.
begin;
create or replace function public.wa_apply_draft(
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
 if v_mission is null or v_mission not in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach')
 then raise exception 'Invalid mission'; end if;
 if p_kind in ('add-entry','correct-entry') then
   v_id:=(v_entity->>'id')::uuid; v_quantity:=(v_entity->>'quantity')::integer;
   if v_id is null or v_quantity is null or v_quantity<0 or (p_kind='add-entry' and v_quantity=0)
   or jsonb_typeof(v_entity->'quantity') is distinct from 'number'
   or (v_entity->>'quantity')::numeric<>v_quantity then raise exception 'Invalid quantity'; end if;
   if v_mission in ('sleep','coach') then raise exception 'Mission requires a decision'; end if;
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
   values(v_player,'2026',v_day,'1.0','{"status":"unverified","rank":"D","pushups":10,"abs":10,"squats":10,"steps":1000,"reading":10}')
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

create or replace function public.wa_draft_snapshot()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_player uuid:=auth.uid(); v_revision bigint; v_entries jsonb; v_decisions jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000'; end if;
 perform public.wa_bootstrap();
 -- Same lock as writes: snapshot and revision come from one consistent state.
 select revision into v_revision from wa_private.players where id=v_player for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'day',e.day,'mission',e.mission,
 'quantity',e.quantity,'unit',e.unit,'note',e.note,'revision',e.revision,
 'occurredAt',to_char(e.occurred_at at time zone 'America/Bogota','YYYY-MM-DD"T"HH24:MI')) order by e.id),'[]')
 into v_entries from wa_private.entries e where e.player_id=v_player and e.season_id='2026';
 select coalesce(jsonb_agg(jsonb_build_object('id',d.day::text||':'||d.mission,'day',d.day,
 'mission',d.mission,'result',d.result,'detail',d.detail::text,'revision',d.revision) order by d.day,d.mission),'[]')
 into v_decisions from wa_private.decisions d where d.player_id=v_player and d.season_id='2026';
 return jsonb_build_object('schemaVersion',2,'revision',v_revision,'entries',v_entries,'decisions',v_decisions);
end;
$$;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint) from public,anon;
revoke all on function public.wa_draft_snapshot() from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint) to authenticated;
grant execute on function public.wa_draft_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
select 'draft_sync_ready' as status;
