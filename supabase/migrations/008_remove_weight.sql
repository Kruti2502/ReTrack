-- =============================================================================
-- 008 — Weight goes away
--
-- Every activity counted for a different slice of the day: Swimming at weight 2
-- was worth 25% while Staircase at weight 1 was worth 12.5%. It was a second
-- number to keep in your head, and one that quietly moved every other activity's
-- share each time one was added or removed.
--
-- Now every required activity is worth the same. Six of them means each is worth
-- a sixth, and the whole idea disappears from the plan editor.
--
-- Note this is not retroactive: percentages already written to daily_progress
-- keep the figure they were computed with, and only days recalculated after this
-- runs use the flat share.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The percentage, without the weighting
-- -----------------------------------------------------------------------------
create or replace function public.recalc_daily_progress(p_user_id uuid, p_local_date date)
returns public.daily_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_progress;
begin
  with plan_activities as (
    -- Activities that count for this date: everything currently in the plan,
    -- plus anything archived later that was actually done on this date. For an
    -- untimed activity "done" leaves a photo rather than a session.
    select a.*
    from public.activities a
    join public.daily_plans p on p.id = a.plan_id and p.is_active
    where not a.is_archived
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
      a.is_required,
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
-- get_day — stops handing the browser a field that no longer exists
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
-- The column itself. Dropped last, so nothing above is left reading it.
-- -----------------------------------------------------------------------------
alter table public.activities drop column if exists weight;
