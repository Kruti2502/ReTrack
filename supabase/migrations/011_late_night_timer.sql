-- =============================================================================
-- 011 — A timer cannot outlive its day
--
-- 009 moved the day boundary to 6 AM so the 2 AM treadmill would count for the
-- day it followed. It moved every write path together, but it left one thing
-- behind: a session that is still running or paused when its day closes.
--
-- `get_day` only shows a live session whose local_date is the open day, while
-- `start_activity_session` reused a live session whoever it belonged to. So a
-- timer left open on a closed day became a ghost: the card showed "Start
-- activity", the tap quietly resumed the old row, the clock on screen stayed at
-- 0:00 because the open day still had no session of its own — and the unique
-- index that allows only one live session per activity made it impossible to
-- ever open a fresh one. Since he starts each activity once a day, one single
-- forgotten Finish killed that activity for every day after it.
--
-- The rule this file adds, stated once: at 6 AM the previous day's timer stops.
-- It is finished at the boundary, credited to the day it measured, and the new
-- day opens clean — every activity at 0:00 with a Start button that works.
-- Nothing counts until he taps it.
--
-- Three parts:
--   1. close_stale_sessions — the rule itself, as a function of a user.
--   2. A scheduled sweep, so 6 AM happens on its own rather than waiting for
--      him to open the app.
--   3. start_activity_session stops reviving closed days, and sweeps first, so
--      the fix holds even if the scheduler is unavailable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- When a day ends — the same rule as date_local, read from the other side
--
-- Day 18 with a 6 AM start runs from 18th 06:00 to 19th 06:00 local. Stated as
-- a function of the date so a session is always closed at its own day's end,
-- whatever time the sweep or the app gets around to noticing.
-- -----------------------------------------------------------------------------
create or replace function public.day_ends_at(p_date date)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select ((p_date + 1)::timestamp + make_interval(hours => public.plan_day_start_hour()::int))
           at time zone public.plan_timezone();
$$;

comment on function public.day_ends_at(date) is
  'The instant a local_date stops being the open day. date_local(day_ends_at(d))
   is always the day after d.';

-- -----------------------------------------------------------------------------
-- close_stale_sessions — stop the previous day's timer
--
-- A session left running is credited only up to the moment its day ended, never
-- up to now: the day closed, so the timer closed with it, and a night of sleep
-- never becomes eight recorded hours. A paused one gains nothing — it was
-- already stopped. Either way the row lands on `finished` with `ended_at` at the
-- boundary, and the day it belonged to is recalculated so its percentage is
-- final.
--
-- Nothing is carried into the new day. The clock resets to 0:00 and waits.
--
-- Internal only, like pause_running_sessions: it takes a user id, so it is
-- never handed to the browser.
-- -----------------------------------------------------------------------------
create or replace function public.close_stale_sessions(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_today date := public.today_local();
  v_end   timestamptz;
  v_add   int;
  v_count int := 0;
begin
  for r in
    select * from public.activity_sessions
    where user_id = p_user_id
      and status in ('running', 'paused')
      and local_date <> v_today
  loop
    v_end := least(now(), public.day_ends_at(r.local_date));

    -- clamp_seconds floors at 0, so a session somehow resumed after its own
    -- day had already ended simply gains nothing.
    v_add := case
               when r.status = 'running' and r.last_resumed_at is not null
                 then public.clamp_seconds(extract(epoch from (v_end - r.last_resumed_at)))
               else 0
             end;

    update public.activity_sessions
      set active_seconds  = public.clamp_seconds(active_seconds + v_add),
          status          = 'finished',
          ended_at        = v_end,
          last_resumed_at = null,
          paused_at       = null
      where id = r.id;

    insert into public.activity_session_events (session_id, event, seconds_at_event, at)
    values (r.id, 'finish', public.clamp_seconds(r.active_seconds + v_add), v_end);

    perform public.recalc_daily_progress(p_user_id, r.local_date);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Everyone at once — this is what the scheduler calls, and what the repair at
-- the bottom of this file runs to clear the ghosts already in the database.
create or replace function public.close_all_stale_sessions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  u       uuid;
  v_total int := 0;
begin
  for u in
    select distinct user_id from public.activity_sessions
    where status in ('running', 'paused') and local_date <> public.today_local()
  loop
    v_total := v_total + public.close_stale_sessions(u);
  end loop;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- start_activity_session — unchanged except for the two lines that matter
--
-- Same body as 007: the untimed refusal, the location gate, the approval and
-- review guards all stay exactly as they were. What is new is the sweep at the
-- top and `local_date = v_today` on the reuse lookup.
-- -----------------------------------------------------------------------------
create or replace function public.start_activity_session(
  p_activity_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null
)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_local();
  v_act     public.activities;
  v_sub     public.activity_submissions;
  v_session public.activity_sessions;
  v_has_loc boolean;
begin
  perform public.assert_dharmik();

  -- The same 6 AM rule, applied on the way in. The scheduled sweep normally
  -- got here first; this is what makes the fix hold on a project where pg_cron
  -- is unavailable, or in the minutes between the boundary and the next sweep.
  perform public.close_stale_sessions(v_uid);

  select * into v_act from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;
  if v_act.is_archived then
    raise exception 'This activity is no longer part of the plan';
  end if;
  if v_act.target_seconds is null then
    raise exception 'This activity is not timed — just add the photo';
  end if;

  -- The gate. Nothing below runs for a location-required activity until a
  -- usable point has arrived with the request.
  if v_act.requires_location then
    perform public.assert_valid_point(p_lat, p_lng);
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = p_activity_id and local_date = v_today;
  if found and v_sub.status = 'approved' then
    raise exception 'This activity is already approved for today ❤️';
  end if;
  if found and v_sub.status = 'submitted' then
    raise exception 'This activity is waiting for Kruti''s review';
  end if;

  -- Reuse a live session rather than opening a second one for the same
  -- activity — but only today's. A live row on any other date has just been
  -- finished above, so this finds nothing and a fresh session opens.
  select * into v_session from public.activity_sessions
    where activity_id = p_activity_id
      and user_id = v_uid
      and local_date = v_today
      and status in ('running', 'paused');
  if found then
    -- A session started before this rule existed carries no point; the caller
    -- just supplied one, so record it before letting the clock move again.
    if v_act.requires_location and v_session.location_captured_at is null then
      update public.activity_sessions
        set location_lat = p_lat,
            location_lng = p_lng,
            location_accuracy = p_accuracy,
            location_captured_at = now()
        where id = v_session.id
        returning * into v_session;
    end if;
    return public.resume_activity_session(v_session.id);
  end if;

  perform public.pause_running_sessions(v_uid);

  v_has_loc := p_lat is not null and p_lng is not null;

  insert into public.activity_sessions (
    activity_id, user_id, local_date, status, started_at, last_resumed_at,
    location_lat, location_lng, location_accuracy, location_captured_at
  )
  values (
    p_activity_id, v_uid, v_today, 'running', now(), now(),
    case when v_has_loc then p_lat end,
    case when v_has_loc then p_lng end,
    case when v_has_loc then p_accuracy end,
    case when v_has_loc then now() end
  )
  returning * into v_session;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_session.id, 'start', 0);

  perform public.recalc_daily_progress(v_uid, v_today);
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- resume_activity_session — a safety net, not a new rule
--
-- Start never reaches this with a closed day's session any more, and the app
-- only ever holds the live session `get_day` handed it, which is always the open
-- day. This is for the third case: a phone left on the activity screen through
-- 6 AM, pressing Resume on a session id that has since gone stale. Retire it and
-- say so, rather than moving a closed day's clock.
-- -----------------------------------------------------------------------------
create or replace function public.resume_activity_session(p_session_id uuid)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.activity_sessions;
begin
  perform public.assert_dharmik();

  select * into v_s from public.activity_sessions
    where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'Session not found';
  end if;
  if v_s.status = 'finished' or v_s.status = 'discarded' then
    raise exception 'This session is already closed';
  end if;
  if v_s.status = 'running' then
    return v_s;
  end if;

  if v_s.local_date <> public.today_local() then
    perform public.close_stale_sessions(v_s.user_id);
    raise exception 'That timer belonged to an earlier day — tap Start to begin a new one ❤️';
  end if;

  perform public.pause_running_sessions(auth.uid());

  update public.activity_sessions
    set status = 'running', last_resumed_at = now(), paused_at = null
    where id = p_session_id
    returning * into v_s;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_s.id, 'resume', v_s.active_seconds);

  return v_s;
