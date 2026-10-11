# Decisions

Each entry records what was decided, why, and when. `DEFAULT` marks a decision James did not make himself; the build took the most conservative option and the decision stays open to change.

## Tooling

### Docker runs the local Supabase stack
Date: 11 October 2026
James first asked for no Docker, then allowed it when it is the better route. The Supabase command line tool needs Docker for its local stack (database, sign in service, realtime server, Edge Function runtime), and the realtime authorization test and the Playwright end to end tests need that stack. Docker is used for local development and tests only; nothing deployed depends on it.

### Internal packages are consumed as TypeScript source
Date: 11 October 2026 (DEFAULT)
`packages/sync-core`, `packages/voice` and `packages/ui` export their `src` files directly. Next.js compiles them through `transpilePackages`; Vite and Vitest compile TypeScript natively. Each package's `build` script is a strict type check. This removes a compile step per package and keeps one source of truth for shared code.

### The room client lives in packages/ui
Date: 11 October 2026 (DEFAULT)
The code that joins a room (realtime channels, presence, the `touch_member` worker, reconnection, the engine driver) is needed by both the room page and the extension panel. The prompt's layout has no package for it, so it sits in `packages/ui/src/room` beside the React components that render it, rather than adding a package the prompt did not list.

### Packages added beyond the technology table
Every package below was checked on npm on 11 October 2026 for existence and licence before it was added.

| Package | Licence | Why |
|---|---|---|
| `@supabase/supabase-js` | MIT | Supabase client for web, extension and tests |
| `@supabase/ssr` | MIT | Cookie based Supabase sessions in Next.js server components and middleware |
| `react`, `react-dom` | MIT | Required by Next.js and the extension panel |
| `@vitejs/plugin-react` | MIT | React support in the extension's Vite build |
| `@types/chrome`, `@types/react`, `@types/react-dom`, `@types/node` | MIT | Type definitions |
| `@vitest/coverage-v8` | MIT | Line coverage for the sync core's 90 percent exit check |
| `supabase` | MIT | The Supabase command line tool, pinned per repository |
| `deno` | MIT | Runs Edge Function tests and the concurrency script without a separate install |
| `jsdom` | MIT | Browser globals for unit tests of the shared UI hooks |

## Realtime

### Realtime Authorization syntax
Date: 11 October 2026
Checked on the Supabase Realtime Authorization and Broadcast pages on 11 October 2026.
1. Policies are written on `realtime.messages`; `realtime.messages.extension` is `'broadcast'` or `'presence'`; the topic being joined comes from `(select realtime.topic())`.
2. Select policies govern receiving; insert policies govern sending and presence tracking.
3. Access is evaluated when a client joins a channel and cached for the connection, refreshed only when the client sends a new token. Revoking access in the database does not cut an existing subscription, which is why topics carry the channel epoch.
4. `realtime.send(payload jsonb, event text, topic text, private boolean)` broadcasts from the database. Messages sent this way bypass the insert policy because they run as the database owner.
5. RLS (Row Level Security) is already on for `realtime.messages`; migrations must not try to enable it, and must not create objects in the `realtime` schema.
6. Clients create channels with `config: { private: true }` and call `supabase.realtime.setAuth()` after every token refresh.

Topic parsing is done in one `SECURITY DEFINER` helper, `public.realtime_topic_allowed(topic, for_send)`, so a malformed topic returns false instead of raising inside a policy.

## Design

### Visual direction: the projection booth
Date: 11 October 2026 (DEFAULT; James has not supplied a brand, gap G16)
The app is used in the evening with a film playing, so the interface behaves like a cinema with the house lights down: warm near black surfaces, warm off white text, and one accent, a tungsten amber taken from marquee bulbs and projector light. The video is always the brightest thing on screen. A second colour appears only with meaning: red for destructive actions and errors, green for "in sync".

