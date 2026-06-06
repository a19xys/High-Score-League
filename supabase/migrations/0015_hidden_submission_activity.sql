-- Expose safe metadata for hidden final-stretch submissions without revealing scores.

create or replace function public.get_week_hidden_submission_activity(p_week_id uuid)
returns table (
  id uuid,
  week_id uuid,
  player_id uuid,
  submitted_at timestamptz,
  is_hidden boolean,
  is_valid boolean,
  source text,
  detected_at timestamptz,
  profile_id uuid,
  profile_username text,
  profile_initials text,
  profile_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.week_id,
    s.player_id,
    s.submitted_at,
    s.is_hidden,
    s.is_valid,
    s.source,
    s.detected_at,
    p.id as profile_id,
    p.username as profile_username,
    p.initials as profile_initials,
    p.avatar_url as profile_avatar_url
  from public.submissions s
  join public.weeks w
    on w.id = s.week_id
  join public.profiles p
    on p.id = s.player_id
  where auth.uid() is not null
    and s.week_id = p_week_id
    and s.is_hidden = true
    and s.is_valid = true
    and (
      w.status = 'frozen'
      or (
        w.status not in ('draft', 'closed', 'published')
        and w.public_freeze_at is not null
        and now() >= w.public_freeze_at
        and (
          w.final_deadline_at is null
          or now() < w.final_deadline_at
        )
      )
    )
  order by s.submitted_at desc, s.id desc;
$$;

grant execute on function public.get_week_hidden_submission_activity(uuid) to authenticated;
