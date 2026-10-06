-- Habilita edición ampliada en interfaz; no modifica misiones ni objetivos.
begin;
do $$ begin
 if to_regprocedure('wa_private.account_snapshot_before_capabilities()') is null then
 alter function public.wa_account_snapshot() set schema wa_private;
 alter function wa_private.wa_account_snapshot() rename to account_snapshot_before_capabilities;
 end if;
end $$;
create or replace function public.wa_account_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin return wa_private.account_snapshot_before_capabilities()||jsonb_build_object('entryCorrectionsEnabled',true);end;$$;
revoke all on all functions in schema wa_private from public,anon,authenticated;
revoke all on function public.wa_account_snapshot() from public,anon;
grant execute on function public.wa_account_snapshot() to authenticated;
notify pgrst,'reload schema';commit;
