-- ROAD TRACKER — initial schema
-- Принципы:
--   * Первичные ключи — UUID, генерируются на клиенте (offline-first, идемпотентные upsert).
--   * Каждая строка несёт user_id → RLS проверяет владельца без JOIN.
--   * Дочерние записи ссылаются на родителя составным FK (id, user_id): нельзя
--     прикрепить сегмент к чужой поездке, даже подставив чужой trip_id.
--   * Удаление синхронизируется через tombstone (deleted_at), физическая очистка — отдельно.
--   * Конфликты: last-write-wins по updated_at (устаревшая запись не перетирает новую).
--   * Деньги — integer в копейках, без плавающей точки.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type trip_direction   as enum ('to_work', 'to_home', 'other');
create type tracking_mode    as enum ('manual', 'gps', 'auto');
create type trip_status      as enum ('suggested', 'active', 'paused', 'completed', 'discarded');
create type transport_type   as enum ('walk', 'bus', 'minibus', 'trolleybus', 'tram', 'metro',
                                      'train', 'taxi', 'car', 'bicycle', 'scooter', 'other');
create type inspection_outcome as enum ('no_controller', 'present_not_checked', 'ticket_checked',
                                        'checked_at_transfer', 'unknown');
create type place_kind       as enum ('home', 'work', 'other');

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  -- Клиент присылает свой updated_at (время правки на устройстве).
  -- Если он не прислан — ставим серверное время.
  if new.updated_at is null then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Last-write-wins: если пришла более старая версия строки, оставляем текущую.
create or replace function public.reject_stale_write() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;            -- тихо игнорируем устаревшую запись (идемпотентно для очереди)
  end if;
  -- Восстановление удалённой записи без явного намерения запрещено
  if old.deleted_at is not null and new.deleted_at is null and new.updated_at <= old.deleted_at then
    return old;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- locations