1. One dark theme, designed for dark rather than inverted from light. Surfaces step up in lightness for elevation; no drop shadows on dark surfaces.
2. Type: a condensed marquee display face (Big Shoulders Display) for page headlines and section labels only; a sturdy grotesque (Hanken Grotesk) for all reading text and every piece of user text; a monospace (JetBrains Mono) with tabular figures for timecodes, positions, drift and countdowns, the numbers people read while watching.
3. Product specific shapes instead of stock decoration: room capacity is drawn as a row of seats (3 or 10); the room link card is a ticket with a perforated edge; the countdown to a synced start is drawn as a film leader (3, 2, 1 with a sweeping hand).
4. Icons are drawn in this repository on one 24 pixel grid with one stroke weight and always sit beside a text label, except close and send where the meaning is universal.
5. Motion is limited to three places where it carries meaning: reactions rising for 2 seconds, the countdown leader, and sheets entering from the bottom. All three have a reduced motion alternative.
6. Spacing uses a 4 pixel base; type uses a fixed scale; every colour is a CSS variable in `packages/ui/src/styles/tokens.css`.

### Fonts are self hosted at build time
Date: 11 October 2026 (DEFAULT)
`next/font/google` downloads the three families during the build and serves them from the app's own origin, so the CSP (Content Security Policy) needs no font host and no visitor request reaches Google. The extension panel bundles the same files.

## Database

Terms used in this section: RPC (Remote Procedure Call, a Postgres function the client calls through Supabase); SECURITY DEFINER (a function that runs with its owner's rights instead of the caller's); JWT (JSON Web Token, the signed token Supabase issues to a signed in user); pgTAP (unit tests written in SQL, the Structured Query Language, and run inside Postgres); pg_cron (a Postgres extension that runs SQL on a schedule).

### How every RPC is built
Date: 11 October 2026
1. Every RPC is SECURITY DEFINER with `set search_path = ''` and schema qualified names. Execute is revoked from `public` and `anon` and granted to `authenticated`. Internal helpers, trigger functions and job functions are executable by no client role. A pgTAP test lists exactly which functions signed in users can execute.
2. Every RPC returns `{ "ok": true, "data": ... }` or `{ "ok": false, "code": ..., "data": ... }`, with `data` left out of a refusal that carries nothing. `server_time()` uses the same envelope, with epoch milliseconds as a number.
3. Two codes appear beyond the prompt's table, both already in the shared error code list: `unauthorized` when the JWT carries no user, and `invalid_input` for malformed input on any RPC (for example an unknown `sync_mode` in `join_room` or `touch_member`, an unknown `action` in `moderate`, or `rotate_join_key` on a public room). `room_full` carries `{ "room_cap": 3 | 10 }` so the client can write "3 of 3" or "10 of 10"; `stale_seq` carries the current playback row.
4. Rows inside `data` are `to_jsonb` of the table row, so field names match `RoomRow`, `MemberRow`, `MessageRow` and `PlaybackStateRow` in `packages/sync-core/src/schemas.ts`. Member rows returned by `touch_member` and `moderate`, and sent as `members` events, leave out `engine_session`.

### Lock order inside RPCs
Date: 11 October 2026
Any RPC that changes a room's members locks the room row first and member rows after it. `send_chat` and `post_system` take a key share lock on the room before locking the caller's member row, because inserting a message takes that lock anyway through its foreign key; taking it first stops a deadlock between one person's chat and their own `touch_member`. `join_room` holds the room lock while it counts present members, which is what makes the room cap exact under parallel joins (`supabase/tests/concurrency.ts`).

### Present, elected and host checks in SQL
Date: 11 October 2026
Present means `state = 'joined'` and `last_seen_at` later than `clock_timestamp()` minus 60 seconds. The elected member is the present member with `sync_mode = 'auto'` and the earliest `first_joined_at` (ties broken by user id). Host only RPCs require the caller to be `rooms.host_id` and to hold a `joined` row; otherwise they return `not_host`. `clock_timestamp()` is used throughout instead of `now()`, so the time is the moment of the statement, not the start of the transaction.

### Room links come from app_config
Date: 11 October 2026 (DEFAULT)
SQL needs the site address to build a room link. The table `public.app_config` holds it as the row `site_url`; RLS is on with no policy and no client grant. The migration seeds `http://localhost:3000` for the local stack. James must update the row on the preview and production projects, for example `update public.app_config set value = 'https://<domain>' where key = 'site_url';`. A public room link is `<site_url>/r/<slug>`; a private one adds `#k=<join_key>`. `create_room` returns `{ room, room_link }`; `get_room_link` and `rotate_join_key` return `{ room_link }`.

