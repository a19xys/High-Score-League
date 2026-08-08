alter table public.profiles
  add column avatar_storage_path text;

alter table public.games
  add column header_image_storage_path text,
  add column logo_image_storage_path text;

alter table public.home_poll_options
  add column image_storage_path text;

alter table public.profiles
  add constraint profiles_avatar_storage_path_check
  check (
    avatar_storage_path is null
    or avatar_storage_path ~ (
      '^avatars/' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    )
  );

alter table public.games
  add constraint games_header_image_storage_path_check
  check (
    header_image_storage_path is null
    or header_image_storage_path ~ '^games/headers/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  ),
  add constraint games_logo_image_storage_path_check
  check (
    logo_image_storage_path is null
    or logo_image_storage_path ~ '^games/logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  );

alter table public.home_poll_options
  add constraint home_poll_options_image_storage_path_check
  check (
    image_storage_path is null
    or image_storage_path ~ '^polls/options/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hsl-public-media',
  'hsl-public-media',
  true,
  2097152,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy hsl_public_media_avatar_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

create policy hsl_public_media_avatar_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

create policy hsl_public_media_avatar_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and name ~ (
    '^avatars/' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

create policy hsl_public_media_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and (
    name ~ '^games/(headers|logos)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    or name ~ '^polls/options/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

create policy hsl_public_media_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and (
    name ~ '^games/(headers|logos)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    or name ~ '^polls/options/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);

create policy hsl_public_media_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and (
    name ~ '^games/(headers|logos)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    or name ~ '^polls/options/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  )
);
