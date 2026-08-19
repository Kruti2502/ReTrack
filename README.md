# ReTrack

A small, private recovery app for two people: **Dharmik**, who is doing the work, and
**Kruti**, who is keeping him company through it.

Dharmik opens the app and immediately sees what today asks of him, how much is done, and
what is left. He starts a timer, finishes it, takes a photo, and sends it. Kruti sees it,
approves it, and at the end of the day writes him something.

> One day at a time. One step at a time. ❤️

---

## Contents

- [What it does](#what-it-does)
- [How it is built](#how-it-is-built)
- [1. Supabase setup](#1-supabase-setup)
- [2. Cloudinary setup](#2-cloudinary-setup)
- [3. Local setup](#3-local-setup)
- [4. Deploying to Vercel](#4-deploying-to-vercel)
- [5. Notifications](#5-notifications)
- [6. Installing the app on a phone](#6-installing-the-app-on-a-phone)
- [How photo compression works](#how-photo-compression-works)
- [How progress is calculated](#how-progress-is-calculated)
- [What "proof" does and does not mean](#what-proof-does-and-does-not-mean)
- [Security model](#security-model)
- [Project structure](#project-structure)
- [Testing checklist](#testing-checklist)
- [Cost](#cost)

---

## What it does

**Dharmik**

- Today's Mission: day number, a large completion ring, what is left, current streak
- Activity cards with Start / Continue / Upload proof / Submit
- A real in-app timer for each activity — pause, resume, several sessions per target
- Photo proof, compressed on the phone before upload
- Submit for approval, then see Kruti's response
- Journey, history, photo gallery, reminders

**Kruti**

- Dharmik's day at a glance with everything waiting for her
- Review each submission: the recorded time, the sessions, the photo
- Approve, or ask for a fix with a note
- Approve the whole day and leave a personal message
- Configure every activity — name, icon, target, weight, required, photo, location, reminder
- History, gallery, analytics, motivational messages

Neither person can approve their own work: only Kruti approves, and the database enforces it.

---

## How it is built

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Routing | React Router |
| Server state | React Query |
| Backend | Supabase (Postgres, Auth, RLS, RPC functions) |
| Photo storage | Cloudinary (compressed images only) |
| Charts | Recharts (lazily loaded) |
| Hosting | Vercel |
| PWA | vite-plugin-pwa (manifest + service worker) |

There is no separate backend server. All the rules — timing, progress, approvals — live in
Postgres functions, so the browser cannot go around them.

---

## 1. Supabase setup

### 1.1 Create the project

1. Go to <https://supabase.com> and create a free project.
2. Choose a region close to you.
3. Note the database password somewhere safe.

### 1.2 Turn off public sign-up

This app is for two people. Nobody else should be able to create an account.

**Authentication → Sign In / Providers → Email**

- Keep **Email** enabled
- Turn **Confirm email** OFF (there are only two accounts, both created by hand)

**Authentication → Sign In / Providers** (or Settings, depending on dashboard version)

- Turn **Allow new users to sign up** OFF

### 1.3 Create the database

Open **SQL Editor** and run these files **in order**, from `supabase/migrations/`:

| File | What it does |
| --- | --- |
| `001_schema.sql` | Tables, indexes, `updated_at` triggers |
| `002_rls.sql` | Row Level Security, role helpers, anon lockout |
| `003_functions.sql` | Every write path: timer, proof, submission, approvals, progress |
| `004_seed.sql` | Milestones, messages, the plan and its first activities |
| `005_require_location.sql` | Makes "ask for location at start" a hard requirement |
| `006_rest_days.sql` | Rest days on the plan; a blank Sunday stops costing the streak |
| `007_optional_target.sql` | An activity may be untimed — the photo is the whole task |
| `008_remove_weight.sql` | Every required activity is worth the same share of the day |
| `009_day_start_hour.sql` | A day runs 6 AM → 6 AM, so late-night training counts for the day it followed |
| `010_backfill.sql` | Kruti can fill in a day the app missed, marked as reconstructed |
| `011_late_night_timer.sql` | At 6 AM the previous day's timer stops, so a forgotten Finish stops blocking Start |
| `012_review_message.sql` | Kruti can approve *with* a message, and add one later without moving the approval time |
| `013_fill_in_today.sql` | Kruti can fill in today by hand too, not only days that have already closed |

Paste each file's contents into a new query and run it. Wait for one to succeed before the
next. `004_seed.sql` needs the two accounts to exist first, so **create the users next and
then re-run `004_seed.sql`.**

### 1.4 Create the two accounts

**Authentication → Users → Add user → Create new user**

Create Dharmik:

- Email: his email
- Password: something you both agree on
- **Auto Confirm User**: yes
- **User Metadata** (click "User Metadata" and paste):

```json
{ "role": "DHARMIK", "display_name": "Dharmik" }
```

Then create Kruti the same way:

```json
{ "role": "KRUTI", "display_name": "Kruti" }
```

A trigger reads that metadata and creates the matching profile. It only ever creates **one**
DHARMIK and **one** KRUTI — a third account with the same metadata gets no profile and no
access.

### 1.5 Run the seed again

Go back to the SQL Editor and run `004_seed.sql` once more. Now that Dharmik's profile
exists, it creates:

- the journey (starting today, 90-day goal, timezone `Asia/Kolkata`)
- the five starting activities (Swimming 60m, Treadmill ×3 30m each, Current 90m)
- notification preference rows

**Change the timezone** if you are not in India — it decides which clock a new day is read
off:

```sql
update public.daily_plans set timezone = 'Asia/Kolkata' where is_active;
```

**A day runs 6 AM → 6 AM**, not midnight to midnight. A shift that ends at 12:30 AM and
training finished at 2–3 AM still count for the day they followed, so nothing has to be
backdated and every record is still stamped live by the server. Both the hour and the
timezone are editable from inside the app (Kruti → Journey settings), or here:

```sql
-- 6 = a day begins at 6 AM. 0 restores plain calendar days.
update public.daily_plans set day_start_hour = 6 where is_active;
```

Every one of those activities is editable from inside the app (Kruti → Manage plan).
Nothing about them is hard-coded.

### 1.6 Get your keys

**Project Settings → API**

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** key → `VITE_SUPABASE_ANON_KEY`

The **service_role** key must never be used in this app. Do not copy it anywhere.

---

## 2. Cloudinary setup

Cloudinary stores the proof photos. It never sees an original — the browser compresses
first.

### 2.1 Create the account

1. Sign up at <https://cloudinary.com> (the free tier is plenty here).
2. On the dashboard, copy the **Cloud name** → `VITE_CLOUDINARY_CLOUD_NAME`.

### 2.2 Create an upload preset

**Settings → Upload → Upload presets → Add upload preset**

| Setting | Value |
| --- | --- |
| Preset name | `our-90-days-proofs` |
| Signing mode | **Unsigned** |
| Asset folder | `our-90-days` |
| Allowed formats | `jpg, jpeg, png, webp` |
| Resource type | **Image** |
| Unique filename | On |
| Overwrite | Off |
| Incoming transformation | *leave empty* |
| Eager transformations | *leave empty* |

Then, still in the preset:

- **Auto-tagging / moderation / backup**: leave off (they cost money)
- **Access mode**: `public`

Save it, and put the name in `VITE_CLOUDINARY_UPLOAD_PRESET`.

Leaving the transformations empty is deliberate: the app displays the stored file exactly as
uploaded, so Cloudinary transformation usage stays at zero.

### 2.3 Folder layout

Photos land in a dated tree, built from the **server's** date:

```
our-90-days/
  dharmik/
    2026/
      08/
        09/
          <photos for August 9>
```

### 2.4 Optional: signed uploads

An unsigned preset is fine for a private two-person app, and it is what the app uses by
default. If you would rather have Cloudinary refuse anything that is not signed by your
server:

1. Deploy to Vercel (the repo already contains `api/cloudinary-signature.ts`).
2. In Vercel, add these **server-only** variables:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Set `VITE_CLOUDINARY_SIGNED_UPLOADS=true`.
4. Change the preset's signing mode to **Signed**.

The signing endpoint requires a valid Supabase access token, so it is not an open signing
service. **The API secret only ever lives in Vercel's environment — never in the browser,
never in `VITE_` variables, never in git.**

---

## 3. Local setup

```bash
npm install
cp .env.example .env      # then fill in the four VITE_ values
npm run dev
```

Open <http://localhost:5173>.

If `.env` is missing something, the app tells you exactly which variable instead of showing
a blank page.

Other commands:

```bash
npm run build       # typecheck + production build
npm run preview     # serve the production build locally
npm run typecheck   # types only
```

---

## 4. Deploying to Vercel

1. Push the project to GitHub. `.gitignore` already keeps `.env` out.
2. Go to <https://vercel.com> → **Add New → Project** → import the repository.
3. Vercel detects Vite. Leave the defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Under **Environment Variables**, add the four public values:

   ```
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   VITE_CLOUDINARY_CLOUD_NAME
   VITE_CLOUDINARY_UPLOAD_PRESET
   ```

   (plus the server-only ones from §2.4 if you chose signed uploads)
5. Click **Deploy**.
6. Open **Supabase → Authentication → URL Configuration** and add your Vercel URL to
   **Site URL** and **Redirect URLs**.

`vercel.json` already handles SPA routing, sends the service worker with a no-cache header,
and sets sensible security headers.

To deploy from the terminal instead:

```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

---

## 5. Notifications

Free browser/PWA notifications only. No SMS, no WhatsApp, no paid provider.

**To turn them on:** Profile (Dharmik) or Settings (Kruti) → **Turn on reminders** → allow
when the browser asks.

You can then configure:

- activity reminders (each activity has its own reminder time, set by Kruti)
- a daily summary at a time you choose
- a nudge when the day is still unfinished

**An honest limitation.** There is no push server, so reminders are scheduled by the app
itself and arrive while it is open or recently used in the background. This keeps the whole
thing free. When a notification cannot be delivered, the app falls back to an in-app
reminder card on the home screen, so nothing is silently lost.

Installing the app to the home screen (below) makes reminders noticeably more reliable.

- **Android / Chrome**: works well once installed.
- **iOS**: notifications require the app to be installed to the Home Screen (iOS 16.4+).
- **Blocked notifications**: the app says so and keeps using the in-app fallback.

---

## 6. Installing the app on a phone

**Android (Chrome)**

1. Open the deployed URL.
2. Tap the **Install** banner in the app, or the ⋮ menu → **Install app** / **Add to Home
   screen**.
3. It now opens full screen, like any other app.

**iPhone (Safari)**

1. Open the deployed URL in **Safari** (not Chrome).
2. Tap the **Share** button.
3. **Add to Home Screen** → **Add**.

The app is named **ReTrack**, uses a standalone window, and works in portrait on a
phone screen.

---

## How photo compression works

This is the part that keeps storage small, and it all happens **before** anything is
uploaded. See `src/lib/compressImage.ts`.

```
4 MB photo from the camera
        ↓  decoded in the browser (EXIF rotation applied)
        ↓  resized only if the long edge is over 1600px — aspect ratio preserved, never cropped
        ↓  encoded to WebP (or JPEG), binary-searching quality for the largest that fits
   ~100–300 KB
        ↓  uploaded to Cloudinary
```

The rules it follows:

- **Never crops.** Only proportional scaling; the composition is untouched.
- **Targets 100–300 KB.** The search stops as soon as it is inside that band.
- **Leaves small photos alone.** Anything already under ~260 KB with sensible dimensions is
  passed through untouched, so an already-compressed image is never compressed twice.
- **Quality wins ties.** If a detailed photo cannot reach 300 KB without dropping below a
  900px long edge, it keeps the larger file rather than becoming unreadable.
- **Only the compressed file is uploaded.** The original is released from memory as soon as
  the compressed copy exists, and the file input is cleared.

EXIF (camera, date taken) is read from the original before re-encoding and stored as extra
context — see the note in [What "proof" does and does not mean](#what-proof-does-and-does-not-mean).

What Supabase stores for each photo: Cloudinary public ID, secure URL, activity, session,
user, server upload timestamp, byte size, dimensions, original filename, original size, and
any EXIF summary. Never the image bytes.

**Photos are never deleted automatically** — not after 90 days, not after a year. Only a
person can remove one, and only before it has been submitted (or Kruti, any time).

---

## How progress is calculated

Entirely in Postgres, in `recalc_daily_progress`. The browser never sends a percentage.

For each activity:

```
completion = min(1, completed_seconds / target_seconds)
```

Capped at 100% per activity — 40 minutes on a 30-minute target is 100%, not 133%.

For the day, over **required** activities only, weighted:

```
percent = 100 × Σ(weight × completion) / Σ(weight)
```

Only **finished** sessions count. A running timer shows on screen but does not count until
it is finished.

**Streaks** increase only when all three are true for a day:

1. every required activity is completed,
2. every one of them is approved by Kruti,
3. the day itself is approved by Kruti.

A missed day pauses the streak. It never deletes history, and the app never says anything
unkind about it — it says *"Today didn't go as planned. Tomorrow is another chance. ❤️"*

---

## What "proof" does and does not mean

This app **cannot** prove that someone physically did an activity, and it does not claim to.
What it does is make a false claim inconvenient enough to be pointless between two people who
trust each other:

1. **In-app timer** — you cannot type "I did 30 minutes"; the clock has to run.
2. **Server timestamps** — every start, pause, resume and finish is stamped by the database,
   not the phone. A device with the wrong clock changes nothing.
3. **Photo proof** — required per activity, if Kruti asks for it.
4. **The photo is tied to a session** — a proof must match a real session of that activity on
   that day.
5. **Kruti approves each activity** — with the time, the sessions and the photo in front of her.
6. **Kruti approves the day** — a separate, final step.

Optionally, Kruti can switch on **"ask for location at start"** for an activity. When she does,
it is a requirement rather than a hint: Dharmik is asked to share his location before the timer
will start, the point is sent with the very request that opens the session, and there is no skip.
The database enforces the same rule — `start_activity_session` refuses to open a session for such
an activity without a valid point, and `resume_activity_session` refuses to continue one that has
none — so a modified client cannot start the clock around it.

It is still a single reading, taken at the moment of starting. It never watches location and never
tracks in the background. Kruti sees the exact point next to the session, with its accuracy, the
time it was sent, and a link that opens it on a map — so for Swimming she can tell that he was at
the pool when the clock started.

EXIF timestamps are stored when the camera provides them, but they are trivially editable, so
they are labelled as extra information and are never treated as evidence. The server upload
time is the one that counts, and no user can change it.

---

## Security model

**Authentication.** Supabase Auth, email + password, sign-up disabled. Two accounts, created
by hand. A `profiles_role_unique` index means there can only ever be one DHARMIK and one
KRUTI.

**Authorization.** Route guards keep the wrong screen from rendering, but they are not the
boundary. The boundary is the database:

- Every table has Row Level Security enabled.
- `anon` has been revoked from every table and function.
- The browser gets `SELECT` policies, and that is nearly all it gets. There are deliberately
  **no** insert or update policies on `activity_sessions`, `activity_proofs`,
  `activity_submissions`, `daily_progress` or `daily_approvals`.
- Every write goes through a `SECURITY DEFINER` function that re-checks the caller's role.

Which means, concretely:

| Attempt | Result |
| --- | --- |
| Dharmik calls `approve_activity` | `Only Kruti can approve or review` |
| Dharmik calls `approve_day` | `Only Kruti can approve or review` |
| Dharmik `UPDATE daily_progress SET percent = 100` | 0 rows — no policy allows it |
| Dharmik `INSERT INTO activity_sessions` with 99999 seconds | permission denied |
| Dharmik `UPDATE activity_submissions SET status = 'approved'` | 0 rows |
| Dharmik adds himself a free activity | permission denied |
| Kruti starts a timer as Dharmik | `Only Dharmik can do this` |
| Signed-out visitor reads anything | permission denied |
| Submitting an approved activity again | `Already approved — nothing to resubmit ❤️` |

These are not hopes — they are the actual messages, checked against a real Postgres instance
while building this.

**Secrets.** The browser only ever holds the Supabase URL, the anon key, the Cloudinary cloud
name and the upload preset — all public by design. The Cloudinary API secret and the Supabase
service-role key appear nowhere in `src/`, nowhere in any `VITE_` variable, and nowhere in git.

**Offline.** The service worker caches the app shell and already-uploaded photos. It never
caches API or auth traffic, so being offline can never be used to skip a server-side check.

---

## Project structure

```
.
├── api/
│   └── cloudinary-signature.ts   Optional signed uploads (Vercel function, server-only secret)
├── public/
│   ├── favicon.svg
│   └── icons/                    PWA icons, including a maskable one
├── supabase/migrations/
│   ├── 001_schema.sql            Tables, indexes, triggers
│   ├── 002_rls.sql               RLS policies, role helpers, anon lockout
│   ├── 003_functions.sql         All write paths + read bundles
│   ├── 004_seed.sql              Milestones, messages, plan, activities
│   ├── 005_require_location.sql  Location-at-start enforced in the database
│   ├── 006_rest_days.sql         Rest days on the plan, and how streaks read them
│   ├── 007_optional_target.sql   Untimed activities, measured by their photo
│   ├── 008_remove_weight.sql     A flat share per required activity
│   ├── 009_day_start_hour.sql    The 6 AM day boundary for late-night training
│   └── 010_backfill.sql          Kruti-only repair for a day that was never logged
├── src/
│   ├── api/                      One module per domain, wrapping Supabase
│   │   ├── day.ts                get_day / journey stats / history
│   │   ├── timer.ts              start, pause, resume, finish, discard, location
│   │   ├── proof.ts              compress → upload → record, and the gallery
│   │   ├── review.ts             submit, approve, request correction, approve day
│   │   ├── plan.ts               activities and journey configuration
│   │   └── settings.ts           profiles, messages, notification preferences
│   ├── components/
│   │   ├── ui/                   ProgressRing, Modal, Feedback primitives
│   │   ├── ActivityCard.tsx      Dharmik's card, with live timer
│   │   ├── ReviewCard.tsx        Kruti's card, with approve / ask-to-fix
│   │   ├── TimerPanel.tsx        Start / pause / resume / finish
│   │   ├── LocationGate.tsx      Mandatory location before a timer can start
│   │   ├── SessionLocation.tsx   The shared point, its accuracy and a map link
│   │   ├── PhotoUploader.tsx     Compress → preview → upload
│   │   ├── ProofGrid.tsx         Photo thumbnails and viewer
│   │   ├── Analytics.tsx         Weekly and monthly charts
│   │   └── …                     Nav, shell, banners, guards
│   ├── context/                  Auth and toast providers
│   ├── hooks/
│   │   ├── queries.ts            React Query keys, hooks, shared invalidation
│   │   ├── useLiveTimer.ts       Ticking display, corrected for device clock drift
│   │   └── useReminders.ts       Scheduling and the in-app fallback
│   ├── lib/
│   │   ├── compressImage.ts      The compression utility
│   │   ├── cloudinary.ts         Upload, folder layout, optional signing
│   │   ├── exif.ts               Small EXIF reader
│   │   ├── geolocation.ts        One-shot location read, formatting, map links
│   │   ├── activityStatus.ts     Raw day data → card state
│   │   ├── notifications.ts      Permission, delivery, de-duplication
│   │   ├── supabase.ts           Client + readable error messages
│   │   ├── format.ts             Clock, duration and date formatting
│   │   └── env.ts                Public environment variables only
│   ├── pages/
│   │   ├── TodaysMission.tsx     Dharmik's home
│   │   ├── ActivityDetail.tsx    Timer, proof, submission
│   │   ├── Journey.tsx           90 days, milestones, analytics
│   │   ├── History.tsx           Month by month
│   │   ├── DayDetail.tsx         One day, exactly as it happened
│   │   ├── Gallery.tsx           Our Journey 📷
│   │   ├── Profile.tsx           Name, emoji, reminders
│   │   └── kruti/                Dashboard, Review, Manage plan, Settings
│   └── types/db.ts               Types mirroring the schema
├── .env.example
└── vercel.json
```

---

## Testing checklist

**Dharmik**

1. Sign in → Today's Mission shows day number, percentage, what is left
2. Start an activity → the timer runs
3. Pause → the number holds; Resume → it continues
4. Finish → the session is recorded and the percentage moves
5. Start the same activity again → a second session adds to the same total
6. Upload proof → *Compressing photo…* → preview with before/after size → *Uploading proof…*
   → *✅ Proof uploaded*
7. Submit for approval → **Waiting for Kruti**
8. Try to submit without a photo → refused
9. Complete everything → 100% and *Today's mission complete*

**Kruti**

10. Sign in → Dharmik's day, with anything waiting highlighted
11. Open a proof photo, check the recorded sessions
12. **Ask to fix** with a note → Dharmik sees it and can resubmit
13. **Approve** each activity
14. **Approve today** with a message → Dharmik sees it on his home screen
15. Streak increases
16. Manage plan: add, edit, archive an activity; change a target; set a reminder
17. History, gallery and analytics all fill in

**Security** (browser devtools, or the SQL editor)

18. Dharmik cannot approve anything — the database refuses
19. `UPDATE daily_progress SET percent = 100` from the client changes nothing
20. Fabricating a session insert is denied
21. Signing out and calling anything returns permission denied
22. `VITE_` variables contain no secret; the Cloudinary API secret is nowhere in the bundle

---

## Cost

Everything here fits in free tiers:

- **Supabase** free tier — the database is tiny (no images in it)
- **Cloudinary** free tier — at ~200 KB per photo and ~5 photos a day, a full year is roughly
  350 MB
- **Vercel** free tier
- **Notifications** — browser only, nothing paid

The 90 days are a goal, not an expiry. The journey keeps counting past day 90, history is
never deleted, and photos are kept for as long as you want them.

---

Built for two people. ❤️
