-- =============================================================================
-- ReTrack  —  003_functions.sql
-- Every write that touches timing, proof, progress or approval lives here.
-- All functions are SECURITY DEFINER and re-check the caller's role, so the
-- browser can never shortcut them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
create or replace function public.assert_dharmik()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_dharmik() then
    raise exception 'Only Dharmik can do this' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_kruti()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_kruti() then
    raise exception 'Only Kruti can approve or review' using errcode = '42501';
  end if;
end;
$$;

-- A single session can never legitimately exceed 12 hours of active time.
create or replace function public.clamp_seconds(p_seconds numeric)
returns int
language sql
immutable
as $$
  select least(greatest(coalesce(p_seconds, 0), 0), 43200)::int;
$$;

-- -----------------------------------------------------------------------------
-- recalc_daily_progress — the only place a percentage is ever produced
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
    -- plus anything archived later that was actually done on this date.
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
  ),
  tallied as (
    select
      a.weight,
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
      coalesce((
        select sub.status
        from public.activity_submissions sub
        where sub.activity_id = a.id and sub.local_date = p_local_date
      ), 'none') as sub_status
    from plan_activities a
  ),
  summed as (
    select
      -- Each activity is capped at 100%: 40 minutes on a 30 minute target is
      -- 100%, never 133%.
      coalesce(
        round(
          100 * sum(weight * least(1, secs::numeric / target_seconds)) filter (where is_required)
          / nullif(sum(weight) filter (where is_required), 0),
          2
        ), 0
      ) as percent,
      count(*) filter (where is_required)                                   as required_total,
      count(*) filter (where is_required and secs >= target_seconds)        as required_completed,
      count(*) filter (where is_required and sub_status = 'approved')       as required_approved,
      count(*) filter (where not is_required and secs >= target_seconds)    as optional_completed,
      coalesce(sum(secs), 0)                                                as total_active_seconds
    from tallied
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
-- Timer: start / pause / resume / finish / discard
-- -----------------------------------------------------------------------------

-- Two timers should never run at once; starting one pauses the other.
create or replace function public.pause_running_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_add int;
begin
  for r in
    select * from public.activity_sessions
    where user_id = p_user_id and status = 'running'
  loop
    v_add := public.clamp_seconds(extract(epoch from (now() - coalesce(r.last_resumed_at, now()))));
    update public.activity_sessions
      set active_seconds  = public.clamp_seconds(active_seconds + v_add),
          status          = 'paused',
          paused_at       = now(),
          last_resumed_at = null
      where id = r.id;

    insert into public.activity_session_events (session_id, event, seconds_at_event)
    values (r.id, 'pause', r.active_seconds + v_add);
  end loop;
end;
$$;

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
begin
  perform public.assert_dharmik();

  select * into v_act from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;
  if v_act.is_archived then
    raise exception 'This activity is no longer part of the plan';
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = p_activity_id and local_date = v_today;
  if found and v_sub.status = 'approved' then
    raise exception 'This activity is already approved for today ❤️';
  end if;
  if found and v_sub.status = 'submitted' then
    raise exception 'This activity is waiting for Kruti''s review';
  end if;

  -- Reuse a live session rather than opening a second one for the same activity.
  select * into v_session from public.activity_sessions
    where activity_id = p_activity_id and user_id = v_uid and status in ('running', 'paused');
  if found then
    return public.resume_activity_session(v_session.id);
  end if;

  perform public.pause_running_sessions(v_uid);

  insert into public.activity_sessions (
    activity_id, user_id, local_date, status, started_at, last_resumed_at,
    location_lat, location_lng, location_accuracy, location_captured_at
  )
  values (
    p_activity_id, v_uid, v_today, 'running', now(), now(),
    p_lat, p_lng,
    case when p_lat is not null then p_accuracy end,
    case when p_lat is not null then now() end
  )
  returning * into v_session;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_session.id, 'start', 0);

  perform public.recalc_daily_progress(v_uid, v_today);
  return v_session;
end;
$$;

create or replace function public.pause_activity_session(p_session_id uuid)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   public.activity_sessions;
  v_add int;
begin
  perform public.assert_dharmik();

  select * into v_s from public.activity_sessions
    where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'Session not found';
  end if;
  if v_s.status <> 'running' then
    return v_s;
  end if;

  v_add := public.clamp_seconds(extract(epoch from (now() - coalesce(v_s.last_resumed_at, now()))));

  update public.activity_sessions
    set active_seconds  = public.clamp_seconds(active_seconds + v_add),
        status          = 'paused',
        paused_at       = now(),
        last_resumed_at = null
    where id = p_session_id
    returning * into v_s;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_s.id, 'pause', v_s.active_seconds);

  return v_s;
