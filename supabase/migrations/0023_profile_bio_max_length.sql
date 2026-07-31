do $$
declare
  incompatible_bios bigint;
begin
  select count(*)
  into incompatible_bios
  from public.profiles
  where bio is not null
    and char_length(bio) > 150;

  if incompatible_bios > 0 then
    raise exception
      'Cannot add profiles_bio_max_length: % profile bios exceed 150 characters. Review them before applying migration 0023.',
      incompatible_bios;
  end if;
end
$$;

alter table public.profiles
add constraint profiles_bio_max_length
check (bio is null or char_length(bio) <= 150);
