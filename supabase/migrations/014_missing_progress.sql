-- =============================================================================
-- 014 — a day with no work yet reads as zeroes, not nulls
--
-- `get_day` read the day's progress into a `public.daily_progress` row variable
-- and leant on `coalesce(to_jsonb(v_prog), <zeroes>)` for the days that have no
-- row yet. That coalesce never fired. A SELECT INTO that finds nothing leaves
-- the row variable with every field null rather than leaving the variable null,
-- and `to_jsonb()` of that is a perfectly good object — `{"percent": null, ...}`
-- — so the zeroed fallback was unreachable.
--
-- Nothing downstream could tell the difference until it was rendered: the ring
-- rounded the null to 0% but the label read "null of null approved". Kruti saw it
-- every morning, because she opens his day before he has started anything on it
-- and the row is only written once something is recorded.
--
-- The fix is to carry the progress as jsonb from the start. `to_jsonb(dp)` inside
-- the query returns no row at all when there is none, so `v_prog` really is null
-- and the fallback takes over. The zeroes are the same ones the table defaults to.
--
-- Everything else about the function is unchanged.
-- =============================================================================

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
