-- =============================================================================
-- 015 — An activity can sit particular weekdays out
--
-- Rest days are about a whole day. This is the smaller thing underneath them:
-- swimming is not a Saturday, the pool is shut, and the only way to say so until
-- now was to archive swimming on Saturday morning and restore it on Sunday —
-- which is a lie about the plan and a mess in the history.
--
-- So each activity carries the weekdays it sits out, stored exactly as rest days
-- are (`extract(dow)`: 0 = Sunday … 6 = Saturday), on the activity rather than
-- the plan, because it is a fact about the activity. Kruti can change it from
-- the plan editor, and like rest days it is a rule rather than a stamp on a day:
-- change it and every day re-reads under the new rule instead of leaving old
-- days disagreeing with the plan they belong to.
--
-- The rule has the same one-directional shape as a rest day. On a weekday it
-- sits out, the activity is not owed: it is not in his list, it cannot drag the
-- percentage down, and it cannot hold the day's approval back. If he does it
-- anyway the work is kept, shown, and counted — as a bonus, in the optional
-- column, never as part of what the day asked of him.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which weekdays an activity sits out
--
-- Sunday by default, for every activity. The plan already rests on Sundays, and
-- an activity still asked for on a day nothing is owed was only ever a number
-- that did not add up — a 0% Sunday he was never expected to fill.
-- -----------------------------------------------------------------------------
alter table public.activities
  add column if not exists skip_days smallint[] not null default '{0}';

-- Said again for a database that already had the column: `add column if not
-- exists` does nothing at all when it is already there, default included.
alter table public.activities alter column skip_days set default '{0}';

comment on column public.activities.skip_days is
  'Weekdays this activity sits out, matching extract(dow): 0 = Sunday … 6 = Saturday.';

alter table public.activities drop constraint if exists activities_skip_days_valid;
alter table public.activities add constraint activities_skip_days_valid
  check (
    skip_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    -- At most six. An activity that sits out every day is not part of the plan,
    -- and archiving is what says that — it keeps the history intact and says it
    -- once, instead of leaving a row that is never asked for and never removed.
    and coalesce(array_length(skip_days, 1), 0) <= 6
  );

-- Every activity the plan already has, brought under the same default. Sunday is
-- added to whatever it already sits out rather than replacing it, and the guard
-- is the constraint above: an activity already sitting six days out keeps them.
update public.activities
   set skip_days = array(
     select distinct d from unnest(skip_days || 0::smallint) as d order by d
   )
 where not (0 = any(skip_days))
   and coalesce(array_length(skip_days, 1), 0) < 6;

-- -----------------------------------------------------------------------------
-- The percentage — a skipped activity is not part of the day it sits out
--
-- Same body as 008 otherwise: the flat share per required activity, each capped
-- at 100%, untimed ones all-or-nothing on their photo.
-- -----------------------------------------------------------------------------
create or replace function public.recalc_daily_progress(p_user_id uuid, p_local_date date)
returns public.daily_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_progress;
  v_dow smallint := extract(dow from p_local_date)::smallint;
begin
  with plan_activities as (
    -- Activities that count for this date: everything currently in the plan
    -- that does not sit this weekday out, plus anything since excluded —
    -- archived, or sitting the weekday out — that was actually done on this
    -- date. For an untimed activity "done" leaves a photo rather than a session.
    select a.*, v_dow = any(a.skip_days) as sits_out
    from public.activities a
    join public.daily_plans p on p.id = a.plan_id and p.is_active
    where (not a.is_archived and not (v_dow = any(a.skip_days)))
       or exists (
         select 1 from public.activity_sessions s
         where s.activity_id = a.id
           and s.user_id = p_user_id
           and s.local_date = p_local_date
           and s.status = 'finished'
       )
       or exists (
         select 1 from public.activity_proofs pr
         where pr.activity_id = a.id
           and pr.user_id = p_user_id
           and pr.local_date = p_local_date
       )
  ),
  tallied as (
    select
      -- One-directional, exactly as a rest day is: an activity sitting this
      -- weekday out is never owed, so anything he does anyway is counted as a
      -- bonus rather than as part of the day he was asked for.
      a.is_required and not a.sits_out as is_required,
      a.target_seconds,
      coalesce((
        select sum(s.active_seconds)
        from public.activity_sessions s
        where s.activity_id = a.id
          and s.user_id = p_user_id
          and s.local_date = p_local_date
          and s.status = 'finished'
      ), 0) as secs,
      exists (
        select 1 from public.activity_proofs pr
        where pr.activity_id = a.id
          and pr.user_id = p_user_id
          and pr.local_date = p_local_date
      ) as has_proof,
      coalesce((
        select sub.status
        from public.activity_submissions sub
        where sub.activity_id = a.id and sub.local_date = p_local_date
      ), 'none') as sub_status
    from plan_activities a
  ),
  scored as (
    select
      is_required,
      sub_status,
      secs,
      -- Each activity is capped at 100%: 40 minutes on a 30 minute target is
      -- 100%, never 133%. An untimed one is all or nothing — the photo is there
      -- or it is not.
      case
        when target_seconds is null then (case when has_proof then 1 else 0 end)::numeric
        else least(1, secs::numeric / target_seconds)
      end as fraction,
      case
        when target_seconds is null then has_proof
        else secs >= target_seconds
      end as done
    from tallied
  ),
  summed as (
    select
      -- A flat share each: the day is the average of what every required
      -- activity got to.
      coalesce(round(100 * avg(fraction) filter (where is_required), 2), 0) as percent,
      count(*) filter (where is_required)                              as required_total,
      count(*) filter (where is_required and done)                     as required_completed,
      count(*) filter (where is_required and sub_status = 'approved')  as required_approved,
      count(*) filter (where not is_required and done)                 as optional_completed,
      coalesce(sum(secs), 0)                                           as total_active_seconds
    from scored
  )
  insert into public.daily_progress as dp (
    user_id, local_date, percent, required_total, required_completed,
    required_approved, optional_completed, total_active_seconds,
    all_required_approved, is_day_approved, updated_at
  )
  select
    p_user_id,
    p_local_date,
    s.percent,
    s.required_total,
    s.required_completed,
    s.required_approved,
    s.optional_completed,
    s.total_active_seconds,
    s.required_total > 0 and s.required_approved = s.required_total,
    exists (
      select 1 from public.daily_approvals da
      where da.user_id = p_user_id and da.local_date = p_local_date
    ),
    now()
  from summed s
  on conflict (user_id, local_date) do update set
    percent               = excluded.percent,
    required_total        = excluded.required_total,
    required_completed    = excluded.required_completed,
    required_approved     = excluded.required_approved,
    optional_completed    = excluded.optional_completed,
    total_active_seconds  = excluded.total_active_seconds,
    all_required_approved = excluded.all_required_approved,
    is_day_approved       = excluded.is_day_approved,
    updated_at            = now()
  returning dp.* into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_day — says which activities today does not ask for
