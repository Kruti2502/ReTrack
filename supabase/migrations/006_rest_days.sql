-- =============================================================================
-- 006 — Rest days
--
-- Sunday is a rest day, so a Sunday with nothing done is not a failure. Until
-- now the journey had no idea: a blank Sunday counted as a missed day, dragged
-- the average down, and — worst of all — reset the streak every Monday, which
-- capped the streak at six forever.
--
-- Which weekdays rest lives on the plan (0 = Sunday … 6 = Saturday), so Kruti
-- can move it without another migration. The rule is one-directional: a rest
-- day is never counted against him, but if he trains anyway the day still
-- counts for him — average, approvals and streak all take the bonus.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which days are rest days
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  add column if not exists rest_days smallint[] not null default '{0}';

comment on column public.daily_plans.rest_days is
  'Weekdays off, matching extract(dow): 0 = Sunday … 6 = Saturday.';

alter table public.daily_plans drop constraint if exists daily_plans_rest_days_valid;
alter table public.daily_plans add constraint daily_plans_rest_days_valid
  check (
    rest_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    -- At most six: a week that is entirely rest has no journey left to measure.
    and coalesce(array_length(rest_days, 1), 0) <= 6
  );

-- The single source of truth for "does this date count?". Everything below
-- asks this rather than testing a weekday of its own.
create or replace function public.is_rest_day(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select extract(dow from p_date)::smallint = any(p.rest_days)
      from public.daily_plans p
      where p.is_active
      order by p.created_at
      limit 1
    ),
    false
  );
$$;

-- Note that nothing stores "this day was a rest day". Rest days are a rule, not
-- a fact about a day: change the rule and the whole journey re-reads under it,
-- consistently, instead of leaving already-stamped days disagreeing with the
-- plan they belong to.

