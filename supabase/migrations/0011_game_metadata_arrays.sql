alter table public.games
  add column if not exists developers text[] not null default '{}',
  add column if not exists publishers text[] not null default '{}',
  add column if not exists perspectives text[] not null default '{}',
  add column if not exists themes text[] not null default '{}',
  add column if not exists genres text[] not null default '{}';

update public.games
set developers = array[trim(developer)]
where coalesce(array_length(developers, 1), 0) = 0
  and developer is not null
  and btrim(developer) <> '';

update public.games
set publishers = array[trim(publisher)]
where coalesce(array_length(publishers, 1), 0) = 0
  and publisher is not null
  and btrim(publisher) <> '';

update public.games
set genres = array[trim(genre)]
where coalesce(array_length(genres, 1), 0) = 0
  and genre is not null
  and btrim(genre) <> '';

create or replace function public.text_array_has_no_blank_duplicates(input_values text[])
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
    from unnest(coalesce(input_values, '{}')) as item(value)
    where btrim(item.value) = ''
  )
  and (
    select count(*)
    from unnest(coalesce(input_values, '{}')) as item(value)
  ) = (
    select count(distinct item.value)
    from unnest(coalesce(input_values, '{}')) as item(value)
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'games_developers_clean_check'
  ) then
    alter table public.games
      add constraint games_developers_clean_check
      check (public.text_array_has_no_blank_duplicates(developers));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'games_publishers_clean_check'
  ) then
    alter table public.games
      add constraint games_publishers_clean_check
      check (public.text_array_has_no_blank_duplicates(publishers));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'games_perspectives_clean_check'
  ) then
    alter table public.games
      add constraint games_perspectives_clean_check
      check (public.text_array_has_no_blank_duplicates(perspectives));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'games_themes_clean_check'
  ) then
    alter table public.games
      add constraint games_themes_clean_check
      check (public.text_array_has_no_blank_duplicates(themes));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'games_genres_clean_check'
  ) then
    alter table public.games
      add constraint games_genres_clean_check
      check (public.text_array_has_no_blank_duplicates(genres));
  end if;
end $$;
