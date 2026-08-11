-- Durable submissions: player-scoped idempotency and detected-at acceptance.

drop index if exists public.submissions_duplicate_key_unique_idx;

create unique index submissions_player_duplicate_key_unique_idx
on public.submissions (player_id, duplicate_key)
where duplicate_key is not null;

drop policy if exists submissions_insert_own on public.submissions;

create policy submissions_insert_own
on public.submissions
for insert
to authenticated
with check (
  player_id = auth.uid()
  and is_valid = true
  and detected_at is not null
  and exists (
    select 1
    from public.weeks w
    join public.season_memberships sm
      on sm.season_id = w.season_id
     and sm.player_id = auth.uid()
     and sm.status = 'active'
    where w.id = week_id
      and w.public_start_at is not null
      and w.final_deadline_at is not null
      and detected_at >= w.public_start_at
      and detected_at < w.final_deadline_at
      and (
        w.public_freeze_at is null
        or detected_at < w.public_freeze_at
        or is_hidden = true
      )
  )
);

comment on index public.submissions_player_duplicate_key_unique_idx is
  'Idempotency keys are unique per authenticated player, not globally.';

comment on column public.submissions.detected_at is
  'Canonical competitive timestamp. Acceptance uses the week window at capture time.';

comment on column public.submissions.submitted_at is
  'Server receipt timestamp. Audit metadata that does not decide competitive acceptance.';
