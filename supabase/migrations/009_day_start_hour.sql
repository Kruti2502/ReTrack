-- =============================================================================
-- 009 — The day ends at 6 AM, not at midnight
--
-- His office shift sometimes ends around 12:30 AM, and the last two treadmill
-- sessions and the staircase happen at 2–3 AM. The calendar had already moved
-- on by then, so that work landed on the next day: the night's effort was
-- credited to a day that had barely started, and the day he had actually been
-- training for closed short and broke the streak.
--
-- A day now runs from 6 AM to 6 AM. A session at 2 AM belongs to the day that
-- began the morning before — which is how he experiences it — so there is
-- nothing to backdate and no way to type in a date the server did not measure.
-- Every record is still stamped live by the server; only the label changes.
--
-- The hour lives on the plan next to the timezone, so Kruti can move it without
-- another migration.
--
-- Note this is not retroactive. Days already written keep the label they were
-- given, so a 1 AM session from last week still sits on the following day.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- When a day begins
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  add column if not exists day_start_hour smallint not null default 6;

comment on column public.daily_plans.day_start_hour is
  'Local hour a day begins, 0–23. 6 means a day runs 6 AM → 6 AM, so late-night
   training counts for the day it followed. 0 restores plain calendar days.';

alter table public.daily_plans drop constraint if exists daily_plans_day_start_hour_valid;
alter table public.daily_plans add constraint daily_plans_day_start_hour_valid
  check (day_start_hour between 0 and 23);

-- Read the same way as the timezone, and falling back to the same default the
-- column carries, so a missing plan behaves like the plan Kruti would create.
create or replace function public.plan_day_start_hour()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select day_start_hour from public.daily_plans where is_active order by created_at limit 1),
    6::smallint
  );
$$;

-- -----------------------------------------------------------------------------
-- Which day an instant belongs to
--
-- The rule itself, stated once as a function of a timestamp: read the clock in
-- the plan's timezone, wind it back by the start hour, take the date. At hour 6
-- an instant of 2 AM winds back to 8 PM the previous evening, which is the day
-- it gets credited to.
--
-- It takes the instant as an argument rather than reading the clock so that the
-- rule can be asked about any moment — and so it can be checked directly,
-- rather than only by waiting until 2 AM.
-- -----------------------------------------------------------------------------
create or replace function public.date_local(p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (
    (p_at at time zone public.plan_timezone())
      - make_interval(hours => public.plan_day_start_hour()::int)
  )::date;
$$;

-- -----------------------------------------------------------------------------
-- today_local — the one place that decides what day it is
--
-- Every write path derives its local_date from here: the timer, the proof, the
-- submission, the recalc and the streaks. Applying the rule to the current
-- instant moves all of them together, so this is the only place the new boundary
-- had to be taught. Everything below it is unchanged, and `get_day` is reopened
-- further down only to report the boundary, never to decide it.
-- -----------------------------------------------------------------------------
create or replace function public.today_local()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select public.date_local(now());
$$;

-- Nothing stores "this day ended at 6 AM". Like rest days, the boundary is a
-- rule rather than a fact about a day: a session's local_date is decided once,
-- when the timer opens, so a session that runs across 6 AM stays whole and on
-- the day it started.

-- -----------------------------------------------------------------------------
-- get_day — says so when the wall clock has passed midnight
--
-- At 2 AM his phone reads the 18th while the app is still filling in the 17th.
-- Left unexplained that looks like a bug, so the day carries the fact with it
-- and the header can say which day is still open.
-- -----------------------------------------------------------------------------
create or replace function public.get_day(p_local_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date  date := coalesce(p_local_date, public.today_local());
  v_owner uuid;
  v_plan  public.daily_plans;
  v_prog  public.daily_progress;
  v_acts  jsonb;
  v_app   jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where role = 'DHARMIK';
  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  select * into v_prog from public.daily_progress
    where user_id = v_owner and local_date = v_date;

  select coalesce(jsonb_agg(x order by x_sort, x_name), '[]'::jsonb)
  into v_acts
  from (
    select
      a.sort_order as x_sort,
      a.name as x_name,
      jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'icon', a.icon,
        'target_seconds', a.target_seconds,
        'is_required', a.is_required,
        'requires_photo', a.requires_photo,
        'requires_location', a.requires_location,
        'reminder_time', a.reminder_time,
        'sort_order', a.sort_order,
        'is_archived', a.is_archived,
        'completed_seconds', coalesce((
          select sum(s.active_seconds) from public.activity_sessions s
          where s.activity_id = a.id and s.user_id = v_owner
            and s.local_date = v_date and s.status = 'finished'
        ), 0),
        'live_session', (
          select to_jsonb(s) from public.activity_sessions s
          where s.activity_id = a.id and s.user_id = v_owner
            and s.local_date = v_date and s.status in ('running', 'paused')
          limit 1
        ),
        'sessions', coalesce((
          select jsonb_agg(to_jsonb(s) order by s.started_at)
          from public.activity_sessions s
          where s.activity_id = a.id and s.user_id = v_owner
            and s.local_date = v_date and s.status <> 'discarded'
        ), '[]'::jsonb),
        'proofs', coalesce((
          select jsonb_agg(to_jsonb(p) order by p.uploaded_at)
          from public.activity_proofs p
          where p.activity_id = a.id and p.user_id = v_owner and p.local_date = v_date
        ), '[]'::jsonb),
        'submission', (
          select to_jsonb(sub) from public.activity_submissions sub
          where sub.activity_id = a.id and sub.local_date = v_date
        )
      ) as x
    from public.activities a
    where a.plan_id = v_plan.id
      and (
        not a.is_archived
        or exists (
          select 1 from public.activity_sessions s
          where s.activity_id = a.id and s.local_date = v_date and s.status = 'finished'
        )
      )
  ) t;

  select to_jsonb(da) into v_app
  from public.daily_approvals da
  where da.user_id = v_owner and da.local_date = v_date;

  return jsonb_build_object(
    'date', v_date,
    'server_time', now(),
    'day_number', case when v_plan.start_date is null then 1
                       else greatest(1, (v_date - v_plan.start_date) + 1) end,
    'is_rest_day', public.is_rest_day(v_date),
    -- True only while this day is the open one and the calendar has already
    -- turned: the small hours, when the date on screen trails the date on the
    -- phone. Any past day he scrolls back to is simply false.
    'past_midnight', v_date = public.today_local()
                     and (now() at time zone public.plan_timezone())::date <> v_date,
    'day_start_hour', public.plan_day_start_hour(),
    'plan', to_jsonb(v_plan),
    'progress', coalesce(to_jsonb(v_prog), jsonb_build_object(
      'percent', 0, 'required_total', 0, 'required_completed', 0,
      'required_approved', 0, 'optional_completed', 0,
      'total_active_seconds', 0, 'all_required_approved', false,
      'is_day_approved', false
    )),
    'day_approval', v_app,
    'activities', v_acts
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants — `create or replace` keeps them, but the new helpers need their own.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.plan_day_start_hour()',
    'public.date_local(timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
