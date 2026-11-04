-- Интеграционные тесты схемы: RLS, целостность, LWW, дубли, удаление.
-- Запуск: supabase/tests/run_local.sh
\set ON_ERROR_STOP on

create or replace function pg_temp.expect_error(sql text, label text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL (ожидалась ошибка): %', label;
exception
  when raise_exception then raise;
  when others then raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

-- Два пользователя
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test'),
  ('22222222-2222-2222-2222-222222222222', 'b@test');

select pg_temp.check((select count(*) from public.settings) = 2, 'settings создаются при регистрации');
select pg_temp.check((select count(*) from public.profiles) = 2, 'profiles создаются при регистрации');

-- ===================== Пользователь A
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.locations (id, user_id, kind, name, latitude, longitude, radius) values
  ('a0000000-0000-0000-0000-000000000001', auth.uid(), 'home', 'Дом',    50.45, 30.52, 150),
  ('a0000000-0000-0000-0000-000000000002', auth.uid(), 'work', 'Работа', 50.44, 30.54, 200);

select pg_temp.expect_error($$
  insert into public.locations (id, user_id, kind, name, latitude, longitude)
  values (gen_random_uuid(), auth.uid(), 'home', 'Второй дом', 50, 30) $$,
  'второй «Дом» запрещён');

select pg_temp.expect_error($$
  insert into public.locations (id, user_id, name, latitude, longitude)
  values (gen_random_uuid(), auth.uid(), 'X', 95, 30) $$,
  'широта вне диапазона');

-- Клиент всегда присылает updated_at (время правки на устройстве)
insert into public.trips (id, user_id, direction, started_at, finished_at, total_cost, status, updated_at) values
  ('a1000000-0000-0000-0000-000000000001', auth.uid(), 'to_work',
   '2026-11-03 07:40+02', '2026-11-03 08:25+02', 4800, 'completed', '2026-11-03 08:26+02');

insert into public.trip_segments (id, user_id, trip_id, position, transport_type, transport_number, cost) values
  ('a2000000-0000-0000-0000-000000000001', auth.uid(), 'a1000000-0000-0000-0000-000000000001', 0, 'minibus', '720', 2000),
  ('a2000000-0000-0000-0000-000000000002', auth.uid(), 'a1000000-0000-0000-0000-000000000001', 1, 'metro', null, 2800);

insert into public.inspections (id, user_id, trip_id, segment_id, outcome, observed_at, location_latitude, location_longitude) values
  (gen_random_uuid(), auth.uid(), 'a1000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001', 'ticket_checked', '2026-11-03 07:55+02', 50.447, 30.53);

select pg_temp.check(
  (select controller_present and ticket_checked from public.inspections limit 1),
  'controller_present/ticket_checked выводятся из outcome');

select pg_temp.expect_error($$
  insert into public.trips (id, user_id, started_at, finished_at, status)
  values (gen_random_uuid(), auth.uid(), '2026-11-03 09:00+02', '2026-11-03 08:00+02', 'completed') $$,
  'finished_at раньше started_at');

select pg_temp.expect_error($$
  insert into public.trips (id, user_id, started_at, status)
  values (gen_random_uuid(), auth.uid(), now(), 'completed') $$,
  'completed без finished_at');

select pg_temp.expect_error($$
  insert into public.trips (id, user_id, started_at, total_cost)
  values (gen_random_uuid(), auth.uid(), now(), -1) $$,
  'отрицательная стоимость');

-- Одна активная поездка
insert into public.trips (id, user_id, started_at, status, tracking_mode, updated_at)
  values ('a1000000-0000-0000-0000-0000000000aa', auth.uid(), '2026-11-03 11:00+02', 'active', 'gps', '2026-11-03 11:00+02');
select pg_temp.expect_error($$
  insert into public.trips (id, user_id, started_at, status)
  values (gen_random_uuid(), auth.uid(), now(), 'active') $$,
  'вторая активная поездка запрещена (защита от дублей при пересечении геозон)');

-- Идемпотентная повторная отправка из очереди (upsert того же UUID)
insert into public.trips (id, user_id, direction, started_at, finished_at, total_cost, status, updated_at)
  values ('a1000000-0000-0000-0000-000000000001', auth.uid(), 'to_work',
          '2026-11-03 07:40+02', '2026-11-03 08:25+02', 4800, 'completed', '2026-11-03 08:30+02')
  on conflict (id) do update set total_cost = excluded.total_cost, updated_at = excluded.updated_at;
select pg_temp.check((select count(*) from public.trips where id = 'a1000000-0000-0000-0000-000000000001') = 1,
  'повторный upsert не создаёт дубль');

-- LWW: новая правка применяется, устаревшая — игнорируется
update public.trips set total_cost = 5000, updated_at = '2026-11-03 12:00+02'
  where id = 'a1000000-0000-0000-0000-000000000001';
update public.trips set total_cost = 1, updated_at = '2026-11-03 10:00+02'
  where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.check((select total_cost from public.trips where id = 'a1000000-0000-0000-0000-000000000001') = 5000,
  'устаревшая запись не перетирает новую (LWW)');

-- Tombstone не «воскрешается» старой правкой
update public.trips set deleted_at = '2026-11-03 13:00+02', updated_at = '2026-11-03 13:00+02'
  where id = 'a1000000-0000-0000-0000-0000000000aa';
update public.trips set deleted_at = null, updated_at = '2026-11-03 12:30+02'
  where id = 'a1000000-0000-0000-0000-0000000000aa';
select pg_temp.check((select deleted_at is not null from public.trips where id = 'a1000000-0000-0000-0000-0000000000aa'),
  'удалённая запись не восстанавливается устаревшей правкой');

-- ===================== Пользователь B
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check((select count(*) from public.trips) = 0, 'B не видит поездки A');
select pg_temp.check((select count(*) from public.locations) = 0, 'B не видит места A');
select pg_temp.check((select count(*) from public.settings) = 1, 'B видит только свои настройки');

update public.trips set total_cost = 0;   -- RLS: затронет 0 строк
delete from public.trip_segments;         -- RLS: затронет 0 строк

select pg_temp.expect_error($$
  insert into public.trips (id, user_id, started_at)
  values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', now()) $$,
  'B не может создать запись от имени A');

-- B создаёт свою поездку и пытается прикрепить сегмент к поездке A
insert into public.trips (id, user_id, started_at) values ('b1000000-0000-0000-0000-000000000001', auth.uid(), now());
select pg_temp.expect_error($$
  insert into public.trip_segments (id, user_id, trip_id, position, transport_type)
  values (gen_random_uuid(), auth.uid(), 'a1000000-0000-0000-0000-000000000001', 0, 'bus') $$,
  'B не может прикрепить сегмент к чужой поездке');

-- Анонимный доступ
reset request.jwt.claim.sub;
set role anon;
select pg_temp.expect_error($$ select count(*) from public.trips $$, 'anon не имеет доступа к таблицам');

-- ===================== Проверка после атак: данные A целы
reset role;
select pg_temp.check((select total_cost from public.trips where id = 'a1000000-0000-0000-0000-000000000001') = 5000,
  'данные A не изменены пользователем B');
select pg_temp.check((select count(*) from public.trip_segments where user_id = '11111111-1111-1111-1111-111111111111') = 2,
  'сегменты A не удалены пользователем B');

-- ===================== Приватность
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.trip_track_points (user_id, trip_id, recorded_at, latitude, longitude)
  values (auth.uid(), 'a1000000-0000-0000-0000-000000000001', '2026-11-03 07:45+02', 50.45, 30.52);
select public.delete_my_location_history();
select pg_temp.check((select count(*) from public.trip_track_points) = 0, 'история треков удалена');
select pg_temp.check((select count(*) from public.inspections where location_latitude is not null) = 0,
  'координаты наблюдений удалены');
select pg_temp.check((select count(*) from public.inspections) = 1, 'сами наблюдения сохранены');

select public.delete_my_account();
reset role;
select pg_temp.check((select count(*) from auth.users where id = '11111111-1111-1111-1111-111111111111') = 0,
  'аккаунт A удалён');
select pg_temp.check((select count(*) from public.trips where user_id = '11111111-1111-1111-1111-111111111111') = 0
                 and (select count(*) from public.trip_segments where user_id = '11111111-1111-1111-1111-111111111111') = 0
                 and (select count(*) from public.locations where user_id = '11111111-1111-1111-1111-111111111111') = 0
                 and (select count(*) from public.settings where user_id = '11111111-1111-1111-1111-111111111111') = 0,
  'все данные A удалены каскадом');
select pg_temp.check((select count(*) from public.trips where user_id = '22222222-2222-2222-2222-222222222222') = 1,
  'данные B не затронуты');

\echo 'ALL SCHEMA TESTS PASSED'
