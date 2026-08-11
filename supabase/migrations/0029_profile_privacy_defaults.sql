-- POST-PRESENCE-STABILIZATION: new profiles disclose Playtime and Presence unless the user opts to hide them.
-- Historical rows are intentionally untouched because false does not reveal whether it was chosen or inherited.

alter table public.profiles
  alter column play_time_public set default true,
  alter column presence_public set default true;

comment on column public.profiles.play_time_public is
  'Public by default for new profiles. Existing values are preserved; the profile editor presents this as an opt-out.';

comment on column public.profiles.presence_public is
  'Public by default for new profiles. Existing values are preserved; false keeps ephemeral Presence private.';
