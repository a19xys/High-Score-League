alter table public.games
add column if not exists genre text,
add column if not exists control_type text,
add column if not exists difficulty text;

alter table public.games
drop constraint if exists games_genre_not_blank,
add constraint games_genre_not_blank check (
  genre is null or length(trim(genre)) > 0
);

alter table public.games
drop constraint if exists games_control_type_not_blank,
add constraint games_control_type_not_blank check (
  control_type is null or length(trim(control_type)) > 0
);

alter table public.games
drop constraint if exists games_difficulty_not_blank,
add constraint games_difficulty_not_blank check (
  difficulty is null or length(trim(difficulty)) > 0
);