end;
$$;

-- -----------------------------------------------------------------------------
-- The 6 AM sweep
--
-- Scheduled every 15 minutes rather than once at 6 AM, on purpose. pg_cron
-- counts in UTC while the boundary is Kruti's to move — she can change the hour
-- or the timezone in Manage Plan — and a fixed UTC time would quietly point at
-- the wrong moment the day she did. A frequent sweep asks the database what the
-- open day is and follows it, so the schedule never has to be edited again.
--
-- Only the *noticing* is late, never the record: close_stale_sessions stamps
-- every session at `day_ends_at`, so a timer left running is always finished at
-- exactly 6 AM and credited with exactly the time up to it, no matter which
-- sweep gets there. Between the boundary and the next sweep the numbers are
-- stale on screen by at most 15 minutes, and a tap on Start corrects them
-- immediately.
-- -----------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
exception
  when others then
    raise notice 'Could not enable pg_cron (%) — turn it on under Database → Extensions and run this file again. Until then the sweep inside start_activity_session still closes the previous day''s timer on the next tap.', sqlerrm;
end;
$$;

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed — skipping the scheduled sweep.';
    return;
  end if;

  -- Idempotent: running this file twice must not leave two jobs behind.
  perform cron.unschedule(jobid) from cron.job
    where jobname = 'retrack-close-stale-sessions';

  perform cron.schedule(
    'retrack-close-stale-sessions',
    '*/15 * * * *',
    $job$ select public.close_all_stale_sessions(); $job$
  );

  raise notice 'Scheduled retrack-close-stale-sessions every 15 minutes.';
end;
$$;

-- -----------------------------------------------------------------------------
-- Repair — retire the ghosts that already exist
--
-- Anything currently live on a closed day is the reason an activity stopped
-- accepting time. Closing it now hands those minutes to the day they were
-- measured on and frees the activity for tonight.
-- -----------------------------------------------------------------------------
do $$
declare
  n int;
begin
  n := public.close_all_stale_sessions();
  raise notice 'Closed % session(s) left open on a day that has ended.', n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants — `create or replace` keeps the existing ones. day_ends_at is readable
-- by the app; the two sweeps are not, because they name or cross users. The
-- scheduler runs as the database owner and does not need a grant.
-- -----------------------------------------------------------------------------
revoke all on function public.day_ends_at(date) from public, anon;
grant execute on function public.day_ends_at(date) to authenticated;

revoke all on function public.close_stale_sessions(uuid) from public, anon, authenticated;
revoke all on function public.close_all_stale_sessions() from public, anon, authenticated;
