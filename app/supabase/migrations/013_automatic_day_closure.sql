-- A day expires at midnight Bogotá two calendar dates after its date.
begin;
alter table wa_private.days add column if not exists closed_at timestamptz;
create or replace function wa_private.finalize_expired_days(p_player uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_day date;v_mission text;v_effect jsonb;v_operation uuid;v_revision bigint;v_before bigint;
begin
 perform 1 from wa_private.players where id=p_player for update;
 if not found then return;end if;
 for v_day in
  select date '2026-10-05'+n from generate_series(0,least(date '2026-12-31',(now() at time zone 'America/Bogota')::date-2)-date '2026-10-05') n
  where not exists(select 1 from wa_private.days d where d.player_id=p_player and d.season_id='2026' and d.day=date '2026-10-05'+n and d.closed_at is not null)
  order by n
 loop
  insert into wa_private.days(player_id,season_id,day,rule_version,objectives)
  values(p_player,'2026',v_day,'1.2',wa_private.objectives_for(p_player,v_day))
  on conflict(player_id,season_id,day) do update set objectives=excluded.objectives where wa_private.days.objectives->>'status'<>'verified';
  v_operation:=gen_random_uuid();v_before:=(wa_private.balances(p_player)->>'xp')::bigint;
  update wa_private.players set revision=revision+1 where id=p_player returning revision into v_revision;
  insert into wa_private.operations(player_id,id,kind,payload,result,revision)
  values(p_player,v_operation,'auto-close',jsonb_build_object('day',v_day),'{}',v_revision);
  foreach v_mission in array array['word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach','airofit'] loop
   v_effect:=wa_private.evaluate_mission(p_player,v_day,v_mission);
   if v_effect->>'result'='pending' then
    insert into wa_private.decisions(player_id,season_id,day,mission,result,detail,revision)
    values(p_player,'2026',v_day,v_mission,'failed',jsonb_build_object('autoClosed',true,'note','Not completed before the day closed.'),1)
    on conflict(player_id,season_id,day,mission) do update set result='failed',detail=excluded.detail,revision=wa_private.decisions.revision+1;
   end if;
   perform wa_private.account_mission(p_player,v_operation,v_day,v_mission);
  end loop;
  perform wa_private.record_level(p_player,v_operation,v_before);
  update wa_private.days set closed_at=((v_day+2)::timestamp at time zone 'America/Bogota') where player_id=p_player and season_id='2026' and day=v_day;
  update wa_private.operations set result=jsonb_build_object('status','accepted','closedAt',((v_day+2)::timestamp at time zone 'America/Bogota'),'balances',wa_private.balances(p_player)) where player_id=p_player and id=v_operation;
 end loop;
end;$$;
create or replace function wa_private.finalize_all_expired_days()
returns void language plpgsql security definer set search_path='' as $$
declare v_player uuid;
begin
 for v_player in select id from wa_private.players order by id loop perform wa_private.finalize_expired_days(v_player);end loop;
end;$$;
do $$ begin
 if to_regprocedure('wa_private.apply_before_day_closure(uuid,text,jsonb,bigint)') is null then
  alter function public.wa_apply_draft(uuid,text,jsonb,bigint) rename to apply_before_day_closure;
  alter function public.apply_before_day_closure(uuid,text,jsonb,bigint) set schema wa_private;
  alter function public.wa_close(uuid,jsonb) rename to close_before_day_closure;
  alter function public.close_before_day_closure(uuid,jsonb) set schema wa_private;
 end if;
end $$;
create or replace function public.wa_apply_draft(p_operation uuid,p_kind text,p_payload jsonb,p_base_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_day date;v_original_day date;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 perform public.wa_bootstrap();perform 1 from wa_private.players where id=v_player for update;
 -- Previously accepted operations remain safe to retry after their day expires.
 if exists(select 1 from wa_private.operations where player_id=v_player and id=p_operation) then
  return wa_private.apply_before_day_closure(p_operation,p_kind,p_payload,p_base_revision);
 end if;
 v_day:=(case when p_kind='correct-entry' then p_payload->'corrected' else p_payload end->>'day')::date;
 if p_kind='correct-entry' then
  select day into v_original_day from wa_private.entries where player_id=v_player and id=(p_payload->'corrected'->>'id')::uuid;
 end if;
 if v_day<(now() at time zone 'America/Bogota')::date-1 or v_original_day<(now() at time zone 'America/Bogota')::date-1
 or exists(select 1 from wa_private.days where player_id=v_player and season_id='2026' and day in (v_day,v_original_day) and closed_at is not null)
 then raise exception 'Day is closed. Records can no longer be changed.';end if;
 perform wa_private.finalize_expired_days(v_player);
 return wa_private.apply_before_day_closure(p_operation,p_kind,p_payload,p_base_revision);
end;$$;
create or replace function public.wa_close(p_operation uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_day date:=(p_payload->>'day')::date;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 perform public.wa_bootstrap();perform 1 from wa_private.players where id=v_player for update;
 if exists(select 1 from wa_private.operations where player_id=v_player and id=p_operation) then return wa_private.close_before_day_closure(p_operation,p_payload);end if;
 if v_day<(now() at time zone 'America/Bogota')::date-1 or exists(select 1 from wa_private.days where player_id=v_player and season_id='2026' and day=v_day and closed_at is not null)
 then raise exception 'Day is closed. Records can no longer be changed.';end if;
 perform wa_private.finalize_expired_days(v_player);
 return wa_private.close_before_day_closure(p_operation,p_payload);
end;$$;
create or replace function public.wa_account_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_snapshot jsonb;v_days jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 perform public.wa_bootstrap();perform wa_private.finalize_expired_days(v_player);
 v_snapshot:=wa_private.account_snapshot_before_capabilities();
 select coalesce(jsonb_agg(item||jsonb_build_object('closedAt',d.closed_at)),'[]'::jsonb) into v_days
 from jsonb_array_elements(v_snapshot->'days') item join wa_private.days d on d.player_id=v_player and d.season_id='2026' and d.day=(item->>'day')::date;
 return v_snapshot||jsonb_build_object('days',v_days,'entryCorrectionsEnabled',true,'simpleSleepEnabled',true,'automaticAccountingEnabled',true,'automaticDayClosureEnabled',true);
end;$$;
revoke all on function wa_private.finalize_expired_days(uuid),wa_private.finalize_all_expired_days(),wa_private.apply_before_day_closure(uuid,text,jsonb,bigint),wa_private.close_before_day_closure(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_apply_draft(uuid,text,jsonb,bigint),public.wa_close(uuid,jsonb),public.wa_account_snapshot() to authenticated;
create or replace function public.wa_sync_page(p_cursor bigint default null,p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_revision bigint;v_end bigint;v_snapshot jsonb;v_collection text;v_items jsonb;v_delta jsonb;v_removed jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_limit is null or p_limit not between 1 and 500 or p_cursor<0 then raise exception 'Invalid sync cursor or limit';end if;
 perform public.wa_bootstrap();
 select revision into v_revision from wa_private.players where id=v_player for update;
 if p_cursor>v_revision then raise exception 'Cursor ahead of account';end if;
 v_snapshot:=public.wa_account_snapshot();
 -- Snapshot finalization may have appended new accounting revisions.
 select revision into v_revision from wa_private.players where id=v_player;
 -- El primer acceso también pagina; el diario incluye las entidades anteriores.
 p_cursor:=coalesce(p_cursor,0);
 select max(revision) into v_end from (select revision from wa_private.sync_changes where player_id=v_player and revision>p_cursor order by revision limit p_limit) page;
 v_end:=coalesce(v_end,v_revision);
 if not exists(select 1 from wa_private.sync_changes where player_id=v_player and revision>v_end) then v_end:=v_revision;end if;
 v_delta:=v_snapshot;
 foreach v_collection in array array['entries','decisions','days','evaluations','movements'] loop
 select coalesce(jsonb_agg(value),'[]'::jsonb) into v_items from jsonb_array_elements(v_snapshot->v_collection)
 where exists(select 1 from wa_private.sync_changes c where c.player_id=v_player and c.revision>p_cursor and c.revision<=v_end and c.collection=v_collection
 and c.entity_key=case when v_collection='evaluations' then (value->>'day')||':'||(value->>'mission') else value->>'id' end)
 or (v_collection='days' and exists(select 1 from wa_private.sync_changes c where c.player_id=v_player and c.collection='ascents' and c.revision>p_cursor and c.revision<=v_end));
 v_delta:=jsonb_set(v_delta,array[v_collection],v_items);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('collection',collection,'key',entity_key)),'[]'::jsonb) into v_removed
 from wa_private.sync_changes where player_id=v_player and revision>p_cursor and revision<=v_end and removed;
 return jsonb_build_object('cursor',v_end,'hasMore',v_end<v_revision,'snapshot',v_delta,'removed',v_removed);
end;$$;
-- Supabase Cron runs even when the application is closed. Reads/writes recover missed runs.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('winter-arc-close-days','0 5 * * *','select wa_private.finalize_all_expired_days()');
 else
  raise notice 'pg_cron unavailable: install/enable Supabase Cron for midnight closure; sync still finalizes expired days.';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
