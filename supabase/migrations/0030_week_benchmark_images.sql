-- Managed benchmark images. Keep icon_key temporarily for rolling-deploy compatibility.

alter table public.week_benchmarks
  add column image_storage_path text;

alter table public.week_benchmarks
  add constraint week_benchmarks_image_storage_path_check
  check (
    image_storage_path is null
    or image_storage_path ~ '^benchmarks/icons/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
  );

comment on column public.week_benchmarks.image_storage_path is
  'Managed hsl-public-media object at benchmarks/icons/<UUID>.webp. Null uses the neutral REF fallback.';

comment on column public.week_benchmarks.icon_key is
  'Legacy benchmark icon key retained temporarily for compatibility with older web deployments.';

create policy hsl_public_media_benchmark_icon_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and name ~ '^benchmarks/icons/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
);

create policy hsl_public_media_benchmark_icon_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and name ~ '^benchmarks/icons/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
);

create policy hsl_public_media_benchmark_icon_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hsl-public-media'
  and public.is_admin()
  and name ~ '^benchmarks/icons/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
);
