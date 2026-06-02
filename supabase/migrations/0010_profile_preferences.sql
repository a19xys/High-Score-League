alter table public.profiles
add column if not exists bio text,
add column if not exists track_play_time boolean not null default true;

alter table public.profiles
drop constraint if exists profiles_bio_not_blank;

alter table public.profiles
add constraint profiles_bio_not_blank
check (bio is null or length(trim(bio)) > 0);
