-- Diario por Player: revisiones asignadas bajo su mismo bloqueo transaccional.
begin;
create table if not exists wa_private.sync_changes (
 player_id uuid not null references wa_private.players(id) on delete cascade,
 revision bigint not null, collection text not null, entity_key text not null,
 removed boolean not null default false, primary key(player_id,revision)
);
alter table wa_private.sync_changes enable row level security;
create or replace function wa_private.track_sync_change() returns trigger
language plpgsql set search_path='' as $$
declare row_data jsonb;v_player uuid;v_revision bigint;v_key text;
begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_player:=(row_data->>'player_id')::uuid;
 update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
 v_key:=case when TG_TABLE_NAME in ('entries','movements','tickets') then row_data->>'id'
 when TG_TABLE_NAME in ('decisions','evaluations') then (row_data->>'day')||':'||(row_data->>'mission')
 when TG_TABLE_NAME='days' then row_data->>'day'
 when TG_TABLE_NAME='flexibility' then row_data->>'week_start'
 else row_data->>'operation_id' end;
 insert into wa_private.sync_changes values(v_player,v_revision,TG_TABLE_NAME,v_key,TG_OP='DELETE');
 return case when TG_OP='DELETE' then old else new end;
end;$$;
do $$ declare t text;begin
 foreach t in array array['entries','decisions','days','evaluations','movements','tickets','flexibility','ascents'] loop
 execute format('drop trigger if exists wa_track_sync on wa_private.%I',t);
 execute format('create trigger wa_track_sync after insert or update or delete on wa_private.%I for each row execute function wa_private.track_sync_change()',t);
 end loop;
end;$$;
-- Sembrar el diario con entidades existentes, sin editar hábitos ni contabilidad.
do $$ declare t text;r jsonb;v_player uuid;v_key text;v_revision bigint;begin
 foreach t in array array['entries','decisions','days','evaluations','movements','tickets','flexibility','ascents'] loop
 for r in execute format('select to_jsonb(row_data) from wa_private.%I row_data',t) loop
 v_player:=(r->>'player_id')::uuid;
 v_key:=case when t in ('entries','movements','tickets') then r->>'id'
 when t in ('decisions','evaluations') then (r->>'day')||':'||(r->>'mission')
 when t='days' then r->>'day' when t='flexibility' then r->>'week_start' else r->>'operation_id' end;
 if not exists(select 1 from wa_private.sync_changes where player_id=v_player and collection=t and entity_key=v_key) then
 update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
 insert into wa_private.sync_changes values(v_player,v_revision,t,v_key,false);
 end if;
 end loop;
 end loop;
end $$;
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
revoke all on all tables in schema wa_private from public,anon,authenticated;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_sync_page(bigint,integer) from public,anon;
grant execute on function public.wa_sync_page(bigint,integer) to authenticated;
notify pgrst,'reload schema';commit;
