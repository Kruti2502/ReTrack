-- =============================================================================
-- 013 — Today can be filled in too
--
-- 010 refused any date that was not already closed: "That day is still open —
-- use the normal flow for it ❤️". The reasoning was that an open day has the
-- normal flow available, so it does not need an escape hatch.
--
-- It does. The reasons a day gets missed do not wait for the day to end: the
-- phone was dead this morning, he was at the pool without it, he finished the
-- staircase and forgot to hit submit. Kruti knows it happened *now*, and being
-- told to come back after 6 AM tomorrow to record it is the app arguing with
-- her about something she watched him do.
--
-- Nothing about the honesty of the record changes. It is still hers alone,
-- still marked `is_backfilled`, and it still refuses to touch anything the
-- server measured. Two guards are added, because an open day has two hazards a
-- closed one does not:
--
--   * A timer that is open right now is not something to overwrite. She is told
--     to let him finish rather than having her number fight his clock.
--   * A day that is still running has only had so many minutes. 300 minutes
--     entered at 8 AM is not a record, and a session stamped in the future is
--     not one either — so the entry is placed inside the part of the day that
--     has actually happened.
--
-- Only tomorrow is refused now, and it always will be.
-- =============================================================================

create or replace function public.backfill_activity(
  p_activity_id uuid,
  p_local_date  date,
  p_minutes     int default null,
  p_note        text default null
)
returns public.daily_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_plan    public.daily_plans;
  v_act     public.activities;
  v_today   date := public.today_local();
  v_floor   timestamptz;
  v_ceil    timestamptz;
  v_start   timestamptz;
  v_session uuid;
  v_seconds int;
  v_room    int;
