-- Winter Arc: base privada y conexión inicial. Ejecutar en Supabase SQL Editor.
-- No elimina registros, no importa pruebas locales y no acredita premios.
begin;

create schema if not exists wa_private;
revoke all on schema wa_private from public, anon, authenticated;

create table if not exists wa_private.players (
 id uuid primary key references auth.users(id),
 display_name text not null default 'Player',
 revision bigint not null default 0 check (revision >= 0),
 created_at timestamptz not null default now()
);
create table if not exists wa_private.seasons (
 player_id uuid not null references wa_private.players(id),
 id text not null,
 starts_on date not null,
 ends_on date not null,
 timezone text not null default 'America/Bogota',
 rule_version text not null,
 initial_xp integer not null default 0 check(initial_xp >= 0),
 initial_mc integer not null default 0,
 primary key(player_id,id),
 check(ends_on >= starts_on)
);
create table if not exists wa_private.days (
 player_id uuid not null,
 season_id text not null,
 day date not null,
 rule_version text not null,
 objectives jsonb not null check(jsonb_typeof(objectives)='object'),
 revision bigint not null default 0 check(revision >= 0),
 primary key(player_id,season_id,day),
 foreign key(player_id,season_id) references wa_private.seasons(player_id,id)
);
create table if not exists wa_private.entries (
 player_id uuid not null,
 id uuid not null,
 season_id text not null,
 day date not null,
 mission text not null check(mission in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach')),
 quantity integer not null check(quantity >= 0),
 unit text not null check(length(unit) between 1 and 100),
 note text not null default '' check(length(note)<=2000),
 occurred_at timestamptz not null,
 revision bigint not null check(revision > 0),
 primary key(player_id,id),
 foreign key(player_id,season_id,day) references wa_private.days(player_id,season_id,day)
);
create table if not exists wa_private.decisions (
 player_id uuid not null,
 season_id text not null,
 day date not null,
 mission text not null check(mission in ('word','control','food','alcohol','focus','reading','sleep','pushups','abs','squats','steps','coach')),
 result text not null check(result in ('pending','fulfilled','failed','ticket','exempt')),
 detail jsonb not null check(jsonb_typeof(detail)='object'),
 revision bigint not null check(revision > 0),
 primary key(player_id,season_id,day,mission),
 foreign key(player_id,season_id,day) references wa_private.days(player_id,season_id,day)
);
create table if not exists wa_private.operations (
 player_id uuid not null references wa_private.players(id),
 id uuid not null,
 kind text not null,
 payload jsonb not null,
 result jsonb not null,
 revision bigint not null check(revision > 0),
 accepted_at timestamptz not null default now(),
 primary key(player_id,id),
 unique(player_id,revision)
);
create table if not exists wa_private.movements (
 player_id uuid not null,
 id uuid not null,
 season_id text not null,
 operation_id uuid not null,
 resource text not null check(resource in ('xp','mc')),
 amount integer not null,
 cause text not null,
 reference text not null,
 reverses_id uuid,
 accredited_at timestamptz not null default now(),
 primary key(player_id,id),
 unique(player_id,season_id,reference),
 unique(player_id,reverses_id),
 foreign key(player_id,operation_id) references wa_private.operations(player_id,id),
 foreign key(player_id,season_id) references wa_private.seasons(player_id,id),
 foreign key(player_id,reverses_id) references wa_private.movements(player_id,id)
);
create index if not exists wa_entries_day on wa_private.entries(player_id,season_id,day);
create index if not exists wa_movements_season on wa_private.movements(player_id,season_id);

-- Defense in depth: no direct access even if a schema is accidentally exposed.
alter table wa_private.players enable row level security;
alter table wa_private.seasons enable row level security;
alter table wa_private.days enable row level security;
alter table wa_private.entries enable row level security;
alter table wa_private.decisions enable row level security;
alter table wa_private.operations enable row level security;
alter table wa_private.movements enable row level security;
revoke all on all tables in schema wa_private from public, anon, authenticated;

create or replace function public.wa_bootstrap()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_player uuid := auth.uid();
 v_xp bigint;
 v_mc bigint;
begin
 if v_player is null then raise exception 'Authentication required' using errcode='28000'; end if;
 insert into wa_private.players(id) values(v_player) on conflict(id) do nothing;
 insert into wa_private.seasons(player_id,id,starts_on,ends_on,rule_version)
 values(v_player,'2026','2026-10-05','2026-12-31','1.0')
 on conflict(player_id,id) do nothing;
 select s.initial_xp + coalesce(sum(m.amount) filter(where m.resource='xp'),0),
        s.initial_mc + coalesce(sum(m.amount) filter(where m.resource='mc'),0)
 into v_xp,v_mc
 from wa_private.seasons s left join wa_private.movements m
 on m.player_id=s.player_id and m.season_id=s.id
 where s.player_id=v_player and s.id='2026'
 group by s.initial_xp,s.initial_mc;
 return jsonb_build_object('schemaVersion',1,'season','2026','ruleVersion','1.0',
 'xp',v_xp,'mc',v_mc,'player',v_player,'syncEnabled',false);
end;
$$;
revoke all on function public.wa_bootstrap() from public,anon;
grant execute on function public.wa_bootstrap() to authenticated;

notify pgrst, 'reload schema';
commit;

-- Verification: expect seven rows, each with rls_enabled=true.
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname='wa_private' order by tablename;
