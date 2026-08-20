-- Read-only preflight for 0031_launcher_packs.sql. This file never mutates schema or data.

select
  to_regclass('public.weeks') as weeks_table,
  to_regclass('public.launcher_packs') as launcher_packs_table,
  to_regclass('public.week_benchmarks') as week_benchmarks_table;

select table_schema, table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'weeks'
  and column_name = 'id';

select
  to_regprocedure('public.is_admin()') as is_admin_function,
  to_regprocedure('public.set_updated_at()') as set_updated_at_function;

select count(*) as improvised_launcher_pack_id_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'weeks'
  and column_name = 'launcher_pack_id';

select column_name, data_type, is_generated, generation_expression
from information_schema.columns
where table_schema = 'public'
  and table_name = 'launcher_packs'
order by ordinal_position;

select count(*) as prior_week_benchmark_image_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'week_benchmarks'
  and column_name = 'image_storage_path';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'launcher_packs'
order by policyname;
