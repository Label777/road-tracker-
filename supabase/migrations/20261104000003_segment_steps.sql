-- Шаги на этапах «Пешком» (по датчику движения телефона).
-- Оценки по расстоянию и времени не хранятся — сайт считает их сам.
alter table public.trip_segments
  add column if not exists steps integer check (steps >= 0 and steps <= 200000);

comment on column public.trip_segments.steps is 'Шаги по датчику движения; только для transport_type = walk';
