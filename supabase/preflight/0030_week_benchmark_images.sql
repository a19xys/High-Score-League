-- Read-only preflight for 0030_week_benchmark_images.sql.

select to_regclass('public.week_benchmarks') as week_benchmarks_table;

select
  count(*) filter (where column_name = 'image_storage_path') as image_storage_path_columns,
  count(*) filter (where column_name = 'icon_key') as legacy_icon_key_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'week_benchmarks';

select count(*) as benchmark_count
from public.week_benchmarks;

select count(*) as benchmarks_with_legacy_icon_key
from public.week_benchmarks
where icon_key is not null;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'hsl-public-media';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