### System messages carry data, not sentences
Date: 11 October 2026
`messages.body` of a system message holds JSON text and the client builds the sentence from `system_code`, so a renamed member shows their current name:
1. `joined`, `left`, `host_changed`: `{"user_id": "<uuid>"}`. `join_room` posts `joined` when the caller was not already joined; `leave_room` posts `left`, and `host_changed` when host moves; `transfer_host` and `handover_absent_hosts` post `host_changed`.
2. `waiting_for`: `{"user_ids": [...]}`, the present members whose `buffering_since` is set, earliest first. The RPC finds them; the caller passes nothing. With nobody buffering it returns `invalid_input`.
3. `cue_ready`: `{"user_id": "<uuid>", "position_sec": <number>}`, where the position is the expected position at the moment of the call, computed from playback state.
`messages.user_id` of a system message is the person it is about (`joined`, `left`, `host_changed`) or the member who posted it (`cue_ready`, `waiting_for`). `post_system` keeps the prompt's two parameters and its 10 second limit covers both client codes together.

### Private rooms admit joined members and the host without the key
Date: 11 October 2026 (DEFAULT, gap G25)
`join_room` asks for the key from everyone except a user whose row is already `joined` and the room's host, so a member can open the room in a second browser context. Keys are compared through their SHA-256 digests so the comparison time does not depend on how much of a guess matches.

### profile_public runs with its owner's rights
Date: 11 October 2026 (DEFAULT, gap G24)
The view has no `security_invoker`, is marked `security_barrier`, shows only `id`, `display_name` and `avatar_url`, and returns the caller and people who share at least one room with them in any membership state. Anonymous visitors have no grant on it. `room_view` is a `security_invoker` view over `rooms`, which has a members only read policy.

### Playback rules the prompt leaves open
Date: 11 October 2026 (DEFAULT)
1. `paused_reason` is set exactly while the status is `paused` (a table constraint). The first playback row and the reset done by `set_source` are paused with reason `user`; `ended` has no reason.
2. `set_source` resets playback to paused at 0 at rate 1. A null content reference is accepted, as at creation.
3. `rate`, when given, must be between 0.0625 and 16, the range browsers accept; null keeps the current rate.
4. A `buffer` call while wait for everyone is off returns `invalid_input`. For both a buffer pause and a buffer resume the server takes the position from the expected position and keeps the rate, so the client may send nulls for both. The order of checks is input, then caller, then `stale_seq`, then the buffer state rules, so a call that lost a race returns the silent `stale_seq`.
5. Status `ended` must come with reason `ended` and the other way round. A non member calling `set_playback` gets `not_controller` for reason `user` and `not_elected` otherwise.

### Moderation details
Date: 11 October 2026 (DEFAULT)
`remove`, `mute_voice` and `unmute_voice` apply to a `joined` target; `ban` to a target who is `joined`, `left` or `removed`; `allow_back` to a `removed` target, and it does not lift a ban. Any other target state, or no row, is `not_member`. The host cannot target themself (`invalid_input`). For `remove` and `ban` the order is: `moderation` event `{ target, action, new_epoch }` on the current server topic, then the member update (its `members` event also goes to the current topic, which the removed user still holds), then `channel_epoch` + 1. `moderate` returns `{ member, channel_epoch }` with the epoch after the call.

### Server topic events
Date: 11 October 2026
1. Triggers send `state` (playback row), `room` (room row), `members` (member row without `engine_session`) and `chat` (message row) with `realtime.send(payload, event, topic, true)` to `room:<room_id>:<channel_epoch>:server`. The `room` and `members` triggers fire only when one of their listed columns actually changes, so an update that saves the same value sends nothing.
2. `realtime.send` adds an `id` key holding a random UUID (universally unique identifier) to any payload that has none. Playback, member and moderation payloads therefore carry an extra `id`; the zod schemas (zod is the TypeScript validation library the clients use) ignore keys they do not list. Room and message payloads keep their own `id`.

### Realtime private channels on the local stack
Date: 11 October 2026
Spike S6 ran against the local stack with no change to `supabase/config.toml`: private channels are authorized by the policies on `realtime.messages` as on a hosted project. The local stack also accepts public channels and offers no setting to refuse them, but a public channel never receives the database's private broadcasts, even with the same topic name. Hosted projects have the "Allow public access" setting, which must be turned off (gap G26).

