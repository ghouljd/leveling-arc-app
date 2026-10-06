-- Amplía la consulta de historial; no modifica registros, saldos ni evaluaciones.
begin;
do $$begin
 if to_regprocedure('wa_private.account_snapshot_sleep()') is null then
  alter function public.wa_account_snapshot() set schema wa_private;
  alter function wa_private.wa_account_snapshot() rename to account_snapshot_sleep;
 end if;
end$$;
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
 'mission',case when split_part(m.reference,':',2) in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach') then split_part(m.reference,':',2) else null end,
 'label',t.label,'product',t.product)),'[]') into v_moves
 from jsonb_array_elements(v_base->'movements')
 join wa_private.movements m on m.player_id=v_player and m.id=(value->>'id')::uuid
 left join wa_private.operations o on o.player_id=m.player_id and o.id=m.operation_id
 left join wa_private.tickets t on t.player_id=m.player_id and t.operation_id=m.operation_id;
 return v_base||jsonb_build_object('days',v_days,'movements',v_moves,'historyEnabled',true);
end;$$;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';commit;
select 'history_snapshot_ready' as status;
