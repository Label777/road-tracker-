-- Шаблоны маршрутов (миграция 0002)
\set ON_ERROR_STOP on

create or replace function pg_temp.check(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.expect_error(sql text, label text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL (ожидалась ошибка): %', label;
exception
  when raise_exception then raise;
  when others then raise notice 'ok  %', label;
end $$;

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'c@test');
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

insert into public.routes (id, user_id, name, direction, segments) values
  ('c0000000-0000-0000-0000-000000000001', auth.uid(), 'Дом → работа', 'to_work',
   '[{"transport_type":"minibus","transport_number":"720","cost":2000},{"transport_type":"metro","cost":800}]');

select pg_temp.check((select jsonb_array_length(segments) = 2 from public.routes), 'шаблон хранит этапы');

select pg_temp.expect_error($$
  insert into public.routes (id, user_id, name, segments)
  values (gen_random_uuid(), auth.uid(), 'X', '{"not":"array"}') $$, 'этапы шаблона — только массив');

insert into public.trips (id, user_id, route_id, started_at, finished_at, status, updated_at) values
  ('c1000000-0000-0000-0000-000000000001', auth.uid(), 'c0000000-0000-0000-0000-000000000001',
   '2026-11-03 08:00+02', '2026-11-03 08:40+02', 'completed', '2026-11-03 08:41+02');

reset role;
delete from public.routes where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select route_id is null from public.trips where id = 'c1000000-0000-0000-0000-000000000001'),
  'удаление шаблона не удаляет и не ломает поездки');

\echo 'ALL ROUTE TESTS PASSED'