### Reports
Date: 11 October 2026 (DEFAULT)
A member inserts a report directly. Column grants allow `room_id`, `reporter_id`, `target_user_id`, `message_id`, `reason` and `note`; `reporter_id` defaults to the caller and must equal them; `status` and `created_at` cannot be set by clients. The target must have a membership row in the same room. Deleting the reporter's or the target's account keeps the report with that id set to null, which is needed for `delete-account` to succeed.

### Profiles at sign up
Date: 11 October 2026 (DEFAULT)
The display name comes from the Google account's `full_name`, then `name`, then the part of the email before the @, trimmed and cut to 40 characters, and `New user` when none of these exists, so sign up never fails on a missing name. The avatar comes from `avatar_url`, then `picture`.

### Chat details
Date: 11 October 2026 (DEFAULT)
`send_chat` trims whitespace around the body before checking its length. The limit of 5 messages in 5 seconds counts chat and timed comments, including ones deleted since. `delete_message` lets an author delete their own chat or timed comment and the host delete any message, while the caller is a joined member; deleting a deleted message succeeds without sending a second event.

### Scheduled jobs
Date: 11 October 2026
pg_cron is installed as Supabase documents it (`create extension pg_cron with schema pg_catalog`, usage on schema `cron` for `postgres`). The three jobs call `public.handover_absent_hosts()` every minute, `public.close_idle_rooms()` every 10 minutes and `public.clear_stale_buffering()` every minute; tests call the functions directly. `close_idle_rooms` closes an open room once its `last_active_at` and every joined member's `last_seen_at` are more than 31 minutes old: 30 minutes without a present member plus the 60 seconds a member stays present after their last refresh. `handover_absent_hosts` leaves closed rooms alone.

### Deno runs ignore the root package.json
Date: 11 October 2026
Deno reads a nearby `package.json`, expects its packages in `node_modules`, and when it finds `pnpm-workspace.yaml` it rewrites `package.json` to add a `workspaces` field. The database test scripts therefore run Deno with `DENO_NO_PACKAGE_JSON=1` and `--no-config`, so `npm:` imports come from Deno's own cache and no file in the repository changes.

### pgTAP helpers
Date: 11 October 2026
`supabase/tests/database/_helpers.psql` creates a `tests` schema of helper functions. Each test file includes it with `\ir` right after `begin`, so the helpers are rolled back with the test and nothing is left in the database. The `.psql` extension keeps `supabase test db` from running it as a test.

## Voice

