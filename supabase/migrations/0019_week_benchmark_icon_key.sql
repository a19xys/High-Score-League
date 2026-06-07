alter table public.week_benchmarks
  add column if not exists icon_key text not null default 'speedometer_1';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'week_benchmarks_icon_key_check'
      and conrelid = 'public.week_benchmarks'::regclass
  ) then
    alter table public.week_benchmarks
      add constraint week_benchmarks_icon_key_check
      check (icon_key in ('speedometer_1', 'speedometer_2', 'speedometer_3'));
  end if;
end $$;
