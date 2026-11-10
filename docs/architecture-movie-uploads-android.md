# Architecture: uploaded movies, watching them together, and the Android app

Written 10 November 2026 for the builder who will implement it. Nothing in this document is built yet. Read it top to bottom before writing code: part 1 explains how the watch party app works today, and every later part builds on it without replacing it.

The repository is `Creovex/Watchparybuild`. Internally the code is called "watchparty" (the `@watchparty/` package scope, storage keys); people see the name set in `NEXT_PUBLIC_APP_NAME`, currently "Synvello" (see "Product name" in `docs/decisions.md`). This document says "the app".

Everyone writing in this repository follows `docs/WRITING_RULES.md`: no version numbers in prose, no dashes between words, every acronym defined the first time, every gap tracked by name. The new gaps found while writing this document are G44 to G52 in part 13; copy them into `docs/gaps.md` when the work starts.

## Contents

1. How the app works today
2. What is being added
3. Decisions and the options turned down
4. Staying inside the free plans
5. Database changes
6. New Edge Functions
7. Uploading a movie
8. Watching a movie together
9. Deleting a movie
10. Inviting people
11. Making the app easier to use
12. The Android app
13. Gaps and open questions
14. Build order and acceptance checks
15. Files this work touches

---

## 1. How the app works today

### 1.1 The parts

| Part | Path | What it does |
|---|---|---|
| Web app | `apps/web` | Next.js (a React framework) site: start page, rooms list (`/home`), new room (`/new`), the room (`/r/[slug]`), settings, plans. Hosted on Vercel. |
| Sync core | `packages/sync-core` | Pure TypeScript shared by everything: zod schemas (zod is a validation library), the server clock offset, the expected position formula, the sync engine, reactions, room rules. |
| Room client and UI | `packages/ui` | Design tokens, components, and `src/room/controller.ts`, the `RoomController` that joins a room, holds the realtime channels and drives the engine. Used by the room page and the extension panel. |
| Voice | `packages/voice` | One interface, two implementations: mesh (WebRTC, the browser standard for live audio and video, directly between people, for rooms of 3) and server (LiveKit, a hosted voice server, for rooms of 10). |
| Sync extension | `apps/extension` | Chrome and Edge extension that drives the video element inside Netflix, Prime Video and Disney+ tabs. Not involved in uploaded movies. |
| Database | `supabase/migrations` | 32 migrations: tables, RLS (Row Level Security, Postgres rules about which rows a user may read), RPCs (Remote Procedure Calls, database functions the client calls), triggers, scheduled jobs. |
| Edge Functions | `supabase/functions` | Deno functions for anything that needs a secret: `turn-credentials`, `livekit-token`, `moderate`, `delete-account`. Shared code in `_shared` (CORS, the request pipeline, clients, the voice access check). |
| Tests | `supabase/tests`, `e2e`, each package's `test` | pgTAP database tests, the realtime authorization test, Deno function tests, Vitest unit tests, Playwright end to end tests E1 to E15. |

Hosting: Supabase free project `synvello` (reference `zkemdupefosllskayozr`) and Vercel.

### 1.2 Accounts and plans

1. Sign in is Google only, through Supabase Auth. Guests must sign in too (open question Q6 in `docs/gaps.md`; the database rules assume a signed in user). The start page passes `?next=` so someone who opens a room link, signs in, and comes back lands in that room.
2. A trigger on `auth.users` creates a `profiles` row: display name, avatar, `plan` (`free` or `paid`), `duck_level`. Clients may change only `display_name` and `duck_level`; column grants and a guard trigger enforce this.
3. `plan` becomes `paid` only when James edits the row in the dashboard (gap G8). A free host's rooms have 3 seats and mesh voice; a paid host's rooms have 10 seats and server voice. The cap is fixed when the room is created.

### 1.3 Rooms, links and joining