end;
$$;

create or replace function public.finish_activity_session(p_session_id uuid)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   public.activity_sessions;
  v_add int := 0;
begin
  perform public.assert_dharmik();

  select * into v_s from public.activity_sessions
    where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'Session not found';
  end if;
  if v_s.status in ('finished', 'discarded') then
    return v_s;
  end if;

  if v_s.status = 'running' then
    v_add := public.clamp_seconds(extract(epoch from (now() - coalesce(v_s.last_resumed_at, now()))));
  end if;

  update public.activity_sessions
    set active_seconds  = public.clamp_seconds(active_seconds + v_add),
        status          = 'finished',
        ended_at        = now(),
        last_resumed_at = null,
        paused_at       = null
    where id = p_session_id
    returning * into v_s;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_s.id, 'finish', v_s.active_seconds);

  perform public.recalc_daily_progress(v_s.user_id, v_s.local_date);
  return v_s;
end;
$$;

-- For an accidental start. Only possible before the day's activity is submitted.
create or replace function public.discard_activity_session(p_session_id uuid)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   public.activity_sessions;
  v_sub public.activity_submissions;
begin
  perform public.assert_dharmik();

  select * into v_s from public.activity_sessions
    where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'Session not found';
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = v_s.activity_id and local_date = v_s.local_date;
  if found and v_sub.status in ('approved', 'submitted') then
    raise exception 'This activity has already been submitted';
  end if;

  update public.activity_sessions
    set status = 'discarded', ended_at = now(), last_resumed_at = null
    where id = p_session_id
    returning * into v_s;

  insert into public.activity_session_events (session_id, event, seconds_at_event)
  values (v_s.id, 'discard', v_s.active_seconds);

  perform public.recalc_daily_progress(v_s.user_id, v_s.local_date);
  return v_s;
end;
$$;

-- Location permission often resolves after the timer has already started.
create or replace function public.set_session_location(
  p_session_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null
)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.activity_sessions;
begin
  perform public.assert_dharmik();

  update public.activity_sessions
    set location_lat = p_lat,
        location_lng = p_lng,
        location_accuracy = p_accuracy,
        location_captured_at = now()
    where id = p_session_id
      and user_id = auth.uid()
      and status in ('running', 'paused')
      and location_captured_at is null
    returning * into v_s;

  if not found then
    raise exception 'Location could not be attached to this session';
  end if;
  return v_s;
end;
$$;

-- -----------------------------------------------------------------------------
-- Proof
-- -----------------------------------------------------------------------------
create or replace function public.record_activity_proof(
  p_activity_id       uuid,
  p_public_id         text,
  p_secure_url        text,
  p_bytes             int,
  p_session_id        uuid default null,
  p_width             int default null,
  p_height            int default null,
  p_format            text default null,
  p_original_filename text default null,
  p_original_bytes    int default null,
  p_exif              jsonb default null
)
returns public.activity_proofs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := public.today_local();
  v_sub   public.activity_submissions;
  v_proof public.activity_proofs;
begin
  perform public.assert_dharmik();

  if not exists (select 1 from public.activities where id = p_activity_id) then
    raise exception 'Activity not found';
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = p_activity_id and local_date = v_today;
  if found and v_sub.status = 'approved' then
    raise exception 'This activity is already approved for today ❤️';
  end if;

  -- A proof belongs to a real session of the same activity, on the same day.
  if p_session_id is not null then
    if not exists (
      select 1 from public.activity_sessions
      where id = p_session_id
        and user_id = v_uid
        and activity_id = p_activity_id
        and local_date = v_today
    ) then
      raise exception 'Proof does not match a session of this activity today';
    end if;
  end if;

  insert into public.activity_proofs (
    session_id, activity_id, user_id, local_date,
    cloudinary_public_id, cloudinary_secure_url,
    width, height, format, bytes, original_filename, original_bytes, exif,
    uploaded_at
  )
  values (
    p_session_id, p_activity_id, v_uid, v_today,
    p_public_id, p_secure_url,
    p_width, p_height, p_format, p_bytes, p_original_filename, p_original_bytes, p_exif,
    now()  -- server timestamp, always
  )
  returning * into v_proof;

  return v_proof;
end;
$$;

