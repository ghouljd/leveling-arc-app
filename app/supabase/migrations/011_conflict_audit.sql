-- Resoluciones auditadas por Player, sin alterar la contabilidad.
begin;
create or replace function public.wa_audit_resolution(p_operation uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_player uuid:=auth.uid();v_saved wa_private.operations%rowtype;v_revision bigint;v_result jsonb;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object'
 or nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>2000
 or p_payload->>'choice' is null or p_payload->>'choice' not in ('remote','local')
 or jsonb_typeof(p_payload->'discardedIds') is distinct from 'array'
 then raise exception 'Invalid resolution audit';end if;
 perform public.wa_bootstrap();select revision into v_revision from wa_private.players where id=v_player for update;
 select * into v_saved from wa_private.operations where player_id=v_player and id=p_operation;
 if found then
 if v_saved.kind<>'conflict-resolution' or v_saved.payload<>p_payload then raise exception 'Operation identifier reused';end if;
 return v_saved.result;
 end if;
 if not exists(select 1 from wa_private.operations where player_id=v_player and id=(p_payload->>'conflictId')::uuid and result->>'status'='conflict') then raise exception 'Conflict does not belong to Player';end if;
 update wa_private.players set revision=revision+1 where id=v_player returning revision into v_revision;
 v_result:=jsonb_build_object('status','accepted','revision',v_revision);
 insert into wa_private.operations(player_id,id,kind,payload,result,revision) values(v_player,p_operation,'conflict-resolution',p_payload,v_result,v_revision);
 return v_result;
end;$$;
revoke all on function public.wa_audit_resolution(uuid,jsonb) from public,anon;
grant execute on function public.wa_audit_resolution(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';commit;