begin
  perform public.assert_kruti();

  select id into v_owner from public.profiles where role = 'DHARMIK';
  if v_owner is null then
    raise exception 'No profile to fill in for';
  end if;

  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  if p_local_date is null then
    raise exception 'Pick a date to fill in';
  end if;
  -- Today is allowed. Tomorrow is not a record of anything.
  if p_local_date > v_today then
    raise exception 'That day has not happened yet ❤️';
  end if;
  if v_plan.start_date is not null and p_local_date < v_plan.start_date then
    raise exception 'The journey had not started yet on that date';
  end if;

  select * into v_act from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found';
  end if;

  v_seconds := coalesce(p_minutes, 0) * 60;
  if v_seconds < 0 then
    raise exception 'Minutes cannot be negative';
  end if;
  if v_act.target_seconds is null and v_seconds > 0 then
    raise exception '% is not timed — attach the photo instead', v_act.name;
  end if;

  -- Never overwrite something the server actually timed.
  if exists (
    select 1 from public.activity_sessions
    where activity_id = p_activity_id
      and user_id = v_owner
      and local_date = p_local_date
      and status = 'finished'
      and not is_backfilled
  ) then
    raise exception '% was already recorded live on that day', v_act.name;
  end if;

  -- New with an open day: his clock may be running on this very activity. Her
  -- number would sit beside it and both would count.
  if exists (
    select 1 from public.activity_sessions
    where activity_id = p_activity_id
      and user_id = v_owner
      and local_date = p_local_date
      and status in ('running', 'paused')
  ) then
    raise exception 'His timer is open on % — let him finish it first ❤️', v_act.name;
  end if;

  -- The window this day actually occupies: 6 AM to 6 AM, but no further than
  -- now. On a closed day both ends are the day's own; on today the far end is
  -- this moment, which is what keeps a filled-in session out of the future.
  v_floor := public.day_ends_at(p_local_date) - interval '1 day';
  v_ceil  := least(now(), public.day_ends_at(p_local_date));
  v_room  := floor(extract(epoch from (v_ceil - v_floor)) / 60);

  if v_seconds > 0 and v_seconds > extract(epoch from (v_ceil - v_floor)) then
    raise exception 'Only % minutes of that day have passed so far', v_room;
  end if;

  -- Whatever was filled in before is replaced, so a corrected number does not
  -- pile on top of the old one.
  delete from public.activity_sessions
  where activity_id = p_activity_id
    and user_id = v_owner
    and local_date = p_local_date
    and is_backfilled;

  if v_seconds > 0 then
    -- The plan already says roughly when this activity happens; using its
    -- reminder time puts the session at a believable hour instead of midnight.
    v_start := (p_local_date + coalesce(v_act.reminder_time, time '18:00'))
                 at time zone public.plan_timezone();

    -- Then pulled inside the window. On a closed day the reminder hour is
    -- already inside it and nothing moves — this is the same placement 010
    -- made. On today it slides back to end now, because 6 PM has not happened.
    v_start := least(v_start, v_ceil - make_interval(secs => v_seconds));
    v_start := greatest(v_start, v_floor);

    insert into public.activity_sessions (
      activity_id, user_id, local_date, status,
      started_at, last_resumed_at, ended_at, active_seconds, is_backfilled
    ) values (
      p_activity_id, v_owner, p_local_date, 'finished',
      v_start, v_start, v_start + make_interval(secs => v_seconds), v_seconds, true
    )
    returning id into v_session;

    insert into public.activity_session_events (session_id, event, at, seconds_at_event)
    values (v_session, 'start',  v_start, 0),
           (v_session, 'finish', v_start + make_interval(secs => v_seconds), v_seconds);
  end if;

  -- The submission. She is the reviewer, so filling it in is approving it —
  -- there is no second pair of eyes to wait for.
  if v_seconds > 0 or v_act.target_seconds is null then
    insert into public.activity_submissions (
      activity_id, user_id, local_date, status, submitted_seconds, note,
      submitted_at, reviewed_by, reviewed_at, review_note
    ) values (
      p_activity_id, v_owner, p_local_date, 'approved', v_seconds, p_note,
      now(), auth.uid(), now(), 'Filled in by Kruti'
    )
    on conflict (activity_id, local_date) do update set
      status            = 'approved',
      submitted_seconds = excluded.submitted_seconds,
      note              = coalesce(excluded.note, public.activity_submissions.note),
      reviewed_by       = excluded.reviewed_by,
      reviewed_at       = excluded.reviewed_at,
      review_note       = excluded.review_note;
  else
    -- Cleared back to nothing: drop the submission too, unless a photo is still
    -- standing on its own.
    delete from public.activity_submissions
    where activity_id = p_activity_id
      and local_date = p_local_date
      and not exists (
        select 1 from public.activity_proofs
        where activity_id = p_activity_id and user_id = v_owner and local_date = p_local_date
      );
  end if;

  return public.recalc_daily_progress(v_owner, p_local_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- The same for a photo she attaches herself
--
-- `uploaded_at` is already now() and `is_backfilled` already says the photo was
-- attached rather than taken, so an open day needs no special handling here —
-- only the date check moves.
-- -----------------------------------------------------------------------------
create or replace function public.backfill_activity_proof(
  p_activity_id       uuid,
  p_local_date        date,
  p_public_id         text,
  p_secure_url        text,
  p_bytes             int,
  p_width             int default null,
  p_height            int default null,
  p_format            text default null,
  p_original_filename text default null,
  p_original_bytes    int default null
)
returns public.activity_proofs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_today   date := public.today_local();
  v_session uuid;
  v_proof   public.activity_proofs;
begin
  perform public.assert_kruti();

  select id into v_owner from public.profiles where role = 'DHARMIK';
  if v_owner is null then
    raise exception 'No profile to fill in for';
  end if;
  if p_local_date is null then
    raise exception 'Pick a date to fill in';
  end if;
  if p_local_date > v_today then
    raise exception 'That day has not happened yet ❤️';
  end if;
  if not exists (select 1 from public.activities where id = p_activity_id) then
    raise exception 'Activity not found';
  end if;

  -- Hang it off that day's session if there is one, the same way a live proof
  -- belongs to the timer it was taken during.
  select id into v_session from public.activity_sessions
  where activity_id = p_activity_id
    and user_id = v_owner
    and local_date = p_local_date
    and status = 'finished'
  order by started_at
  limit 1;

  insert into public.activity_proofs (
    session_id, activity_id, user_id, local_date,
    cloudinary_public_id, cloudinary_secure_url,
    width, height, format, bytes, original_filename, original_bytes,
    uploaded_at, is_backfilled
  ) values (
    v_session, p_activity_id, v_owner, p_local_date,
    p_public_id, p_secure_url,
    p_width, p_height, p_format, p_bytes, p_original_filename, p_original_bytes,
    now(), true
  )
  returning * into v_proof;

  perform public.recalc_daily_progress(v_owner, p_local_date);
  return v_proof;
end;
$$;
