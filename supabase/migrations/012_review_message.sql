-- =============================================================================
-- 012 — Kruti can say something, not only ask for a fix
--
-- `approve_activity` has always accepted a note and written it to review_note,
-- and four screens already render it. The Approve button just never sent one, so
-- the only thing she could actually put in writing was a correction — approval
-- was silent. A day of work answered by a green tick and nothing else.
--
-- The message on approval needs no new column and no new function: the app was
-- simply calling `approve_activity` without its second argument.
--
-- What is missing is the other moment. She approves during the day, in seconds,
-- and wants to write something later that evening. Calling `approve_activity` a
-- second time would do it, but it re-stamps `reviewed_at`, and "Approved 9:41 PM"
-- would quietly become the time she wrote the message instead of the time she
-- approved. In an app where the server measures everything and nothing is typed
-- in, a timestamp that drifts to suit the UI is the wrong trade.
--
-- So: one function that writes the message and touches nothing else.
-- =============================================================================

create or replace function public.set_review_note(p_submission_id uuid, p_note text)
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

  -- A message rides an approval. While something is still waiting or needs a
  -- fix, the note field is carrying her correction and must not be overwritten
  -- by an afterthought — `request_correction` owns it in that state.
  if v_sub.status <> 'approved' then
    raise exception 'Approve this first, then you can add a message ❤️';
  end if;

  -- Clearing it is allowed: an empty box means she changed her mind.
  update public.activity_submissions
    set review_note = nullif(btrim(p_note), '')
    where id = p_submission_id
    returning * into v_sub;

  -- No recalc. A message is not progress: the percentage, the approval and the
  -- streak are all exactly what they were a moment ago.
  return v_sub;
end;
$$;

comment on function public.set_review_note(uuid, text) is
  'Writes Kruti''s message onto an already approved activity without disturbing
   the approval itself — status, reviewed_by and reviewed_at are untouched.';

revoke all on function public.set_review_note(uuid, text) from public, anon;
grant execute on function public.set_review_note(uuid, text) to authenticated;
