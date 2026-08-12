-- =============================================================================
-- 005 — "Ask for location at start" becomes a requirement, not a hint
--
-- Until now the browser sent a location when it could and the session opened
-- either way, so a timer could run with nothing attached. When Kruti switches
-- the flag on for an activity, the database now refuses to open — or to
-- continue — a session for it without a real point. The rule lives here rather
-- than in the client because the client is the thing being verified.
-- =============================================================================

-- A point Dharmik's phone could actually have produced.
create or replace function public.assert_valid_point(
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_lat is null or p_lng is null then
    raise exception 'A location is needed before this timer can start';
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'That location does not look real';
  end if;
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

-- Resuming is starting again, so it cannot be the way around the gate. This
-- only ever fires for sessions opened before this migration; anything started
-- afterwards already carries its point.
create or replace function public.resume_activity_session(p_session_id uuid)
returns public.activity_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s   public.activity_sessions;
  v_act public.activities;
begin
  perform public.assert_dharmik();

  select * into v_s from public.activity_sessions
    where id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'Session not found';
  end if;
  if v_s.status in ('finished', 'discarded') then
    raise exception 'This session is already closed';
  end if;

  select * into v_act from public.activities where id = v_s.activity_id;
  if v_act.requires_location and v_s.location_captured_at is null then
    raise exception 'Share your location with Kruti before continuing this activity';
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

-- Kruti reads these points; a stored point that is not a point is worse than
-- none, so the shape is checked on the way in here too.
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
  perform public.assert_valid_point(p_lat, p_lng);

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
-- Grants — `create or replace` keeps them, but the new helper needs its own.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.assert_valid_point(double precision, double precision)',
    'public.start_activity_session(uuid, double precision, double precision, double precision)',
    'public.resume_activity_session(uuid)',
    'public.set_session_location(uuid, double precision, double precision, double precision)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
