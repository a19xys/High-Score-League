-- High Score League - Require active season membership for submission inserts

drop policy if exists submissions_insert_own on public.submissions;

create policy submissions_insert_own
on public.submissions
for insert
to authenticated
with check (
  player_id = auth.uid()
  and is_valid = true

  -- The player must be an active member of the season that owns the week.
  and exists (
    select 1
    from public.weeks w
    join public.season_memberships sm
      on sm.season_id = w.season_id
     and sm.player_id = auth.uid()
     and sm.status = 'active'
    where w.id = week_id
  )

  -- Date-based acceptance window. This mirrors the current product rule:
  -- submissions are accepted from opening until closing.
  and exists (
    select 1
    from public.weeks w
    where w.id = week_id
      and w.public_start_at is not null
      and w.final_deadline_at is not null
      and now() >= w.public_start_at
      and now() < w.final_deadline_at
      and w.status not in ('closed', 'published')
  )

  -- During final stretch, submissions must be hidden.
  and exists (
    select 1
    from public.weeks w
    where w.id = week_id
      and (
        w.public_freeze_at is null
        or now() < w.public_freeze_at
        or is_hidden = true
      )
  )
);