create table public.locations (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        place_kind not null default 'other',
  name        text not null check (char_length(name) between 1 and 80),
  address     text check (char_length(address) <= 300),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  radius      integer not null default 150 check (radius between 100 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (id, user_id)
);
-- Не более одного «Дома» и одной «Работы» среди живых записей
create unique index locations_one_home_work on public.locations (user_id, kind)
  where kind in ('home', 'work') and deleted_at is null;
create index locations_user_updated on public.locations (user_id, updated_at);

-- ---------------------------------------------------------------- routes
create table public.routes (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  origin_id      uuid,
  destination_id uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (id, user_id),
  foreign key (origin_id, user_id)      references public.locations (id, user_id),
  foreign key (destination_id, user_id) references public.locations (id, user_id)
);
create index routes_user_updated on public.routes (user_id, updated_at);

-- ---------------------------------------------------------------- trips
create table public.trips (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  route_id         uuid,
  direction        trip_direction not null default 'other',
  started_at       timestamptz not null,
  finished_at      timestamptz,
  -- Часовой пояс устройства в момент старта: для корректной группировки по дням
  time_zone        text not null default 'Europe/Kyiv',
  duration_seconds integer check (duration_seconds >= 0),
  paused_seconds   integer not null default 0 check (paused_seconds >= 0),
  total_cost       integer not null default 0 check (total_cost >= 0),  -- копейки
  currency         char(3) not null default 'UAH',
  distance_meters  integer check (distance_meters >= 0),
  tracking_mode    tracking_mode not null default 'manual',
  status           trip_status not null default 'active',
  comment          text check (char_length(comment) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (id, user_id),
  foreign key (route_id, user_id) references public.routes (id, user_id),
  check (finished_at is null or finished_at >= started_at),
  check (status not in ('completed') or finished_at is not null)
);
create index trips_user_started on public.trips (user_id, started_at desc) where deleted_at is null;
create index trips_user_updated on public.trips (user_id, updated_at);
-- Защита от дублей: одна активная/приостановленная поездка на пользователя
create unique index trips_one_active on public.trips (user_id)
  where status in ('active', 'paused') and deleted_at is null;

-- ---------------------------------------------------------------- trip_segments
create table public.trip_segments (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  trip_id          uuid not null,
  position         smallint not null check (position >= 0),
  transport_type   transport_type not null,
  transport_number text check (char_length(transport_number) <= 20),
  route_name       text check (char_length(route_name) <= 80),
  started_at       timestamptz,
  finished_at      timestamptz,
  cost             integer not null default 0 check (cost >= 0),   -- копейки
  distance_meters  integer check (distance_meters >= 0),
  transfer_number  smallint not null default 0 check (transfer_number >= 0),
  comment          text check (char_length(comment) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (id, user_id),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  check (finished_at is null or started_at is null or finished_at >= started_at)
);
create index trip_segments_trip on public.trip_segments (trip_id, position);
create index trip_segments_user_updated on public.trip_segments (user_id, updated_at);

-- ---------------------------------------------------------------- inspections
create table public.inspections (
  id                 uuid primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  trip_id            uuid not null,
  segment_id         uuid,
  outcome            inspection_outcome not null,
  -- Производные поля из spec (оставлены для удобства запросов), согласованы с outcome
  controller_present boolean generated always as
                       (case outcome when 'no_controller' then false
                                     when 'unknown' then null
                                     else true end) stored,
  ticket_checked     boolean generated always as
                       (case outcome when 'ticket_checked' then true
                                     when 'checked_at_transfer' then true
                                     when 'unknown' then null
                                     else false end) stored,
  location_latitude  double precision check (location_latitude between -90 and 90),
  location_longitude double precision check (location_longitude between -180 and 180),
  observed_at        timestamptz not null,
  comment            text check (char_length(comment) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  foreign key (trip_id, user_id)    references public.trips (id, user_id) on delete cascade,
  foreign key (segment_id, user_id) references public.trip_segments (id, user_id) on delete set null (segment_id),
  check ((location_latitude is null) = (location_longitude is null))
);
create index inspections_trip on public.inspections (trip_id);
create index inspections_user_observed on public.inspections (user_id, observed_at desc) where deleted_at is null;
create index inspections_user_updated on public.inspections (user_id, updated_at);

-- ---------------------------------------------------------------- track points (опционально)
-- По умолчанию трек хранится только на устройстве. В облако попадает,
-- только если пользователь включил settings.sync_track_points.
create table public.trip_track_points (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  trip_id     uuid not null,
  recorded_at timestamptz not null,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  horizontal_accuracy real,
  speed       real,
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  unique (trip_id, recorded_at)
);

-- ---------------------------------------------------------------- settings
create table public.settings (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  home_location_id      uuid,
  work_location_id      uuid,
  tracking_mode         tracking_mode not null default 'manual',
  currency              char(3) not null default 'UAH',
  locale                text not null default 'ru',
  notifications_enabled boolean not null default false,
  gps_enabled           boolean not null default false,
  sync_track_points     boolean not null default false,
  track_retention_days  integer not null default 30 check (track_retention_days between 0 and 3650),
  updated_at            timestamptz not null default now(),
  foreign key (home_location_id, user_id) references public.locations (id, user_id),
  foreign key (work_location_id, user_id) references public.locations (id, user_id)
);

-- ---------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','locations','routes','trips','trip_segments','inspections','settings'] loop
    execute format('create trigger %1$s_touch before insert or update on public.%1$s
                    for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['locations','routes','trips','trip_segments','inspections'] loop
    execute format('create trigger %1$s_lww before update on public.%1$s
                    for each row execute function public.reject_stale_write()', t);
  end loop;
end $$;

-- Профиль и настройки создаются при регистрации
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RLS
alter table public.profiles          enable row level security;
alter table public.locations         enable row level security;
alter table public.routes            enable row level security;
alter table public.trips             enable row level security;
alter table public.trip_segments     enable row level security;
alter table public.inspections       enable row level security;
alter table public.trip_track_points enable row level security;
alter table public.settings          enable row level security;

create policy profiles_own on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['locations','routes','trips','trip_segments','inspections','trip_track_points','settings'] loop
    execute format('create policy %1$s_own on public.%1$s for all to authenticated
                    using (user_id = (select auth.uid()))
                    with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Анонимной роли — ничего
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------- приватность
-- Удалить всю историю геолокации пользователя (треки + координаты наблюдений)
create or replace function public.delete_my_location_history() returns void
language sql security invoker set search_path = public as $$
  delete from public.trip_track_points where user_id = auth.uid();
  update public.inspections
     set location_latitude = null, location_longitude = null, updated_at = now()
   where user_id = auth.uid() and location_latitude is not null;
$$;

-- Полное удаление аккаунта и всех данных (каскадом через auth.users)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_my_location_history() to authenticated;

-- Физическая очистка tombstone старше 90 дней (запускать по расписанию pg_cron)
create or replace function public.purge_tombstones(older_than interval default '90 days') returns void
language sql security definer set search_path = public as $$
  delete from public.inspections   where deleted_at < now() - older_than;
  delete from public.trip_segments where deleted_at < now() - older_than;
  delete from public.trips         where deleted_at < now() - older_than;
  delete from public.routes        where deleted_at < now() - older_than;
  delete from public.locations     where deleted_at < now() - older_than;
$$;
revoke execute on function public.purge_tombstones(interval) from public, anon, authenticated;