-- -----------------------------------------------------------------------------
-- Streaks — a rest day is a bridge, not a break and not a free day
--
-- Saturday done → Sunday off → Monday done reads as a 2 day streak: the run
-- survives the Sunday, but the Sunday itself is not counted as a day done.
-- -----------------------------------------------------------------------------
create or replace function public.compute_streaks(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r        record;
  v_today  date := public.today_local();
  v_floor  date;
  v_prev   date;
  v_run    int := 0;
  v_best   int := 0;
  v_cur    int := 0;
  v_probe  date;
  v_linked boolean;
begin
  -- Walking back can never leave the journey, so the loop always terminates.
  select coalesce(min(start_date), v_today - 3650) into v_floor
  from public.daily_plans where is_active;

  for r in
    select local_date from public.daily_progress
    where user_id = p_user_id and is_day_approved
    order by local_date
  loop
    v_linked := false;
    if v_prev is not null then
      -- The run survives the gap only if every day inside it was a rest day.
      v_linked := not exists (
        select 1
        from generate_series(v_prev + 1, r.local_date - 1, interval '1 day') g(d)
        where not public.is_rest_day(g.d::date)
      );
    end if;

    if v_linked then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;
    v_prev := r.local_date;
    if v_run > v_best then
      v_best := v_run;
    end if;
  end loop;

  -- The current streak counts back from today. A day that is still in progress
  -- does not break it — we simply start counting from yesterday.
  v_probe := v_today;
  if not exists (
    select 1 from public.daily_progress
    where user_id = p_user_id and local_date = v_probe and is_day_approved
  ) then
    v_probe := v_probe - 1;
  end if;

  while v_probe >= v_floor loop
    if exists (
      select 1 from public.daily_progress
      where user_id = p_user_id and local_date = v_probe and is_day_approved
    ) then
      v_cur := v_cur + 1;
    elsif not public.is_rest_day(v_probe) then
      -- An ordinary day with no approval is where the streak actually ends.
      exit;
    end if;
    v_probe := v_probe - 1;
  end loop;

  return jsonb_build_object('current_streak', v_cur, 'longest_streak', greatest(v_best, v_cur));
end;
$$;

-- -----------------------------------------------------------------------------
-- Journey statistics — rest days leave the average and the missed count alone
-- -----------------------------------------------------------------------------
create or replace function public.get_journey_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner    uuid;
  v_plan     public.daily_plans;
  v_today    date := public.today_local();
  v_day      int;
  v_streaks  jsonb;
  v_stats    record;
  v_miles    jsonb;
  v_rest     int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where role = 'DHARMIK';
  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  v_day := greatest(1, (v_today - v_plan.start_date) + 1);
  v_streaks := public.compute_streaks(v_owner);

  -- Rest days that have already gone by. These were never days he owed.
  select count(*) into v_rest
  from generate_series(coalesce(v_plan.start_date, v_today), v_today, interval '1 day') g(d)
  where public.is_rest_day(g.d::date);

  select
    -- A rest day only enters the average when he actually trained on it.
    coalesce(round(avg(percent) filter (where not rest or percent > 0), 1), 0)
                                                                  as average_completion,
    count(*) filter (where is_day_approved)                       as approved_days,
    count(*) filter (where percent >= 100)                        as full_days,
    count(*) filter (where percent > 0 and percent < 100)         as partial_days,
    coalesce(sum(total_active_seconds), 0)                        as total_active_seconds,
    count(*) filter (where percent > 0)                           as active_days,
    count(*) filter (where percent > 0 and rest)                  as bonus_days
  into v_stats
  from (
    select d.*, public.is_rest_day(d.local_date) as rest
    from public.daily_progress d
    where d.user_id = v_owner and d.local_date between v_plan.start_date and v_today
  ) t;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day_number', m.day_number,
      'title', m.title,
      'emoji', m.emoji,
      'description', m.description,
      'reached', v_day >= m.day_number
    ) order by m.day_number
  ), '[]'::jsonb)
  into v_miles
  from public.milestones m
  where m.is_active;

  return jsonb_build_object(
    'today', v_today,
    'plan', to_jsonb(v_plan),
    'day_number', v_day,
    'goal_days', v_plan.goal_days,
    'days_remaining', greatest(0, v_plan.goal_days - v_day),
    'days_elapsed', v_day,
    'average_completion', v_stats.average_completion,
    'approved_days', v_stats.approved_days,
    'full_days', v_stats.full_days,
    'partial_days', v_stats.partial_days,
    'active_days', v_stats.active_days,
    -- Only the working days he owed and did not turn up for.
    'missed_days', greatest(0, (v_day - v_rest) - (v_stats.active_days - v_stats.bonus_days)),
    'rest_days_elapsed', v_rest,
    'bonus_days', v_stats.bonus_days,
    'is_rest_day', public.is_rest_day(v_today),
    'total_active_seconds', v_stats.total_active_seconds,
    'current_streak', v_streaks -> 'current_streak',
    'longest_streak', v_streaks -> 'longest_streak',
    'milestones', v_miles
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- History — each day now says whether it was a rest day, so the list can stop
-- calling a blank Sunday "incomplete".
-- -----------------------------------------------------------------------------
create or replace function public.get_history(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_plan  public.daily_plans;
  v_rows  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where role = 'DHARMIK';
  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', d.local_date,
      'day_number', greatest(1, (d.local_date - v_plan.start_date) + 1),
      'percent', d.percent,
      'required_total', d.required_total,
      'required_completed', d.required_completed,
      'required_approved', d.required_approved,
      'total_active_seconds', d.total_active_seconds,
      'is_day_approved', d.is_day_approved,
      'is_rest_day', public.is_rest_day(d.local_date),
      'message', (
        select da.message from public.daily_approvals da
        where da.user_id = v_owner and da.local_date = d.local_date
      ),
      'photo_count', (
        select count(*) from public.activity_proofs p
        where p.user_id = v_owner and p.local_date = d.local_date
      )
    ) order by d.local_date desc
  ), '[]'::jsonb)
  into v_rows
  from public.daily_progress d
  where d.user_id = v_owner and d.local_date between p_from and p_to;

  return v_rows;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_day — the dashboard needs to know it is a rest day before any timer has
-- run, so this is derived from the date rather than read off a progress row
-- that may not exist yet.
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
        'weight', a.weight,
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
-- Grants — `create or replace` keeps them, but the new helper needs its own.
-- -----------------------------------------------------------------------------
do $$
begin
  execute 'revoke all on function public.is_rest_day(date) from public, anon';
  execute 'grant execute on function public.is_rest_day(date) to authenticated';
end;
$$;
