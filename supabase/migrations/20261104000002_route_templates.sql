-- Шаблоны маршрутов: направление и типовые этапы (транспорт, номер, стоимость).
-- Этапы шаблона хранятся JSON-массивом: шаблон редактируется целиком, отдельные
-- строки не нужны, а запросы аналитики идут по trip_segments, а не по шаблонам.

alter table public.routes
  add column direction trip_direction not null default 'other',
  add column segments  jsonb not null default '[]'::jsonb,
  add constraint routes_segments_is_array check (jsonb_typeof(segments) = 'array'),
  add constraint routes_segments_limit check (jsonb_array_length(segments) <= 12);

-- Удаление шаблона не должно ломать уже записанные поездки
alter table public.trips drop constraint trips_route_id_user_id_fkey;
alter table public.trips
  add constraint trips_route_id_user_id_fkey
  foreign key (route_id, user_id) references public.routes (id, user_id) on delete set null (route_id);