1. `create_room(title, source, content_ref, visibility, control_mode)` creates the room, the host's member row, the `playback_state` row (paused at 0, `seq` 0) and, for a private room, a 128 bit join key in `room_secrets`, which no client can read.
2. `source` is one of `youtube`, `netflix`, `prime`, `disney`. `content_ref` is the YouTube video id or the https address of the title, checked by `public.valid_content_ref` in SQL and `parseContentRef` in `packages/sync-core/src/content-ref.ts`. The two must always agree.
3. The room link is `<site_url>/r/<slug>`, plus `#k=<join key>` for a private room. The key sits in the fragment, so it never reaches a server log. The room page moves it into `sessionStorage` and removes it from the address bar (`app/r/[slug]/key.ts`).
4. `join_room(slug, join_key, sync_mode)` locks the room row and checks, in order: closed, banned, removed, the key (not asked of the host or of someone already joined), locked, and the seat cap. It returns the room, the playback state, the channel epoch and a new `engine_session`. Only the browser holding the current `engine_session` may act for that member.
5. `touch_member` runs every 20 seconds. A member is "present" while `last_seen_at` is under 60 seconds old.
6. Hosts can change settings (`update_room_settings`), change what is playing (`set_source`, which resets playback to paused at 0), hand over host, lock, close, rotate the key, and moderate (remove, ban, mute, allow back) through the `moderate` Edge Function.
7. Scheduled jobs (pg_cron, Postgres's built in scheduler): hand host to a present guest when the host has been gone for a minute, close rooms nobody has been in for 30 minutes, and clear stale buffering flags.

### 1.4 How sync works

1. **One shared record.** `playback_state` holds `status` (playing, paused, ended), `position_sec`, `rate`, `server_ts` (the moment the position applies) and `seq`. Every change goes through `set_playback` with the `seq` the caller last saw; a stale `seq` is refused, so two people pressing play at once cannot both win.
2. **One clock.** Each client calls `server_time()` five times and keeps the sample with the shortest round trip to estimate its offset from the database clock (`clock.ts`), and measures again every minute.
3. **Expected position.** Everyone computes where the film should be now: `position_sec + (server_now - server_ts) * rate` while playing (`position.ts`). A start can be scheduled up to 5 seconds ahead (the countdown).
4. **The engine.** `SyncEngine` (`engine.ts`) runs every 250 ms. Once a second it compares the player with the expected position: above 2 seconds of drift it seeks; between 0.15 and 2 seconds it plays at 95 or 105 percent speed until the gap is under 0.05 seconds; while paused it seeks back if more than 0.3 seconds out.
5. **The player adapter.** The engine never touches a player directly. Every player implements `PlayerAdapter` (`packages/sync-core/src/adapter.ts`): load, play (which may return `blocked` when the browser refuses autoplay), pause, seek, rate, volume, position, duration, buffering, ended, and callbacks for user actions. The adapters today are YouTube (`apps/web/lib/adapters/youtube.ts`), the extension's video element adapter, and `StubAdapter` (`apps/web/lib/adapters/stub.ts`), an HTML5 `<video>` over a local test file used only by end to end tests. **The stub already proves that a plain video file syncs with the existing engine.** The uploaded movie player in part 8 is a production version of it.
6. **Who controls.** `control_mode` `host` lets only the host play, pause and seek; `everyone` lets any member.
7. **Wait for everyone.** When a member's player buffers for more than 1.5 seconds, the "elected" member (the present auto sync member who joined first) pauses the room with reason `buffer` and resumes it once nobody has been buffering for 1 second.
8. **Cue sync.** Phones cannot run the extension, so members of Netflix, Prime and Disney+ rooms on phones follow by hand ("cue sync"). Uploaded movies play in the page, so every member, phones included, gets auto sync.

### 1.5 Realtime channels

Each room has two private Supabase Realtime channels, authorized by policies on `realtime.messages`:

| Topic | Who writes | Events |
|---|---|---|
| `room:<room_id>:<epoch>:server` | Only the database, through triggers | `state` (playback changes), `room` (title, source, content, settings, status, host), `members`, `chat`, `moderation` |
| `room:<room_id>:<epoch>:client` | Members | `heartbeat` every 5 seconds, `reaction`, `rtc` (voice signalling), plus presence |

Removing or banning someone moves the room to a new epoch, so the removed person cannot join the new topics.

### 1.6 Chat, timed comments and reactions

1. `send_chat` stores messages, at most 5 per 5 seconds per person. A message with a `position_sec` is a timed comment and pops up at that moment of the film for everyone.
2. Reactions are 8 emoji (`REACTION_EMOJI` in `schemas.ts`: ❤️ 😂 😮 😢 😡 👏 🔥 🍿). They are broadcast on the client topic, never stored, limited to 3 per second per sender (`ReactionLimiter`), and float for 2 seconds in a band beside the picture, never on top of it (`ReactionTray`, `ReactionBand`). **Emoji reactions already work and need no new backend for uploaded movies.** The only change is how they show in full screen (part 8.6).

### 1.7 Voice

Mesh voice uses Cloudflare Realtime TURN credentials (TURN is a relay for WebRTC when a direct path is blocked) from `turn-credentials`. Server voice uses LiveKit tokens from `livekit-token`. Movie volume drops ("ducking") while someone speaks, when the player lets script set its volume.

### 1.8 Security model in one paragraph

Clients read only through RLS policies and views, and write only through SECURITY DEFINER RPCs (they run as their owner after their own checks) or Edge Functions. Every RPC returns `{ ok, data }` or `{ ok: false, code, data }`; codes map to plain sentences in `apps/web/lib/errors.ts`. Secrets live only in Edge Function secrets. The web app's Content Security Policy (the browser rule listing which sites a page may load from) is built in `apps/web/proxy.ts`.

### 1.9 The app on a phone

The app is a PWA (Progressive Web App: a site that can be installed to the home screen). `app/manifest.ts` starts it at `/home` in standalone mode; there is no service worker. It keeps the screen on in a room (Screen Wake Lock), has a "Join a room" box for pasted links (an installed app has no address bar), and suggests installing once.

---

## 2. What is being added

### Goals

1. A signed in account that James allows can upload its own movie files, see them in a library with a poster, and delete them at any time to make room for others.
2. The owner starts a room from a movie in one tap and invites people; two or more people watch it in sync, with the existing voice, chat, timed comments and emoji reactions.
3. A downloadable Android app that does everything the website does, because it is the website.
4. Everything runs on the Supabase free plan and the Cloudflare R2 free tier, with hard limits in the app so neither bill grows by accident.
5. The app gets easier to use for first timers (part 11).

### Not in scope

1. Converting video formats on a server (transcoding). Uploads must already be browser playable (part 7.2).
2. Google Drive (part 3).
3. Public movie libraries or browsing other people's movies. A movie is visible only to its owner and to members of a room playing it.
4. An iPhone app. iPhone users keep the website and the home screen PWA.
5. Offline viewing and background uploads after the app is closed.

---

## 3. Decisions and the options turned down

| Question | Decision | Why |
|---|---|---|
| Where the movie files live | **Cloudflare R2**, one private bucket | Free tier: 10 GB-month of storage, 1 million Class A (write) and 10 million Class B (read) operations a month, and no charge for downloads however many people watch. Supports multipart uploads, HTTP Range requests (needed for seeking) and presigned URLs, which are links signed with a secret that work for a set time. |
| Supabase Storage for movies | **No** | The free plan caps a file at 50 MB and total storage at 1 GB; a film is 1 to 4 GB. |
| Supabase Storage at all | **Yes, for posters** (and subtitles later) | Posters are about 100 KB each; 1 GB holds thousands. Storage policies can reuse the room membership rules already in SQL. |
| Supabase for everything else | **Yes, free plan** | Accounts, the movie library records, rooms, sync, chat, reactions and functions stay where they are. Movie bytes never pass through Supabase, so its 5 GB egress allowance (data sent out) is not touched by watching. |
| Google Drive | **No** | Drive is not built to stream into another website: large files hit the "can't scan for viruses" page, popular files get throttled, and each viewer needs the file shared with their own Google account. |
| Who talks to R2 | **The browser, with presigned URLs from Edge Functions** | Edge Functions on the free plan stop after 150 seconds of wall clock time and 2 seconds of CPU time, so a file can never pass through one. Functions only sign URLs and record state. |
| Video formats | **MP4 (H.264 video, AAC audio) and WebM (VP9 or AV1 video, Opus audio)**, checked in the browser before upload | These play in Chrome on Android and desktop, Edge and Safari. MKV (Matroska) does not play reliably; HEVC (H.265) plays on iPhone but only on some Chrome devices; AC-3 and E-AC-3 audio, common in ripped films, give a silent picture in Chrome. |
| The player | **A new `Html5VideoAdapter`** built from `StubAdapter` | Plugs into the existing engine unchanged. |
| The Android app | **A Trusted Web Activity (TWA) built with Bubblewrap** | A TWA is an Android app that opens the site in Chrome without the address bar. Google sign in, WebRTC voice, uploads and the wake lock work as they do in Chrome, and site changes reach the app without a new APK (the Android app file). |
| Capacitor (a native shell around a WebView) | **No, for now** | Google blocks its sign in page inside embedded WebViews (`disallowed_useragent`), so it would need a native sign in flow; it is also more native code to maintain. Revisit only if background uploads or push notifications become a goal. |

---

## 4. Staying inside the free plans

Limits read from the official pages on 10 November 2026. Recheck them before launch; they change.

| Service | Limit | What the app does |
|---|---|---|
| R2 storage | 10 GB-month free; billed beyond, with no hard cap on Cloudflare's side | A site wide cap in `app_config` (`movie_storage_cap_bytes`, default 9,000,000,000 bytes, leaving headroom), checked with a lock before every upload. That is about 3 to 5 films in total, for everyone. |
| R2 Class A operations (writes, list) | 1 million a month | Uploads use 16 MiB parts (MiB: 1,048,576 bytes): a 4 GB film is about 240 part uploads. Fine. |
| R2 Class B operations (reads) | 10 million a month | Each Range request from a `<video>` counts. A film watched by 4 people is a few thousand. Fine. |
| R2 enable | Needs an R2 subscription at checkout; expect a payment card to be asked for (gap G44) | James adds the card; the app's cap keeps usage in the free tier. |
| Supabase database | 500 MB | A movie row is under 1 KB. |
| Supabase Storage | 1 GB, 50 MB per file | Posters capped at 300 KB each. |
| Supabase Edge Functions | 500,000 invocations a month | Uploads call a function about once per 50 parts; playback once per member per room join. |
| Supabase Realtime | 200 concurrent connections, 100 messages a second | Unchanged by this work. |
| Supabase pause | A free project pauses after a week with no activity (gap G7). This happened to `synvello`, and James restored it on 10 November 2026. | Unchanged. R2 files survive a pause, but nobody can sign in, start a room or get a play URL while the project is paused. Before building, check that the restored project still has all 32 migrations, the 4 functions and the 3 scheduled jobs ("Hosted preview project" in `docs/decisions.md`). |

Per account: `profiles.upload_quota_bytes`, default 0, which means "may not upload". James sets it in the dashboard for himself and anyone he trusts, as he does with `plan`. Without this, any stranger who signs in could fill the 9 GB.

---

## 5. Database changes

One new migration per concern, after `20261011003200`, following "How every RPC is built" and "Lock order inside RPCs" in `docs/decisions.md`. Below are the shapes; the builder writes the full SQL and pgTAP tests.

### 5.1 `upload` becomes a source

1. `packages/sync-core/src/schemas.ts`: add `'upload'` to `SOURCES`. It is **not** in `PAID_SOURCES`, so `isPaidSource('upload')` is false and the room page joins on auto sync (`syncModeFor` in `RoomEntry.tsx`).
2. `content-ref.ts`: `parseUploadRef` accepts a lowercase UUID (universally unique identifier, the movie id). `SOURCE_LABEL.upload = 'My movies'`. `contentUrl` is not used for uploads.
3. Migration `..._source_upload.sql`:
   - Replace the `rooms.source` check with one that includes `upload`.
   - `valid_content_ref('upload', ref)` returns `ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`.
   - `create_room` and `set_source`: accept `upload`, and when the source is `upload` with a non null ref, require that `movies.id = ref`, `movies.owner_id = auth.uid()` and `movies.status = 'ready'`, otherwise `movie_unavailable`. Only the owner can put their movie in a room. After a host transfer the room keeps playing the movie; the new host cannot pick the old host's other movies.
   - Add `movie_unavailable` to the error codes in `schemas.ts` and a sentence in `apps/web/lib/errors.ts`.
   - `room_preview` also returns the movie title for `upload` rooms, so the join screen can say what is on.

### 5.2 `movies`

```sql
create table public.movies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'deleting', 'failed')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5368709120), -- 5 GiB
  content_type text not null check (content_type in ('video/mp4', 'video/webm')),
  duration_sec double precision check (duration_sec is null or duration_sec > 0),
  width integer, height integer,
  object_key text not null unique,      -- 'm/<owner_id>/<movie_id>.<mp4|webm>', set by the server
  upload_id text,                       -- R2 multipart upload id while uploading, else null
  part_size integer not null default 16777216,
  poster_path text,                     -- 'posters/<owner_id>/<movie_id>.jpg' in Supabase Storage
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  status_changed_at timestamptz not null default clock_timestamp()
);
create index movies_by_owner on public.movies (owner_id, created_at desc);
```

Access:

1. RLS on. Policy "movies: the owner reads their own rows" (`owner_id = auth.uid()`). Grant select to `authenticated` on every column except `upload_id` and `object_key` (column grants, as `profiles` does).
2. No client insert, update or delete. All writes go through the Edge Functions in part 6, which call service role only RPCs.
3. View `room_movie` (owner's rights plus `security_barrier`, like `profile_public`, gap G24): `id, title, duration_sec, width, height, poster_path` for movies that are the `content_ref` of an `upload` room where the caller `is_member`. The room shows title and poster from here.
4. Helper `public.can_view_movie(movie_id uuid) returns boolean`: the owner, or a joined member of an open room playing it. Used by the poster storage policy and by `movie-play-url`.

### 5.3 Quotas

1. `profiles.upload_quota_bytes bigint not null default 0 check (upload_quota_bytes >= 0)`. Add it to the columns the guard trigger refuses to let clients change. It is not in the client update grant.
2. `app_config` row `movie_storage_cap_bytes` = `9000000000`.
3. Used space counts every movie in `uploading`, `ready` or `deleting`, at its declared `size_bytes`. An upload reserves its full size when it starts, so two parallel uploads cannot both squeeze under the cap.

### 5.4 Service role RPCs (Edge Functions call these; clients cannot)

Each one `revoke execute ... from public, anon, authenticated` and `grant execute ... to service_role`, takes the caller's user id as an argument, and returns the usual envelope.

| RPC | Does | Codes |
|---|---|---|
| `movie_reserve(owner, title, size_bytes, content_type, duration_sec, width, height)` | Locks the `app_config` cap row (one global lock serialises reservations), then the owner's profile. Refuses when the quota is 0, when the owner's used space plus the size exceeds their quota, when the site total exceeds the cap, or when the owner already has an `uploading` movie (one upload at a time). Inserts the row with a server built `object_key`. | `upload_not_allowed`, `quota_exceeded` (data: used, quota), `storage_full` (data: used, cap), `upload_in_progress`, `invalid_input` |
| `movie_set_upload_id(movie_id, upload_id)` | Stores the R2 multipart id. | `not_found` |
| `movie_mark_ready(owner, movie_id, actual_size)` | Requires `uploading` and `actual_size = size_bytes`; sets `ready`, `ready_at`, clears `upload_id`. | `not_found`, `size_mismatch` |
| `movie_mark_failed(movie_id)` | Sets `failed`. Failed rows hold no space. | |
| `movie_begin_delete(owner, movie_id)` | Owner only. Sets `deleting`; for each open `upload` room playing it, clears `content_ref` and resets playback exactly as `set_source` does, so the `room` and `state` triggers tell every member. Returns the object key and poster path. | `not_found` |
| `movie_finish_delete(movie_id)` | Deletes the row. | |

### 5.5 Scheduled clean up

Add to `job_functions.sql` and `cron_schedule.sql`: every hour, mark `failed` any `uploading` movie whose `status_changed_at` is more than 24 hours old (the R2 lifecycle rule in part 7.6 removes its parts), and delete `failed` rows older than 7 days. A `deleting` row older than an hour means a delete stopped halfway; `movie-delete` can be called again for it, and the library shows it with a "Finish deleting" button.

### 5.6 Account deletion

`delete-account` must, before closing rooms and deleting the user, delete every R2 object and poster of the user's movies (using the same code as `movie-delete`). Otherwise the `on delete cascade` removes the rows and leaves the files in R2, counting against the 10 GB forever.

---

## 6. New Edge Functions

All use the existing `_shared` pipeline: CORS from `SITE_URL` and `PREVIEW_URL`, POST only, the JWT checked with `auth.getUser`, zod input, the function code list kept in step with `FUNCTION_CODES`. Each has a `handler.ts` factory taking its dependencies, including an `r2` object, so the Deno tests use a fake R2.

New secrets (Edge Function secrets only, never `NEXT_PUBLIC_`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_ENDPOINT` (defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; tests point it at a local S3 compatible server).

Signing: `aws4fetch` (a small signing library on `fetch` and Web Crypto) with service `s3`, region `auto`, `signQuery: true` and `X-Amz-Expires`, as Cloudflare's own example does. It has no Supabase specific confirmation (gap G48): prove one real upload and one real Range request from a deployed function before building the rest.

Presigned URLs must use the `<account_id>.r2.cloudflarestorage.com` host; R2 does not presign custom domains.

| Function | Input | Output | Notes |
|---|---|---|---|
| `movie-upload-start` | `{ title, size_bytes, content_type, duration_sec, width, height }` | `{ movie_id, part_size, part_count }` | `movie_reserve`, then R2 CreateMultipartUpload with the content type, then `movie_set_upload_id`. If R2 fails, `movie_mark_failed` and answer `internal`. |
| `movie-upload-urls` | `{ movie_id, part_numbers: number[] }` (at most 50) | `{ urls: { [part]: url }, uploaded: [{ part_number, etag, size }] }` | Owner and `uploading` only. Presigned UploadPart URLs valid 1 hour. `uploaded` comes from R2 ListParts, so a resumed upload skips finished parts. |
| `movie-upload-complete` | `{ movie_id, parts: [{ part_number, etag }] }` | `{ movie }` | CompleteMultipartUpload, then HeadObject. If the stored size differs from `size_bytes`, delete the object, mark failed, answer `size_mismatch`. Else `movie_mark_ready`. |
| `movie-upload-abort` | `{ movie_id }` | `{}` | AbortMultipartUpload, `movie_mark_failed`. |
| `movie-delete` | `{ movie_id }` | `{}` | `movie_begin_delete`, DeleteObject (a missing object counts as deleted), delete the poster from Supabase Storage, `movie_finish_delete`. Safe to call again after a failure. |
| `movie-play-url` | `{ room_id, engine_session }` or `{ movie_id }` | `{ url, expires_at }` | Room form: the caller is a joined member with that `engine_session` in an open `upload` room whose movie is `ready` (same check as `turn-credentials`). Library form: the owner, for a preview. Presigned GetObject valid 6 hours. |

Rate limits (a counter table or the member row, as `send_chat` does): `movie-upload-start` 10 an hour per user, `movie-play-url` 60 an hour per user.

---

## 7. Uploading a movie

### 7.1 Where

A new page `/movies` ("Your movies"), linked from the rooms page header and the new room form. It lists the owner's movies with poster, title, length, size, status, a "Watch together" button and a delete button, a storage meter ("3.1 GB of your 4 GB, 5.2 GB of 9 GB on the site"), and an "Upload a movie" button. An account with quota 0 sees one line explaining that uploads are invite only and no button.

### 7.2 Checks in the browser before anything is sent

`apps/web/lib/movie-check.ts`, unit tested with small fixture files:

1. File type `.mp4`, `.m4v` or `.webm`, at most 5 GiB and within the remaining quota. Otherwise say why in one sentence.
2. Read the codecs with mp4box.js (a library that reads MP4 headers in the browser; check its licence before adding it, as `decisions.md` does for every package). Accept video `avc1` (H.264), `vp09`, `av01`; audio `mp4a` (AAC) or `Opus`. Refuse `hvc1`/`hev1` (HEVC) and `ac-3`/`ec-3` audio with: "This file's video or sound format won't play in every browser. Convert it to MP4 (H.264 and AAC) with HandBrake's Fast 1080p30 preset, then upload it again."
3. Load the file into a hidden `<video>` from an object URL; require `loadedmetadata` within 15 seconds, a finite duration and a non zero width. This gives `duration_sec`, `width` and `height`.
4. Faststart: scan the top level MP4 boxes in the first and last few MB; if `moov` (the index) comes after `mdat` (the media data), the film still plays but takes longer to start, so show a gentle tip rather than refusing.
5. Poster: seek the hidden video to 10 percent, draw it on a canvas at most 640 pixels wide, export a JPEG under 300 KB. The owner may pick a different moment.
6. Title: the file name without the extension, tidied, editable.

### 7.3 The upload

`apps/web/lib/movie-upload.ts`, a small upload manager:

```
browser                       movie-upload-start      R2
  | checks pass                       |                |
  |-- start(title, size, type) ------>| reserve, CreateMultipartUpload
  |<-- movie_id, part_size, count ----|                |
  |-- urls(parts 1..50) ------------->| presign 1 h    |
  |<-- urls --------------------------|                |
  |-- PUT part 1..n (3 at a time) ------------------->|
  |<-- ETag per part -----------------------------------|
  |   ... more urls every 50 parts ...                 |
  |-- complete(parts + ETags) ------->| Complete, Head, mark ready
  |<-- movie (ready) -----------------|                |
  |-- poster JPEG to Supabase Storage (posters bucket) |
```

1. Parts of 16 MiB (the last part may be smaller; R2 needs at least 5 MiB for every other part), uploaded 3 at a time with `fetch` PUT. The bucket's CORS rule must expose `ETag`, or the browser cannot read it.
2. Each part retries 5 times with waits of 1, 2, 4, 8 and 16 seconds. A 403 means the URL expired: ask for new URLs and carry on.
3. Progress, speed and time left show on the movie's row. A 2 GB film on a 10 Mbit/s upload takes about 27 minutes; say so before it starts.
4. The screen wake lock (`lib/use-wake-lock.ts`) stays on during an upload. The page warns before closing (`beforeunload`) while an upload runs.
5. **Resuming.** IndexedDB (the browser's database) keeps `{ movie_id, name, size, lastModified }`. If the tab closes, the library shows "Upload stopped at 40 percent. Choose the same file to carry on." When the same file is chosen, `movie-upload-urls` returns the finished parts and only the rest are sent. "Cancel upload" calls `movie-upload-abort`.
6. After `complete`, the poster goes to Supabase Storage at `posters/<owner_id>/<movie_id>.jpg`, then the row's `poster_path` is set through a small RPC or as part of `movie-upload-complete` (the builder chooses and records it in `decisions.md`).

### 7.4 Poster storage rules

Private bucket `posters` with 300 KB file limit and `image/jpeg` only. Policies on `storage.objects`:

1. Insert, update, delete: `bucket_id = 'posters'` and the first folder equals `auth.uid()` and the movie in the file name belongs to the caller.
2. Select: `public.can_view_movie(<movie id from the file name>)`.

The page shows posters with signed URLs from `supabase.storage.from('posters').createSignedUrl`. Add the Supabase project host to `img-src` in `proxy.ts` if it is not already covered.

### 7.5 Content Security Policy

In `apps/web/proxy.ts`, add the R2 host (`https://<account_id>.r2.cloudflarestorage.com`) to `connect-src` (uploads) and `media-src` (playback). Read it from a new `NEXT_PUBLIC_R2_ORIGIN` variable; it contains no secret.

### 7.6 R2 bucket setup

1. One bucket, for example `watchparty-movies`, Standard storage class (the free tier excludes Infrequent Access).
2. Public access off. No `r2.dev` address (Cloudflare says it is rate limited and for development only) and no custom domain.
3. An API token with Object Read and Write on this bucket only.
4. CORS:
   ```json
   [{
     "AllowedOrigins": ["https://<site>", "https://<preview site>", "http://localhost:3000"],
     "AllowedMethods": ["GET", "HEAD", "PUT"],
     "AllowedHeaders": ["Content-Type", "Range"],
     "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
     "MaxAgeSeconds": 3600
   }]
   ```
5. Lifecycle rule: abort incomplete multipart uploads after 1 day (R2's default is 7).

---

## 8. Watching a movie together

### 8.1 Starting a room

1. On `/movies`, "Watch together" calls `create_room` with `source = 'upload'`, `content_ref = movie id`, `visibility = 'private'`, `control_mode = 'host'`, title = the movie's title, then opens the room with the invite sheet already showing (part 10).
2. The new room form (`app/new/NewRoomForm.tsx`) shows "My movies" first in the source choice when the account has any ready movie, as a grid of posters instead of a link box.
3. The host's source picker inside a room (`SourcePicker` in `packages/ui/src/room/components/Sheets.tsx`) gets the same poster grid for `upload`.

### 8.2 The player

New `apps/web/lib/adapters/html5.ts`, `Html5VideoAdapter implements PlayerAdapter`, starting from `StubAdapter`:

1. Constructor takes the container and `resolveUrl: () => Promise<{ url: string; expires_at: string }>`, which calls `movie-play-url` with the room id and the member's `engine_session`.
2. The `<video>` has `playsInline`, `controls`, `preload="auto"`, `controlsList="nodownload noremoteplayback"`, and is **not** muted (the stub is muted for tests). No `crossOrigin` attribute, so a plain media request needs no CORS.
3. `load(movieId)`: resolve the URL, set `src`, wait for `loadedmetadata`.
4. `play()` returns `blocked` when the browser refuses sound without a tap; the engine already shows the tap to start prompt for this (`blocked` mode).
5. Buffering: true on `waiting` and `stalled`, false on `playing` and `canplay`. This feeds wait for everyone unchanged.
6. User actions: report `play`, `pause` and `seeked` from the native controls, and ignore the events the adapter itself caused, as the stub does.
7. Capabilities: `fineRate: true`, `seek: true`, `seekLatencySec` starting at 0.3 (the engine measures the real value). `volume: false` on iPhone and iPad, where Safari ignores `video.volume`, so ducking turns itself off there; `true` elsewhere.
8. Expiry: on a network error or when within 10 minutes of `expires_at` while paused, resolve a new URL, set `src`, seek to the engine's expected position, and resume only if the room is playing. A 6 hour URL normally outlives the film, so this is rare.

`app/r/[slug]/Player.tsx` picks the adapter by `room.source`: YouTube as now, `Html5VideoAdapter` for `upload`, the stub when `E2E_STUB` is set. The rest of the room (engine host, voice, chat, reactions, wait for everyone) is untouched.

### 8.3 Seeking and Range requests

`<video>` fetches the file in byte ranges, which lets people jump anywhere without downloading the whole film. R2's S3 API supports `Range` on GetObject; whether a presigned GET honours it is inferred, not documented (gap G47). The first proof task in part 14 tests it.

### 8.4 Who can see the file

Anyone holding a presigned URL can download the file until it expires. That is acceptable for friends watching together, but it is not copy protection (gap G50). URLs go only to joined members of the room with a valid `engine_session`, and a removed or banned member cannot get a new one.

### 8.5 The extension

The extension panel must not try to drive an `upload` room: in `apps/extension/src/panel/PanelRoom.tsx`, an `upload` source shows "This room plays on the website. Open it there."

### 8.6 Full screen and reactions

Today reactions float beside the picture. In full screen there is no beside.

1. The room gets its own full screen button, which calls `requestFullscreen()` on the stage element that holds the video **and** the reaction band, and on Android also `screen.orientation.lock('landscape')`. Native `<video>` full screen is hidden (`controlsList="nofullscreen"`) where element full screen exists.
2. In full screen, the reaction band is a slim strip along the bottom edge, reactions float up over the letterbox area, and a small reaction button opens the tray. Timed comments appear in the same strip.
3. iPhone Safari has no element full screen except for video itself, so it falls back to the native player and reactions are not visible there (gap G51).

---

## 9. Deleting a movie

1. The owner taps delete on `/movies`, sees "Delete <title>? People watching it now will see the room stop.", and confirms.
2. `movie-delete` runs part 6's steps. Rooms playing it go to "Pick something to watch" through the normal `room` event.
3. The space is free as soon as the row is gone; the storage meter updates.
4. If the function fails halfway, the row stays in `deleting` and the library offers "Finish deleting", which calls `movie-delete` again.

---

## 10. Inviting people

### 10.1 What exists

A private room's link carries its key (`#k=`). Anyone with the link signs in with Google and joins. The host can copy the link from the room settings, rotate the key to cut off old links, lock the room, and remove or ban people. A free host's room seats 3 including the host; a paid host's seats 10.

### 10.2 What changes

1. **An Invite button** always visible to the host in the room's top bar, and a "Waiting for friends" card with the same button while the host is alone. It opens an invite sheet:
   - "Share link" with the Web Share API (`navigator.share`), which opens the phone's own share menu (WhatsApp, Messages and so on). Copy link where sharing is not available.
   - A QR code of the link, drawn in the browser, for someone sitting next to you.
   - One plain line: "Anyone with this link can join after signing in with Google. Seats: 1 of 3 taken."
2. **The movie in the invite.** The join screen (`JoinScreen.tsx`) shows the movie's title and poster (from `room_preview`) and the host's name: "James invited you to watch <title>".
3. **Sign in returns to the room.** Keep the existing `next` flow and check it end to end in the Android app as well.
4. **Seat limits said plainly.** When a room is full, the join screen says so and tells the host on their side "Someone tried to join, but the room is full."
5. **Not now:** inviting by email or a friends list. Both need a notification channel the app does not have. Anonymous guests (Q6) stay a separate decision.

---

## 11. Making the app easier to use

Ordered by value for the effort. Each is small and stands alone.

1. **One clear home.** `/home` shows three things in this order: "Your movies" (poster row, "Watch together" on each), "Join with a link", and "Start a room". The rooms list moves below.
2. **Plain words for settings.** In the new room form and host sheet: control mode becomes "Who can press play: Only me / Everyone"; wait for everyone becomes "Pause for everyone when someone's video is loading" (on); cue sync, where it still appears for paid sources, becomes "Follow along by hand". Visibility defaults to private and moves under "More options".
3. **One tap from movie to room.** "Watch together" makes the room and opens the invite sheet (parts 8.1 and 10.2).
4. **A clear tap to start.** When the browser blocks sound, one large "Tap to join the movie" button over the stage, not a small notice.
5. **Upload feedback.** Progress, time left, resume after a dropped connection, and plain reasons when a file is refused (part 7).
6. **Storage meter** on `/movies`, so people know when to delete something.
7. **Every new error code** gets a sentence in `apps/web/lib/errors.ts`, and the existing error sentence test covers them.
8. **Room links open the app** on Android (part 12.4), which removes the "the link opened in the browser" problem described under "Home screen app" in `decisions.md`.
9. **Landing page copy** adds "your own movies" to the list of what you can watch, and the terms page says uploads must be films you have the right to share and that James may remove any upload.

---

## 12. The Android app

### 12.1 What it is

A TWA: a small Android app whose only job is to open the live site in Chrome, full screen, with no address bar. It is the same site, so every feature (sign in, rooms, uploads, voice, camera, reactions, wake lock) works as it does in Chrome on Android, and every website deploy reaches the app at once. A new APK is needed only when the app's name, icon, colours or link settings change.

### 12.2 Where it lives

`apps/android/`:

| File | Purpose |
|---|---|
| `twa-manifest.json` | Bubblewrap's config: package id (for example `app.synvello.android`, decided once and never changed), app name, launcher name, `host` (the fixed production domain), `startUrl` `/home`, theme and background `#0f0d0c`, icons from `/pwa-icon/512` and `/pwa-icon/maskable-512`, orientation `any`, `enableNotifications: false`. |
| `README.md` | How to build, sign, release and install. |
| `.gitignore` | The keystore, `*.apk`, `*.aab` and build folders. Nothing generated is committed, as for the web app. |

Built with Google's Bubblewrap command line tool: `bubblewrap init --manifest=https://<site>/manifest.webmanifest` once, then `bubblewrap build`, which downloads its own JDK (Java Development Kit) and Android SDK (Software Development Kit) and produces a signed APK and an AAB (Android App Bundle, the format the Play Store wants).

### 12.3 Linking the app to the site

1. Android shows the app without an address bar only when the site proves it owns the app, through Digital Asset Links: a file at `https://<site>/.well-known/assetlinks.json` listing the package id and the SHA-256 fingerprint of the signing key. Without it the app opens as a normal Chrome tab with an address bar.
2. Serve it from `apps/web/public/.well-known/assetlinks.json` and add `.well-known/` to the exclusions in the `matcher` in `apps/web/proxy.ts`, so the auth redirect never touches it. It must answer 200 with `application/json`.
3. If the app is ever published on Play, Google signs it with its own key, so the file lists both fingerprints.
4. This needs the fixed production domain (open question Q4, gap G22). A `vercel.app` address works if it never changes.

### 12.4 Room links open in the app

Bubblewrap's config adds verified app links for the site's host, so tapping `https://<site>/r/<slug>#k=...` in WhatsApp opens the app straight in the room. Check that the `#k=` fragment arrives intact (gap G49).

### 12.5 Permissions and sign in

1. Microphone and camera prompts come from Chrome inside the TWA, as on the website. Expected to work; no official page confirms it (gap G46). Test on a real phone first.
2. Google sign in runs in Chrome, not in an embedded WebView, so Google's block on embedded sign in does not apply. Same gap G46.
3. File picking for uploads uses the normal `<input type="file" accept="video/*">`, which opens Android's file picker (including files from Google Drive's app, which Android copies locally).
4. If the person switches apps during an upload, Android may pause the page; the resumable upload in part 7.3 carries on when they come back.

### 12.6 Getting it onto phones

| Route | What it takes | Fits |
|---|---|---|
| Download from the site (sideload) | A page `/android` with a download button for the APK (hosted on the repository's GitHub Releases) and three steps: download, allow "Install unknown apps" for the browser, open. | Friends and family. **But** Android developer verification (gap G45): from 30 September 2026 in Brazil, Indonesia, Singapore and Thailand, and worldwide from 2027, certified Android phones install only apps from a registered developer. A free "limited distribution" account covers up to 20 devices with no ID or fee; a full registration covers more. James registers before 2027. |
| Google Play | US$25 once, identity check, and for a personal account made after 13 November 2023, a closed test with at least 12 testers opted in for 14 days in a row before release. | Later, if strangers will install it. |

Releases: a GitHub Actions workflow `android.yml`, run by hand, that runs `bubblewrap build` with the keystore and its passwords from GitHub secrets and attaches the APK to a GitHub Release. The keystore (the signing key file) is kept by James outside the repository, in a password manager. **If it is lost, the app can never be updated in place**; people would have to uninstall and reinstall.

### 12.7 iPhone

Unchanged: the website and "Add to Home Screen". iOS has no equivalent of a TWA.

---

## 13. Gaps and open questions

Continue the numbering in `docs/gaps.md` (the last is G43).

| Gap | What is unknown | Effect until closed |
|---|---|---|
| G44 | Whether enabling R2 asks for a payment card, and whether James accepts that. | Nothing can be uploaded until R2 is enabled. The app's 9 GB cap keeps usage inside the free tier either way. |
| G45 | Android developer verification: which account type James needs, and the fee for a full registration. | The sideloaded APK works today outside the four first countries; from 2027 it needs registration. Up to 20 devices are free with a limited account. |
| G46 | Microphone, camera and Google sign in inside a TWA have no official confirmation. | Proof task P3 in part 14 tests them on a phone before the Android work goes further. |
| G47 | Whether presigned R2 GET URLs honour `Range` (seeking). | Proof task P1. If not, playback would need a proxy, and the design changes. |
| G48 | Whether `aws4fetch` signing works from a deployed Supabase Edge Function. | Proof task P1. |
| G49 | Whether the `#k=` fragment survives an Android verified app link into the TWA. | Proof task P3. If not, the room page falls back to the "Join a room" box, or the key moves to a query parameter for app links only (a security review is needed first). |
| G50 | Presigned URLs can be passed on until they expire. | Accepted for watching with friends; revisit if the app opens to strangers. |
| G51 | iPhone Safari has no element full screen, so reactions do not show in full screen there. | iPhone users see reactions when not in full screen. |
| G52 | Rights to uploaded films. | The terms page must say people upload only what they have the right to share; James removes anything reported. The report flow covers people and messages, not movies; add a "Report this movie" reason later if needed. |

Questions for James, recommended option first:

1. **Q8: Who may upload?** (a) Only accounts James sets a quota for (recommended: the 9 GB is shared by everyone), or (b) everyone with a small quota.
2. **Q9: Per account quota.** (a) 4 GB for James, 2 GB for each trusted friend (recommended), or (b) James alone gets all 9 GB.
3. **Q10: Android package id and app name.** Needed once and permanent; for example `app.synvello.android` and "Synvello", or a "Watch Party" name if the app is renamed.
4. **Q11: Android distribution.** (a) APK from the site, registered under a limited distribution account for up to 20 phones (recommended), or (b) Google Play.

---

## 14. Build order and acceptance checks

Do the proof tasks first; each can change the design.

| Step | Work | Done when |
|---|---|---|
| P1 | Proof: R2 bucket, token, CORS. A throwaway Edge Function presigns a PUT and a GET with `aws4fetch`. Upload a 200 MB MP4 in parts from a browser page; play it in `<video>` and seek to the middle and the end. | The file plays, seeking works without downloading everything (the network panel shows `206 Partial Content` responses), ETags were readable. Record the result in `docs/spike-results.md`; close G47 and G48. |
| P2 | Proof: `movie-check.ts` on 6 sample files: H.264/AAC MP4, HEVC MP4, MP4 with AC-3 audio, MKV, WebM VP9/Opus, MP4 with `moov` at the end. | Each gets the right verdict in Chrome desktop, Chrome Android and Safari iPhone. |
| P3 | Proof: a Bubblewrap TWA of the current preview site on an Android phone, with `assetlinks.json`. | No address bar; Google sign in works; a room link from WhatsApp opens the app in the room with its key; mesh voice works. Close G46 and G49. |
| 1 | Database: migrations of part 5 and their pgTAP tests (quota races with parallel reservations, like `pnpm db:concurrency`; owner only rules; `set_source` refusing someone else's movie; delete clearing rooms; account deletion). | `pnpm db:test` passes, the read access test covers `movies` and `room_movie`. |
| 2 | Edge Functions of part 6 with Deno tests on a fake R2; `delete-account` updated. | `pnpm fn:test` passes; deployed functions answer an anon key request with `unauthorized`. |
| 3 | `/movies`: checks, upload manager with resume, posters, storage meter, delete. | A 2 GB upload survives turning Wi-Fi off and on, and closing and reopening the tab. Deleting frees the space at once. |
| 4 | Playback: `upload` source in sync-core and SQL, `Html5VideoAdapter`, `Player.tsx`, CSP, poster grids, "Watch together", extension panel message. | Two browsers (one a phone) watch an uploaded movie within 0.15 seconds of each other; pause, seek and wait for everyone work; reactions and timed comments show. |
| 5 | Invite sheet, join screen movie details, full screen stage with reactions. | A new person on a phone goes from tapping a shared link to watching in under a minute, including Google sign in. |
| 6 | Ease of use items in part 11. | Each item checked on a phone and a laptop. |
| 7 | Android: `apps/android`, `assetlinks.json`, `/android` page, `android.yml`, README. | The APK from a GitHub Release installs on a phone and passes P3's checks against production. |
| 8 | End to end tests: E16 upload and watch together (Playwright, with a local S3 compatible server such as MinIO in Docker through `R2_ENDPOINT`), E17 delete during a room, E18 quota refusal. | `pnpm e2e` passes with E1 to E18. |

After every step: `pnpm test`, `pnpm typecheck`, and the tests that step touches. Update `docs/decisions.md` (mark choices made without James as DEFAULT) and `docs/gaps.md`.

---

## 15. Files this work touches

| Area | Files |
|---|---|
| Shared | `packages/sync-core/src/schemas.ts` (source, error codes), `content-ref.ts` and its test |
| Database | new migrations for `upload` source, `movies`, quotas, service role RPCs, `room_movie`, `can_view_movie`, poster bucket policies, jobs; changes to `create_room`, `set_source`, `room_preview`; new pgTAP files `11_movies.test.sql`, `12_movie_rooms.test.sql` |
| Functions | `supabase/functions/movie-upload-start`, `movie-upload-urls`, `movie-upload-complete`, `movie-upload-abort`, `movie-delete`, `movie-play-url`; `_shared/r2.ts`; `delete-account`; tests in `supabase/tests/functions` |
| Web app | `app/movies/` (page and components), `lib/movie-check.ts`, `lib/movie-upload.ts`, `lib/adapters/html5.ts`, `app/r/[slug]/Player.tsx`, `RoomEntry.tsx`, `RoomStage.tsx`, `JoinScreen.tsx`, `app/new/NewRoomForm.tsx`, `app/home/page.tsx`, `app/page.tsx`, `app/terms/page.tsx`, `app/android/page.tsx`, `lib/errors.ts`, `lib/env.ts`, `proxy.ts`, `public/.well-known/assetlinks.json` |
| Room UI | `packages/ui/src/room/components/Sheets.tsx` (source picker, invite sheet), `ReactionBand.tsx`, `controller.ts` (play URL call), `api.ts` |
| Extension | `apps/extension/src/panel/PanelRoom.tsx` |
| Android | `apps/android/*`, `.github/workflows/android.yml` |
| Config and docs | `.env.example` (R2 variables, `NEXT_PUBLIC_R2_ORIGIN`), `README.md` (accounts table, setup), `docs/decisions.md`, `docs/gaps.md`, `docs/spike-results.md`, `docs/device-matrix.md` |

### Accounts James sets up

| Service | Steps |
|---|---|
| Cloudflare R2 | Enable R2, create the bucket, set CORS and the lifecycle rule, create a bucket scoped API token. Put the account id, key id, secret and bucket name in Supabase Edge Function secrets, and the R2 origin in Vercel as `NEXT_PUBLIC_R2_ORIGIN`. |
| Supabase | Create the private `posters` bucket (or let a migration create it), set `upload_quota_bytes` for each uploader, confirm `movie_storage_cap_bytes`. |
| Android | Choose the package id, generate the keystore once with Bubblewrap and keep it safe, add it as GitHub secrets, register as an Android developer before 2027. |
