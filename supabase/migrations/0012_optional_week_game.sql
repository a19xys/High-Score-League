alter table public.weeks
  alter column game_id drop not null;

update public.weeks
set game_id = null
where game_id in (
  select id
  from public.games
  where lower(trim(title)) = 'juego secreto'
);

delete from public.games
where lower(trim(title)) = 'juego secreto'
  and not exists (
    select 1
    from public.weeks
    where weeks.game_id = games.id
  );
