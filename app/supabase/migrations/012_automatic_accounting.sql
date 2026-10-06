-- Credit accepted mission results immediately; no manual day closure is required.
begin;
do $$ begin
 if to_regprocedure('wa_private.apply_before_automatic_accounting(uuid,text,jsonb,bigint)') is null then
  alter function public.wa_apply_draft(uuid,text,jsonb,bigint) rename to apply_before_automatic_accounting;
  alter function public.apply_before_automatic_accounting(uuid,text,jsonb,bigint) set schema wa_private;
 end if;
end $$;
create or replace function public.wa_apply_draft(p_operation uuid,p_kind text,p_payload jsonb,p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_result jsonb;v_entity jsonb;v_day date;v_mission text;v_before bigint;v_replay boolean;v_effect jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 perform public.wa_bootstrap();perform 1 from wa_private.players where id=v_player for update;
 select exists(select 1 from wa_private.operations where player_id=v_player and id=p_operation) into v_replay;
 v_entity:=case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end;
 v_day:=(v_entity->>'day')::date;v_mission:=v_entity->>'mission';
 if p_kind in ('add-entry','correct-entry','set-decision') and v_day between date '2026-10-05' and least(date '2026-12-31',(now() at time zone 'America/Bogota')::date) then
  insert into wa_private.days(player_id,season_id,day,rule_version,objectives)
  values(v_player,'2026',v_day,'1.2',wa_private.objectives_for(v_player,v_day))
  on conflict(player_id,season_id,day) do update set objectives=excluded.objectives
  where wa_private.days.objectives->>'status'<>'verified';
 end if;
 v_before:=(wa_private.balances(v_player)->>'xp')::bigint;
 v_result:=wa_private.apply_before_automatic_accounting(p_operation,p_kind,p_payload,p_base_revision);
 if v_replay or v_result->>'status'<>'accepted' then return v_result;end if;
 v_entity:=case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end;
 v_day:=(v_entity->>'day')::date;v_mission:=v_entity->>'mission';
 if p_kind in ('add-entry','correct-entry','set-decision') then
  v_effect:=wa_private.evaluate_mission(v_player,v_day,v_mission);
  if v_effect->>'result'<>'pending' and not exists(select 1 from wa_private.evaluations where player_id=v_player and season_id='2026' and day=v_day and mission=v_mission) then
   perform wa_private.account_mission(v_player,p_operation,v_day,v_mission);
   perform wa_private.record_level(v_player,p_operation,v_before);
  end if;
 end if;
 return v_result;
end;$$;
create or replace function public.wa_account_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin return wa_private.account_snapshot_before_capabilities()||jsonb_build_object('entryCorrectionsEnabled',true,'simpleSleepEnabled',true,'automaticAccountingEnabled',true);end;$$;
revoke all on function wa_private.apply_before_automatic_accounting(uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint) to authenticated;
revoke all on function public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
