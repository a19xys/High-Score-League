revoke execute
on function public.guard_submission_competition_integrity()
from public, anon, authenticated;

grant execute
on function public.guard_submission_competition_integrity()
to service_role;
