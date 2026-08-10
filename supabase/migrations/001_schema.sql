-- =============================================================================
-- ReTrack  —  001_schema.sql
-- Tables, indexes, updated_at triggers.
-- Run this first in the Supabase SQL editor.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — exactly two rows: Dharmik and Kruti
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('DHARMIK', 'KRUTI')),
  display_name text not null,
  emoji        text not null default '❤️',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Only one profile per role. This is what keeps the app a two-person app.
create unique index if not exists profiles_role_unique on public.profiles (role);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- daily_plans — the journey container (start date, goal length, timezone)
-- -----------------------------------------------------------------------------
create table if not exists public.daily_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'ReTrack',
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  start_date date not null default current_date,
  goal_days  int  not null default 90 check (goal_days > 0),
  timezone   text not null default 'Asia/Kolkata',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active plan at a time.
create unique index if not exists daily_plans_single_active
  on public.daily_plans ((is_active)) where is_active;

drop trigger if exists daily_plans_touch on public.daily_plans;
create trigger daily_plans_touch before update on public.daily_plans
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- activities — the configurable daily plan items (Kruti manages these)
-- -----------------------------------------------------------------------------
create table if not exists public.activities (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.daily_plans (id) on delete cascade,
  name              text not null,
  icon              text not null default '💪',
  target_seconds    int  not null check (target_seconds > 0),
  weight            numeric(6, 2) not null default 1 check (weight > 0),
  is_required       boolean not null default true,
  requires_photo    boolean not null default true,
  requires_location boolean not null default false,
  reminder_time     time,
  sort_order        int not null default 0,
  -- Activities are archived, never hard-deleted, so history stays intact.
  is_archived       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists activities_plan_idx on public.activities (plan_id, is_archived, sort_order);

drop trigger if exists activities_touch on public.activities;
create trigger activities_touch before update on public.activities
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- activity_sessions — one timer run. Durations are computed from server clocks.
-- -----------------------------------------------------------------------------
create table if not exists public.activity_sessions (
  id                   uuid primary key default gen_random_uuid(),
  activity_id          uuid not null references public.activities (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  local_date           date not null,
  status               text not null default 'running'
                         check (status in ('running', 'paused', 'finished', 'discarded')),
  started_at           timestamptz not null default now(),
  last_resumed_at      timestamptz,
  paused_at            timestamptz,
  ended_at             timestamptz,
  -- Accumulated *server measured* active time. Never written by the client.
  active_seconds       int not null default 0 check (active_seconds >= 0),
  location_lat         double precision,
  location_lng         double precision,
  location_accuracy    double precision,
  location_captured_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists activity_sessions_day_idx
  on public.activity_sessions (user_id, local_date, activity_id);

-- Only one live (running or paused) session per activity.
create unique index if not exists activity_sessions_one_live
  on public.activity_sessions (activity_id, user_id)
  where status in ('running', 'paused');

drop trigger if exists activity_sessions_touch on public.activity_sessions;
create trigger activity_sessions_touch before update on public.activity_sessions
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- activity_session_events — immutable audit trail of every start/pause/resume
-- -----------------------------------------------------------------------------
create table if not exists public.activity_session_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.activity_sessions (id) on delete cascade,
  event      text not null check (event in ('start', 'pause', 'resume', 'finish', 'discard')),
  -- Server clock. The device clock is never recorded as truth.
  at         timestamptz not null default now(),
  seconds_at_event int not null default 0
);

create index if not exists session_events_session_idx
  on public.activity_session_events (session_id, at);

-- -----------------------------------------------------------------------------
-- activity_proofs — Cloudinary references only, never image binaries
-- -----------------------------------------------------------------------------
create table if not exists public.activity_proofs (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid references public.activity_sessions (id) on delete set null,
  activity_id           uuid not null references public.activities (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  local_date            date not null,
  cloudinary_public_id  text not null unique,
  cloudinary_secure_url text not null,
  width                 int,
  height                int,
  format                text,
  bytes                 int not null,
  original_filename     text,
  original_bytes        int,
  exif                  jsonb,
  -- Server-side upload timestamp. Clients cannot set or change this.
  uploaded_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index if not exists activity_proofs_day_idx
  on public.activity_proofs (user_id, local_date, activity_id);

-- -----------------------------------------------------------------------------
-- activity_submissions — one row per activity per day
-- -----------------------------------------------------------------------------
create table if not exists public.activity_submissions (
  id                uuid primary key default gen_random_uuid(),
  activity_id       uuid not null references public.activities (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  local_date        date not null,
  status            text not null default 'submitted'
                      check (status in ('submitted', 'approved', 'correction_requested')),
  submitted_seconds int not null default 0,
  note              text,
  submitted_at      timestamptz not null default now(),
  reviewed_by       uuid references public.profiles (id),
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (activity_id, local_date)
);

create index if not exists activity_submissions_day_idx
  on public.activity_submissions (user_id, local_date);

drop trigger if exists activity_submissions_touch on public.activity_submissions;
create trigger activity_submissions_touch before update on public.activity_submissions
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- daily_progress — server-computed. Never written from the browser.
-- -----------------------------------------------------------------------------
create table if not exists public.daily_progress (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  local_date            date not null,
  percent               numeric(5, 2) not null default 0,
  required_total        int not null default 0,
  required_completed    int not null default 0,
  required_approved     int not null default 0,
  optional_completed    int not null default 0,
  total_active_seconds  int not null default 0,
  all_required_approved boolean not null default false,
  is_day_approved       boolean not null default false,
  updated_at            timestamptz not null default now(),
  unique (user_id, local_date)
);

create index if not exists daily_progress_date_idx on public.daily_progress (user_id, local_date desc);

-- -----------------------------------------------------------------------------
-- daily_approvals — Kruti's permanent "today is complete ❤️" record
-- -----------------------------------------------------------------------------
create table if not exists public.daily_approvals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  local_date          date not null,
  approved_by         uuid not null references public.profiles (id),
  approved_at         timestamptz not null default now(),
  percent_at_approval numeric(5, 2) not null,
  message             text,
  created_at          timestamptz not null default now(),
  unique (user_id, local_date)
);

-- -----------------------------------------------------------------------------
-- motivational_messages — rotating encouragement, editable by Kruti
-- -----------------------------------------------------------------------------
create table if not exists public.motivational_messages (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  min_percent numeric(5, 2) not null default 0 check (min_percent >= 0 and min_percent <= 100),
  max_percent numeric(5, 2) not null default 100 check (max_percent >= 0 and max_percent <= 100),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (min_percent <= max_percent)
);

create unique index if not exists motivational_messages_text_unique
  on public.motivational_messages (text);

drop trigger if exists motivational_messages_touch on public.motivational_messages;
create trigger motivational_messages_touch before update on public.motivational_messages
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- notification_preferences — one row per user
-- -----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  enabled               boolean not null default false,
  activity_reminders    boolean not null default true,
  daily_summary         boolean not null default true,
  daily_summary_time    time not null default '20:00',
  nudge_when_incomplete boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- milestones — celebration points along the journey
-- -----------------------------------------------------------------------------
create table if not exists public.milestones (
  id          uuid primary key default gen_random_uuid(),
  day_number  int not null unique check (day_number > 0),
  title       text not null,
  emoji       text not null default '🏅',
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