Terms used in this section: WebRTC (Web Real Time Communication, the browser standard for live audio and video); ICE (Interactive Connectivity Establishment, how WebRTC finds a network path); STUN and TURN (servers that tell a device its public address, and that relay media when no direct path exists); SDP (Session Description Protocol, the text an offer or answer carries); dBFS (decibels relative to full scale); MDN (MDN Web Docs, Mozilla's reference for web standards).

### One interface for the room, two implementations
Date: 11 October 2026
`packages/voice` exports `createVoiceClient(voiceMode, deps)`, which returns `MeshVoice` for `mesh` rooms and `ServerVoice` for `server` rooms. Both implement the prompt's `VoiceClient` exactly, plus `RoomVoiceClient` additions the room needs: `prepareAudio()`, `getState()`, `getLocalMedia()`, `onLocalMedia()`, `onError()`, `handleModeration()` and `attachMedia()`. The room receives one dependency bag (`getIceServers`, `getToken`, `signalling`, `presence`) and never learns which implementation runs. `livekit-client` is loaded only when a server voice room joins, so mesh rooms never download it.

### attachMedia instead of wiring tracks by hand
Date: 11 October 2026
LiveKit's adaptive stream sends a member's video only while it is attached to a visible element through LiveKit's own `attach`. A raw `MediaStreamTrack` from `onTracks` played in a hand made element would look invisible to LiveKit and stay paused. So the room plays audio and video through `attachMedia(userId, kind, element)`, which uses LiveKit's `attach` for server voice and `srcObject` for mesh voice. `onTracks` still reports every change, as the prompt specifies. The local microphone is never attached, so nobody hears themself; the local camera is, for the self view.

### Mesh signalling details
Date: 11 October 2026 (DEFAULT)
1. Every `rtc` payload carries the sender's voice session id, a random id made on each join of voice. A hello with a new session id from a connected member means they left voice and came back, so the old connection is closed first.
2. Descriptions and candidates also carry a connection id chosen by the member who starts the connection. An offer with a new connection id replaces the old connection; an answer or candidate for an unknown id is dropped. This keeps a new offer from landing on an old connection when presence drops and returns without a rejoin.
3. Only a broadcast hello (`to: null`) gets a directed hello in reply, so two members never answer each other's replies forever.
4. When the smaller id started a connection from presence before the peer was listening, the peer's hello makes it send its outstanding offer again instead of waiting forever.
5. A connection closes on presence only when the peer goes from in voice to out of voice, so a stale `off` that arrives just after their hello cannot close a new connection.
6. The member who starts a connection adds its tracks at once, which sends the first offer; the other side adds its tracks after applying that offer, so they share its media sections.
7. Perfect negotiation follows MDN, with an explicit rollback when the polite side has its own offer outstanding. Signalling for each peer is handled in order, one message at a time.
8. Camera on uses the same video sender each time (`replaceTrack` and the transceiver direction), so turning the camera on and off does not keep adding media sections.

### Mesh voice state and the 30 second rule
Date: 11 October 2026 (DEFAULT)
The prompt gives one state for voice but mesh voice has a connection per member. Offline is `reconnecting` (or `connecting` before the first connection). One live connection is `connected`, because one member dropping is their problem, not this member's. With no live connection, a connection that dropped means `reconnecting`. A fresh join waiting for members already in voice is `connecting`; alone in voice is `connected`. Whenever the state is `connecting` or `reconnecting`, a 30 second window runs; if it ends without recovery, voice tears down, the state becomes `failed` and `onError` reports `disconnected` ("Voice disconnected, tap to rejoin"; the tap calls `join` again). ICE restarts on every network change (`online`, `offline` and the network information `change` event), when a connection fails, and when a connection has stayed `disconnected` for 2 seconds.

### Server voice reconnects
Date: 11 October 2026 (DEFAULT)
LiveKit's own reconnect is followed (`reconnecting`, then `connected`) inside the same 30 second window. If LiveKit gives up with a disconnect, server voice fetches a new token from `livekit-token` and connects again after 1, 2, 4, then every 5 seconds until the window ends. A disconnect because the same identity joined elsewhere ends voice with `replaced`; removal or a closed room ends it with `disconnected`. A token refusal (`unauthorized`, `not_member`, `wrong_voice_mode`, `voice_muted`, `not_found`) ends it at once with that code.

### Moderation in voice
Date: 11 October 2026 (DEFAULT)
The room calls `handleModeration` for every `moderation` server event and, with `mute_voice` or `unmute_voice`, whenever a `members` row's `voice_muted` changes or is first loaded, because the RPC sends the `moderation` event only for remove and ban. A muted member's audio and camera both stop: other members stop playing all their tracks and no longer report them as speaking, and the muted member's client stops sending both. This matches server voice, where `moderate` turns off the member's publish permission as a whole. Remove and ban also close the connection and ignore that member's signalling until the host allows them back. A member removed or banned leaves voice. After the host unmutes a member, their microphone stays off until they unmute it.

### Speaking detection
Date: 11 October 2026 (DEFAULT)
Levels are sampled every 50 ms from a Web Audio analyser: root mean square of the time domain samples, in dBFS. Speaking starts when the level stays above minus 50 dBFS (the DEFAULT, because spike S3 has not run) for 150 ms and stops when it stays at or below it for 150 ms (gap G31). The audio context is created or resumed by `join()` (or `prepareAudio()`) before its first await, so a "Join voice" tap handler that calls it directly satisfies iOS.

## Edge Functions

Terms used in this section: CORS (Cross Origin Resource Sharing, the browser check before a page sends credentials to another origin); JSR (the JavaScript Registry, where Deno's standard library is published).

### Function layout and tests
Date: 11 October 2026
1. Each function folder holds `index.ts`, which only calls `Deno.serve`, and `handler.ts`, whose factory takes its dependencies (environment, admin client, a user client factory, `fetch`, a LiveKit room service factory). Shared code is in `supabase/functions/_shared`: the status map and response shape, CORS, the request pipeline (CORS, POST only, JWT, JSON body, zod input), Supabase clients, the voice access check and LiveKit helpers.
2. Each function has its own `deno.json` import map, as Supabase recommends, with `"lock": false`: the lockfile format the repository's Deno writes is newer than the one the local edge runtime reads. The Deno tests use `supabase/tests/functions/deno.json`, which adds `@std/assert`; a test keeps the four function maps identical and the tests' map in step with them.
3. `pnpm fn:test` runs `DENO_NO_PACKAGE_JSON=1 deno test --config supabase/tests/functions/deno.json --allow-net --allow-env --allow-read supabase/tests/functions`. The tests call each handler directly with an in-memory Supabase fake that returns only the columns a query selects, so a wrong column name fails a test.
4. The JWT is verified by asking Supabase Auth for the user (`auth.getUser`), which also refuses a deleted user. An Auth answer of 4xx is `unauthorized`; Auth being unreachable is `internal`.
5. The function codes are the same list as `FUNCTION_CODES` in `packages/sync-core/src/schemas.ts`; a test reads that file and fails if the two differ.

### CORS
Date: 11 October 2026 (DEFAULT)
Allowed origins are `SITE_URL`, `PREVIEW_URL` and the comma separated `EXTENSION_ORIGINS` (each `chrome-extension://<id>`), read from the function's environment (gap G35). A preflight from an allowed origin gets 204 with that origin echoed, `POST, OPTIONS` and the headers `authorization, x-client-info, apikey, content-type`; any other preflight gets 403. Responses echo the origin only when it is allowed. On the local stack the gateway in front of the functions answers preflights itself with `*` and rejects a request without a JWT before the function runs; on a hosted project preflights reach the function.

### Voice credentials
Date: 11 October 2026 (DEFAULT)
`turn-credentials` and `livekit-token` take `{ room_id, engine_session }` (gap G30). Checks, in order: a `joined` member row whose `engine_session` matches, in an open room (otherwise `not_member`; a closed room has nobody to talk to), then the room's voice mode (`wrong_voice_mode`), then `voice_muted`. In `TURN_TEST_MODE` the answer is `{ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] }`, after the same checks, so E13's `voice_muted` holds locally. Otherwise the function calls Cloudflare's `POST https://rtc.live.cloudflare.com/v1/turn/keys/<key id>/credentials/generate-ice-servers` with `{ "ttl": 21600 }`, as Cloudflare's "Generate credentials" page describes (checked 11 October 2026), and drops port 53 addresses, which browsers block.

### LiveKit permissions
Date: 11 October 2026 (DEFAULT)
Join tokens last 10 minutes, use the room id as LiveKit room and the user id as identity, carry the display name, and grant `roomJoin`, `canPublish` and `canSubscribe`. They also set `canPublishSources` to microphone and camera only, so no member can publish a screen share (which could redistribute a streaming service's picture), and `canPublishData` to false, because the app sends no data through LiveKit. LiveKit replaces permissions as a whole, so `moderate` sends the full set: mute is publish off with no sources, unmute restores the token's set.

### moderate
Date: 11 October 2026 (DEFAULT)
`moderate` calls `public.moderate(room_id, target_id, action)` with the caller's JWT and returns the RPC's code (`unauthorized`, `invalid_input`, `not_host`, `not_member`) or its data. For a `server` room it then calls LiveKit: mute and unmute update the participant's permission, remove and ban remove the participant, and allow back calls nothing. LiveKit's "not found" (the member is not in voice) counts as done. The call is tried once and retried 3 times after 250, 500 and 1,000 ms (gap G34). If it still fails, or LiveKit is not configured, or the room cannot be read after the RPC, the answer is `voice_sync_failed` and the error is logged; the database change stands.

### delete-account
Date: 11 October 2026
With the service role: `update rooms set status = 'closed' where host_id = <caller> and status = 'open'`, which fires the room trigger so every member sees the room close, then `auth.admin.deleteUser`. The body must be empty or `{}`. A failure of either step is `internal`; when the rooms cannot be closed, the user is not deleted.

### Packages added for voice and functions
Checked on 11 October 2026 for existence and licence.

| Package | Licence | Why |
|---|---|---|
| `zod` in `packages/voice` | MIT | Validates `rtc` payloads (already used across the repo) |
| `@std/assert` from JSR | MIT | Assertions in the Edge Function Deno tests |
