-- =============================================================================
-- 010 — Kruti can fill in a day that was missed
--
-- The 6 AM boundary in 009 fixed the recurring case: late-night training now
-- lands on the day it followed, so nothing has to be reconstructed. What it
-- cannot fix is a day that was never logged at all — the app was down, the
-- phone was dead, or he simply forgot to hit submit.
--
-- Until now the only way to repair that was hand-written SQL, which is a bad
-- tool for a thing that will keep happening. So it becomes a feature, with one
-- deliberate constraint: only KRUTI can do it. Dharmik cannot type in a date or
-- a duration for himself, which is the property the whole app rests on. She is
-- already the one who decides whether a day counted; this lets her say so about
-- a day the app missed.
--
-- Two more rules keep it honest:
--
--   * A reconstructed record is MARKED as one. `is_backfilled` rides along on
--     the session and the proof, so a day filled in by hand can never be
--     mistaken later for one the server measured second by second.
--   * It refuses to touch anything measured live. If a session for that
--     activity already exists, she is told so rather than having it overwritten.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The mark
--
-- `get_day` serialises whole session and proof rows with to_jsonb(), so the flag
-- reaches the browser without that function being reopened.
-- -----------------------------------------------------------------------------
alter table public.activity_sessions
  add column if not exists is_backfilled boolean not null default false;

alter table public.activity_proofs
  add column if not exists is_backfilled boolean not null default false;

comment on column public.activity_sessions.is_backfilled is
  'True when Kruti entered this after the fact instead of the server timing it.';

comment on column public.activity_proofs.is_backfilled is
  'True when Kruti attached an existing photo to a past day, so `uploaded_at` is
   when she attached it and not when the photo was taken.';

-- -----------------------------------------------------------------------------
-- Filling in one activity on one past day
--
-- `p_minutes` is the TOTAL for that activity on that day, not an addition, so
-- the same call can be made again with a corrected number. Passing 0 (or null
-- for a timed activity) removes what was filled in.
--
-- Returns the day's progress row, which is what the caller wants to show: the
-- percentage the day now stands at.
-- -----------------------------------------------------------------------------
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
  v_start   timestamptz;
  v_session uuid;
  v_seconds int;
begin
  perform public.assert_kruti();

  select id into v_owner from public.profiles where role = 'DHARMIK';
  if v_owner is null then
    raise exception 'No profile to fill in for';
  end if;

  select * into v_plan from public.daily_plans where is_active order by created_at limit 1;

  -- A day that is still open goes through the normal flow: he starts a timer and
  -- she reviews it. This is only for days that have closed.
  if p_local_date is null then
    raise exception 'Pick a date to fill in';
  end if;
  if p_local_date >= v_today then
    raise exception 'That day is still open — use the normal flow for it ❤️';
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
-- Attaching an existing photo to a past day
--
-- `record_activity_proof` cannot be reused: it asserts Dharmik, insists on a
-- point for a location-required activity, and stamps today. Kruti attaching a
-- photo he sent her weeks ago is a different act, and it says so — no location
-- is claimed, and `is_backfilled` records that `uploaded_at` is when it was
-- attached rather than when it was taken.
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
  if p_local_date is null or p_local_date >= v_today then
    raise exception 'That day is still open — use the normal flow for it ❤️';
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

  -- An untimed activity is scored on its photo, so the day moves the moment
  -- this lands.
  perform public.recalc_daily_progress(v_owner, p_local_date);
  return v_proof;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.backfill_activity(uuid, date, int, text)',
    'public.backfill_activity_proof(uuid, date, text, text, int, int, int, text, text, int)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
