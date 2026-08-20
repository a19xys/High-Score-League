-- Restore safe own-profile bootstrap visibility without weakening anonymization.
-- Apply only after 0027_profile_anonymization.sql.

do $profile_bootstrap_dependencies$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.profiles') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.profiles');
  end if;

  if to_regprocedure('public.has_active_profile()') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.has_active_profile()'
    );
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'anonymized_at'
  ) then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.profiles.anonymized_at'
    );
  end if;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'profiles'
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity = false
  ) then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.profiles row level security'
    );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_insert_own'
  ) then
    missing_dependencies := array_append(
      missing_dependencies,
      'profiles_insert_own policy'
    );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    missing_dependencies := array_append(
      missing_dependencies,
      'profiles_update_own policy'
    );
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'profile_bootstrap_rls_missing_dependencies',
      detail = array_to_string(missing_dependencies, ', ');
  end if;
end
$profile_bootstrap_dependencies$;

drop policy if exists profiles_select_authenticated on public.profiles;

-- A newly authenticated user has no active profile yet. INSERT ... RETURNING
-- still needs SELECT visibility for the row being bootstrapped. Until
-- has_active_profile() becomes true, expose only that user's own
-- non-anonymized row; tombstones and every other profile remain hidden.
create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (
  public.has_active_profile()
  or (
    id = auth.uid()
    and auth.uid() is not null
    and anonymized_at is null
  )
);

comment on policy profiles_select_authenticated on public.profiles is
  'Active profiles use the normal viewer barrier; pre-profile users may read only their own non-anonymized bootstrap row for INSERT RETURNING.';
