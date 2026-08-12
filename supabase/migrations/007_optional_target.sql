-- =============================================================================
-- 007 — A time target becomes optional
--
-- Physio and Staircase are not stopwatch work: he does the thing and photographs
-- it. Until now every activity needed a duration, so those two carried a made-up
-- number he had to run a timer against to reach 100%.
--
-- `target_seconds` may now be null, and an activity with no target is measured
-- by its proof instead: the photo IS the task. Percentage, submission and the
-- daily count all follow that one rule.
--
-- Location moves with it. A timed activity captures its point when the timer
-- opens; an untimed one has no timer, so the point is captured with the photo
-- and lives on the proof.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The target itself
-- -----------------------------------------------------------------------------
alter table public.activities alter column target_seconds drop not null;

alter table public.activities drop constraint if exists activities_target_seconds_check;
alter table public.activities add constraint activities_target_seconds_check
  check (target_seconds is null or target_seconds > 0);

-- Something has to say when an activity is done. With no target that can only
-- be the photo, so an untimed activity without one would be uncompletable.
alter table public.activities drop constraint if exists activities_measurable;
alter table public.activities add constraint activities_measurable
  check (target_seconds is not null or requires_photo);

comment on column public.activities.target_seconds is
  'Null means untimed: no stopwatch, the photo proof is the whole task.';

-- -----------------------------------------------------------------------------
-- Where an untimed activity's location lives
-- -----------------------------------------------------------------------------
alter table public.activity_proofs
  add column if not exists location_lat         double precision,
  add column if not exists location_lng         double precision,
  add column if not exists location_accuracy    double precision,
  add column if not exists location_captured_at timestamptz;

comment on column public.activity_proofs.location_lat is
  'Only for untimed activities — a timed one carries its point on the session.';

-- -----------------------------------------------------------------------------
-- recalc_daily_progress — an untimed activity scores on its proof
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
      weight,
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
      coalesce(
        round(
          100 * sum(weight * fraction) filter (where is_required)
          / nullif(sum(weight) filter (where is_required), 0),
          2
        ), 0
      ) as percent,
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
-- Proof — now the place an untimed activity's location is recorded
--
-- The signature grows, so the old one is dropped rather than overloaded: two
-- functions of the same name taking defaults would make every call ambiguous.
-- -----------------------------------------------------------------------------
drop function if exists public.record_activity_proof(
  uuid, text, text, int, uuid, int, int, text, text, int, jsonb
);

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
  p_exif              jsonb default null,
  p_lat               double precision default null,
  p_lng               double precision default null,
  p_accuracy          double precision default null
)
returns public.activity_proofs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_local();
  v_act     public.activities;
  v_sub     public.activity_submissions;
  v_proof   public.activity_proofs;
  v_has_loc boolean;
begin
  perform public.assert_dharmik();

  select * into v_act from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;

  -- A timed activity was already gated at the timer; an untimed one has no
  -- timer, so this upload is the only moment a point can be taken. The missing
  -- case is spelled out here because assert_valid_point talks about a timer,
  -- and there is no timer on this screen to talk about.
  if v_act.requires_location and v_act.target_seconds is null then
    if p_lat is null or p_lng is null then
      raise exception 'Share your location with Kruti before sending this photo';
    end if;
    perform public.assert_valid_point(p_lat, p_lng);
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

  v_has_loc := p_lat is not null and p_lng is not null;

  insert into public.activity_proofs (
    session_id, activity_id, user_id, local_date,
    cloudinary_public_id, cloudinary_secure_url,
    width, height, format, bytes, original_filename, original_bytes, exif,
    location_lat, location_lng, location_accuracy, location_captured_at,
    uploaded_at
  )
  values (
    p_session_id, p_activity_id, v_uid, v_today,
    p_public_id, p_secure_url,
    p_width, p_height, p_format, p_bytes, p_original_filename, p_original_bytes, p_exif,
    case when v_has_loc then p_lat end,
    case when v_has_loc then p_lng end,
    case when v_has_loc then p_accuracy end,
    case when v_has_loc then now() end,
    now()  -- server timestamp, always
  )
  returning * into v_proof;

  perform public.recalc_daily_progress(v_uid, v_today);
  return v_proof;
end;
$$;

-- Removing the photo un-completes an untimed activity, so the day has to move.
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

  -- The day's percentage counts an untimed activity by its photo, so removing
  -- one can take the day back down. Recalculated for the proof's owner, since
  -- Kruti may be the one deleting it.
  perform public.recalc_daily_progress(v_p.user_id, v_p.local_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- Submission — an untimed activity is submitted on its photo, not on a clock
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

  if v_act.target_seconds is not null and v_seconds <= 0 then
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

-- -----------------------------------------------------------------------------
-- The timer refuses to open on an activity that has no clock to run against.
-- The app hides the button; this is what makes it true.
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

  -- Reuse a live session rather than opening a second one for the same activity.
  select * into v_session from public.activity_sessions
    where activity_id = p_activity_id and user_id = v_uid and status in ('running', 'paused');
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
-- Grants — the dropped-and-recreated function lost its own.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text := 'public.record_activity_proof(uuid, text, text, int, uuid, int, int, text, '
             'text, int, jsonb, double precision, double precision, double precision)';
begin
  execute format('revoke all on function %s from public, anon', fn);
  execute format('grant execute on function %s to authenticated', fn);
end;
$$;
