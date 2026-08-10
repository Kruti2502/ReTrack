-- =============================================================================
-- ReTrack  —  004_seed.sql
-- Run this AFTER both users exist (see README → Supabase setup).
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Milestones
-- -----------------------------------------------------------------------------
insert into public.milestones (day_number, title, emoji, description) values
  (1,  'The first step',   '🏁', 'Every journey starts with one day.'),
  (7,  'One week strong',  '🔥', 'A full week of showing up.'),
  (14, 'Two weeks',        '💪', 'This is becoming a habit.'),
  (30, 'One month',        '🏆', 'Thirty days of choosing yourself.'),
  (60, 'Two months',       '💎', 'The hard part is behind you.'),
  (90, 'Ninety days',      '🎉', 'You did the whole thing. ❤️')
on conflict (day_number) do nothing;

-- -----------------------------------------------------------------------------
-- Motivational messages (Kruti can edit these later in the app)
-- -----------------------------------------------------------------------------
insert into public.motivational_messages (text, min_percent, max_percent) values
  ('One step at a time. ❤️',                              0,   25),
  ('Starting is the hardest part. You''ve got this.',     0,   25),
  ('Just one task to begin. That''s all.',                0,   25),
  ('You''re doing better than you think.',                25,  60),
  ('Keep going — you''re already moving.',                25,  60),
  ('Halfway is closer than you feel.',                    40,  70),
  ('Just one more task.',                                 60,  99),
  ('You''re so close. Finish strong. ❤️',                 60,  99),
  ('Future you will be proud of today''s you.',           60,  99),
  ('You did it. I''m proud of you. ❤️',                   100, 100),
  ('Today''s mission complete. ❤️',                       100, 100)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- The plan + the starting activities
-- These are only defaults — Kruti can change every one of them in the app.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_plan  uuid;
begin
  select id into v_owner from public.profiles where role = 'DHARMIK';
  if v_owner is null then
    raise notice 'No DHARMIK profile yet — create the users first, then re-run this file.';
    return;
  end if;

  select id into v_plan from public.daily_plans where is_active order by created_at limit 1;

  if v_plan is null then
    insert into public.daily_plans (name, owner_id, start_date, goal_days, timezone)
    values ('ReTrack', v_owner, current_date, 90, 'Asia/Kolkata')
    returning id into v_plan;
  end if;

  if not exists (select 1 from public.activities where plan_id = v_plan) then
    insert into public.activities
      (plan_id, name, icon, target_seconds, weight, is_required, requires_photo, sort_order, reminder_time)
    values
      (v_plan, 'Swimming',    '🏊', 60 * 60, 2, true, true, 1, '07:00'),
      (v_plan, 'Treadmill #1', '🏃', 30 * 60, 1, true, true, 2, '09:00'),
      (v_plan, 'Treadmill #2', '🏃', 30 * 60, 1, true, true, 3, '13:00'),
      (v_plan, 'Treadmill #3', '🏃', 30 * 60, 1, true, true, 4, '17:00'),
      (v_plan, 'Current',      '⚡', 90 * 60, 2, true, true, 5, '20:00');
  end if;

  -- Make sure both users have a notification preferences row.
  insert into public.notification_preferences (user_id)
  select id from public.profiles
  on conflict (user_id) do nothing;

  perform public.recalc_daily_progress(v_owner, public.today_local());
end;
$$;
