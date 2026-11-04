-- Шаги этапа (миграция 0003)
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

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'd@test');
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

insert into public.trips (id, user_id, direction, started_at, finished_at, status, time_zone)
values ('d0000000-0000-0000-0000-000000000001', auth.uid(), 'to_work', now() - interval '1 hour', now() - interval '20 minutes', 'completed', 'Europe/Kyiv');
insert into public.trip_segments (id, user_id, trip_id, position, transport_type, distance_meters, steps)
values ('d0000000-0000-0000-0000-000000000002', auth.uid(), 'd0000000-0000-0000-0000-000000000001', 0, 'walk', 640, 870);

select pg_temp.check((select steps = 870 from public.trip_segments where id = 'd0000000-0000-0000-0000-000000000002'), 'этап хранит шаги');
insert into public.trip_segments (id, user_id, trip_id, position, transport_type)
values ('d0000000-0000-0000-0000-000000000003', auth.uid(), 'd0000000-0000-0000-0000-000000000001', 1, 'metro');
select pg_temp.check((select steps is null from public.trip_segments where id = 'd0000000-0000-0000-0000-000000000003'), 'шаги необязательны');
select pg_temp.expect_error($$update public.trip_segments set steps = -1 where id = 'd0000000-0000-0000-0000-000000000002'$$, 'отрицательные шаги запрещены');

reset role;
