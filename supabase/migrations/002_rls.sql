-- =============================================================================
-- ReTrack  —  002_rls.sql
-- Row Level Security.
--
-- Design rule: the browser may READ through RLS, but every write that affects
-- progress, timing, proof or approval goes through a SECURITY DEFINER function
-- in 003_functions.sql. There are deliberately NO insert/update policies on
-- activity_sessions, activity_proofs, activity_submissions, daily_progress or
-- daily_approvals — so nothing in devtools can fabricate progress.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so profile policies never recurse)
-- -----------------------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_kruti()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'KRUTI' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_dharmik()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'DHARMIK' from public.profiles where id = auth.uid()), false);
$$;

-- The active plan's timezone decides what "today" means. The device clock never does.
create or replace function public.plan_timezone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select timezone from public.daily_plans where is_active order by created_at limit 1),
    'Asia/Kolkata'
  );
$$;

create or replace function public.today_local()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone public.plan_timezone())::date;
$$;

-- -----------------------------------------------------------------------------
-- Lock the door on anonymous traffic
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.daily_plans              enable row level security;
alter table public.activities               enable row level security;
alter table public.activity_sessions        enable row level security;
alter table public.activity_session_events  enable row level security;
alter table public.activity_proofs          enable row level security;
alter table public.activity_submissions     enable row level security;
alter table public.daily_progress           enable row level security;
alter table public.daily_approvals          enable row level security;
alter table public.motivational_messages    enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.milestones               enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

-- A user may edit their own display name / emoji, but never their own role.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- -----------------------------------------------------------------------------
-- daily_plans — Kruti configures the journey
-- -----------------------------------------------------------------------------
drop policy if exists daily_plans_select on public.daily_plans;
create policy daily_plans_select on public.daily_plans
  for select to authenticated using (true);

drop policy if exists daily_plans_write on public.daily_plans;
create policy daily_plans_write on public.daily_plans
  for insert to authenticated with check (public.is_kruti());

drop policy if exists daily_plans_update on public.daily_plans;
create policy daily_plans_update on public.daily_plans
  for update to authenticated using (public.is_kruti()) with check (public.is_kruti());

-- -----------------------------------------------------------------------------
-- activities — Kruti configures, Dharmik reads
-- -----------------------------------------------------------------------------
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated using (true);

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated with check (public.is_kruti());

drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update to authenticated using (public.is_kruti()) with check (public.is_kruti());

-- -----------------------------------------------------------------------------
-- activity_sessions — read-only from the browser
-- -----------------------------------------------------------------------------
drop policy if exists activity_sessions_select on public.activity_sessions;
create policy activity_sessions_select on public.activity_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

drop policy if exists session_events_select on public.activity_session_events;
create policy session_events_select on public.activity_session_events
  for select to authenticated
  using (
    public.is_kruti()
    or exists (
      select 1 from public.activity_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- activity_proofs — read-only from the browser
-- -----------------------------------------------------------------------------
drop policy if exists activity_proofs_select on public.activity_proofs;
create policy activity_proofs_select on public.activity_proofs
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

-- -----------------------------------------------------------------------------
-- activity_submissions — read-only from the browser
-- -----------------------------------------------------------------------------
drop policy if exists activity_submissions_select on public.activity_submissions;
create policy activity_submissions_select on public.activity_submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

-- -----------------------------------------------------------------------------
-- daily_progress / daily_approvals — read-only from the browser
-- -----------------------------------------------------------------------------
drop policy if exists daily_progress_select on public.daily_progress;
create policy daily_progress_select on public.daily_progress
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

drop policy if exists daily_approvals_select on public.daily_approvals;
create policy daily_approvals_select on public.daily_approvals
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

-- -----------------------------------------------------------------------------
-- motivational_messages — Kruti writes, both read
-- -----------------------------------------------------------------------------
drop policy if exists messages_select on public.motivational_messages;
create policy messages_select on public.motivational_messages
  for select to authenticated using (true);

drop policy if exists messages_insert on public.motivational_messages;
create policy messages_insert on public.motivational_messages
  for insert to authenticated with check (public.is_kruti());

drop policy if exists messages_update on public.motivational_messages;
create policy messages_update on public.motivational_messages
  for update to authenticated using (public.is_kruti()) with check (public.is_kruti());

drop policy if exists messages_delete on public.motivational_messages;
create policy messages_delete on public.motivational_messages
  for delete to authenticated using (public.is_kruti());

-- -----------------------------------------------------------------------------
-- notification_preferences — each user owns their own row
-- -----------------------------------------------------------------------------
drop policy if exists notif_select on public.notification_preferences;
create policy notif_select on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid() or public.is_kruti());

drop policy if exists notif_insert on public.notification_preferences;
create policy notif_insert on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notif_update on public.notification_preferences;
create policy notif_update on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- milestones
-- -----------------------------------------------------------------------------
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones
  for select to authenticated using (true);

drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones
  for all to authenticated
  using (public.is_kruti()) with check (public.is_kruti());