--
-- Same body as 014 otherwise. Which activities the bundle carries is unchanged:
-- a skipped one is still in it, now carrying its `skip_days` and an `is_skipped`
-- for the date being read, and with `is_required` already false for that date.
-- A screen can then say "not on Saturdays" instead of leaving a hole where
-- swimming used to be, and Kruti can still fill one in on a Saturday he swam
-- anyway. What the day asks of him is decided by the percentage, above.
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
  v_prog  jsonb;
  v_acts  jsonb;
  v_app   jsonb;
  v_dow   smallint := extract(dow from v_date)::smallint;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where role = 'DHARMIK';
  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  select to_jsonb(dp) into v_prog from public.daily_progress dp
    where dp.user_id = v_owner and dp.local_date = v_date;

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
        -- The effective answer for this date, not the plan's standing one: a
        -- screen that knows nothing about skip days still cannot ask him for
        -- an activity that sits this weekday out, or count it against the day.
        'is_required', a.is_required and not (v_dow = any(a.skip_days)),
        'skip_days', a.skip_days,
        'is_skipped', v_dow = any(a.skip_days),
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
    'progress', coalesce(v_prog, jsonb_build_object(
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
-- approve_day — a weekday everything sits out is still a day she can sign off
--
-- The old guard refused any day with nothing required, which was only ever
-- meant to catch a plan with no activities in it. Skip days make the same state
-- reachable by design — a Saturday every activity sits out — and a day she
-- cannot approve is a day the streak silently loses. Same body as 003 otherwise.
-- -----------------------------------------------------------------------------
create or replace function public.approve_day(
  p_local_date date default null,
  p_message text default null
)
returns public.daily_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_local_date, public.today_local());
  v_owner uuid;
  v_prog public.daily_progress;
  v_app public.daily_approvals;
begin
  perform public.assert_kruti();

  select id into v_owner from public.profiles where role = 'DHARMIK';
  if v_owner is null then
    raise exception 'No Dharmik profile found';
  end if;

  v_prog := public.recalc_daily_progress(v_owner, v_date);

  -- Nothing required today is not always an empty plan. Every activity may
  -- simply sit this weekday out, and then the day is a real, legitimate zero
  -- she must still be able to sign off — the streak depends on her being able
  -- to. An actually empty plan is the case worth refusing.
  if v_prog.required_total = 0 and not exists (
    select 1
    from public.activities a
    join public.daily_plans p on p.id = a.plan_id and p.is_active
    where not a.is_archived
  ) then
    raise exception 'There are no activities configured for this day';
  end if;
  if v_prog.required_approved < v_prog.required_total then
    raise exception 'Approve every required activity first';
  end if;

  insert into public.daily_approvals as da
    (user_id, local_date, approved_by, percent_at_approval, message)
  values (v_owner, v_date, auth.uid(), v_prog.percent, p_message)
  on conflict (user_id, local_date) do update
    set message = coalesce(excluded.message, da.message),
        approved_by = excluded.approved_by,
        percent_at_approval = excluded.percent_at_approval
  returning da.* into v_app;

  perform public.recalc_daily_progress(v_owner, v_date);
  return v_app;
end;
$$;