create or replace function public.delete_activity_proof(p_proof_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p       public.activity_proofs;
  v_sub     public.activity_submissions;
  v_has_sub boolean;
begin
  select * into v_p from public.activity_proofs where id = p_proof_id;
  if not found then
    raise exception 'Proof not found';
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = v_p.activity_id and local_date = v_p.local_date;
  -- Captured now: FOUND is reset by the PERFORM calls below.
  v_has_sub := v_sub.id is not null;

  -- Kruti may remove any proof. Dharmik may only remove one he has not
  -- submitted or that has been sent back for correction.
  if not public.is_kruti() then
    perform public.assert_dharmik();
    if v_p.user_id <> auth.uid() then
      raise exception 'Not your proof' using errcode = '42501';
    end if;
    if v_has_sub and v_sub.status in ('approved', 'submitted') then
      raise exception 'This activity has already been submitted';
    end if;
  end if;

  delete from public.activity_proofs where id = p_proof_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submission and review
-- -----------------------------------------------------------------------------
create or replace function public.submit_activity(p_activity_id uuid, p_note text default null)
returns public.activity_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_local();
  v_act     public.activities;
  v_seconds int;
  v_sub     public.activity_submissions;
begin
  perform public.assert_dharmik();

  select * into v_act from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;

  -- Only server-measured, finished session time counts. There is no way to
  -- type in "I did 30 minutes".
  select coalesce(sum(active_seconds), 0) into v_seconds
  from public.activity_sessions
  where activity_id = p_activity_id
    and user_id = v_uid
    and local_date = v_today
    and status = 'finished';

  if v_seconds <= 0 then
    raise exception 'Finish at least one timed session before submitting';
  end if;

  if v_act.requires_photo and not exists (
    select 1 from public.activity_proofs
    where activity_id = p_activity_id and user_id = v_uid and local_date = v_today
  ) then
    raise exception 'This activity needs a photo proof';
  end if;

  select * into v_sub from public.activity_submissions
    where activity_id = p_activity_id and local_date = v_today;

  if found then
    if v_sub.status = 'approved' then
      raise exception 'Already approved — nothing to resubmit ❤️';
    end if;
    update public.activity_submissions
      set status = 'submitted',
          submitted_seconds = v_seconds,
          note = coalesce(p_note, note),
          submitted_at = now(),
          reviewed_by = null,
          reviewed_at = null,
          review_note = null
      where id = v_sub.id
      returning * into v_sub;
  else
    insert into public.activity_submissions (
      activity_id, user_id, local_date, status, submitted_seconds, note, submitted_at
    )
    values (p_activity_id, v_uid, v_today, 'submitted', v_seconds, p_note, now())
    returning * into v_sub;
  end if;

  perform public.recalc_daily_progress(v_uid, v_today);
  return v_sub;
end;
$$;

create or replace function public.approve_activity(p_submission_id uuid, p_note text default null)
returns public.activity_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.activity_submissions;
begin
  perform public.assert_kruti();

  select * into v_sub from public.activity_submissions where id = p_submission_id;
  if not found then
    raise exception 'Submission not found';
  end if;

  update public.activity_submissions
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = p_note
    where id = p_submission_id
    returning * into v_sub;

  perform public.recalc_daily_progress(v_sub.user_id, v_sub.local_date);
  return v_sub;
end;
$$;

create or replace function public.request_correction(p_submission_id uuid, p_note text)
returns public.activity_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.activity_submissions;
begin
  perform public.assert_kruti();

  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'Please write what needs to change ❤️';
  end if;

  update public.activity_submissions
    set status = 'correction_requested',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = p_note
    where id = p_submission_id
    returning * into v_sub;

  if not found then
    raise exception 'Submission not found';
  end if;

  perform public.recalc_daily_progress(v_sub.user_id, v_sub.local_date);
  return v_sub;
end;
$$;

-- -----------------------------------------------------------------------------
-- Daily approval
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

  if v_prog.required_total = 0 then
    raise exception 'There are no required activities configured for this day';
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

create or replace function public.revoke_day_approval(p_local_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  perform public.assert_kruti();
  select id into v_owner from public.profiles where role = 'DHARMIK';

  delete from public.daily_approvals where user_id = v_owner and local_date = p_local_date;
  perform public.recalc_daily_progress(v_owner, p_local_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- Reads: one call builds a whole day
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
-- Streaks
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
  v_prev   date;
  v_run    int := 0;
  v_best   int := 0;
  v_cur    int := 0;
  v_probe  date;
begin
  for r in
    select local_date from public.daily_progress
    where user_id = p_user_id and is_day_approved
    order by local_date
  loop
    if v_prev is not null and r.local_date = v_prev + 1 then
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
    where user_id = p_user_id and local_date = v_today and is_day_approved
  ) then
    v_probe := v_today - 1;
  end if;

  loop
    exit when not exists (
      select 1 from public.daily_progress
      where user_id = p_user_id and local_date = v_probe and is_day_approved
    );
    v_cur := v_cur + 1;
    v_probe := v_probe - 1;
  end loop;

  return jsonb_build_object('current_streak', v_cur, 'longest_streak', greatest(v_best, v_cur));
end;
$$;

-- -----------------------------------------------------------------------------
-- Journey statistics
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
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select id into v_owner from public.profiles where role = 'DHARMIK';
  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  v_day := greatest(1, (v_today - v_plan.start_date) + 1);
  v_streaks := public.compute_streaks(v_owner);

  select
    coalesce(round(avg(percent), 1), 0)                          as average_completion,
    count(*) filter (where is_day_approved)                      as approved_days,
    count(*) filter (where percent >= 100)                       as full_days,
    count(*) filter (where percent > 0 and percent < 100)        as partial_days,
    coalesce(sum(total_active_seconds), 0)                       as total_active_seconds,
    count(*) filter (where percent > 0)                          as active_days
  into v_stats
  from public.daily_progress
  where user_id = v_owner and local_date between v_plan.start_date and v_today;

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
    'missed_days', greatest(0, v_day - v_stats.active_days),
    'total_active_seconds', v_stats.total_active_seconds,
    'current_streak', v_streaks -> 'current_streak',
    'longest_streak', v_streaks -> 'longest_streak',
    'milestones', v_miles
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- History list
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
-- Plan management (Kruti)
-- -----------------------------------------------------------------------------
create or replace function public.archive_activity(p_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act public.activities;
begin
  perform public.assert_kruti();

  -- Archiving instead of deleting keeps every past day's history readable.
  update public.activities set is_archived = true where id = p_activity_id
    returning * into v_act;
  if not found then
    raise exception 'Activity not found';
  end if;

  perform public.recalc_daily_progress(
    (select id from public.profiles where role = 'DHARMIK'),
    public.today_local()
  );
  return v_act;
end;
$$;

create or replace function public.restore_activity(p_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act public.activities;
begin
  perform public.assert_kruti();
  update public.activities set is_archived = false where id = p_activity_id
    returning * into v_act;
  if not found then
    raise exception 'Activity not found';
  end if;
  perform public.recalc_daily_progress(
    (select id from public.profiles where role = 'DHARMIK'),
    public.today_local()
  );
  return v_act;
end;
$$;

-- Recompute today after Kruti edits targets, weights or required flags.
create or replace function public.refresh_today()
returns public.daily_progress
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.recalc_daily_progress(
    (select id from public.profiles where role = 'DHARMIK'),
    public.today_local()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Account bootstrap: creates the profile when you add a user in the dashboard.
-- There is no public sign-up; this only fires for the first DHARMIK and the
-- first KRUTI, and only when the user was created with the right metadata.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
begin
  v_role := upper(coalesce(new.raw_user_meta_data ->> 'role', ''));
  if v_role not in ('DHARMIK', 'KRUTI') then
    return new;
  end if;
  if exists (select 1 from public.profiles where role = v_role) then
    return new;
  end if;

  v_name := coalesce(new.raw_user_meta_data ->> 'display_name', initcap(lower(v_role)));

  insert into public.profiles (id, role, display_name, emoji)
  values (new.id, v_role, v_name, case when v_role = 'KRUTI' then '🌸' else '💪' end)
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Grants — authenticated only, never anon
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.my_role()',
    'public.is_kruti()',
    'public.is_dharmik()',
    'public.plan_timezone()',
    'public.today_local()',
    'public.start_activity_session(uuid, double precision, double precision, double precision)',
    'public.pause_activity_session(uuid)',
    'public.resume_activity_session(uuid)',
    'public.finish_activity_session(uuid)',
    'public.discard_activity_session(uuid)',
    'public.set_session_location(uuid, double precision, double precision, double precision)',
    'public.record_activity_proof(uuid, text, text, int, uuid, int, int, text, text, int, jsonb)',
    'public.delete_activity_proof(uuid)',
    'public.submit_activity(uuid, text)',
    'public.approve_activity(uuid, text)',
    'public.request_correction(uuid, text)',
    'public.approve_day(date, text)',
    'public.revoke_day_approval(date)',
    'public.get_day(date)',
    'public.get_journey_stats()',
    'public.get_history(date, date)',
    'public.compute_streaks(uuid)',
    'public.archive_activity(uuid)',
    'public.restore_activity(uuid)',
    'public.refresh_today()',
    'public.recalc_daily_progress(uuid, date)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
