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

### Product name: Synvello
Date: 11 October 2026 (given in the build session)
The product is called Synvello. It is the default display name in the web app, the PWA manifest, the generated icons and the sync extension, and `NEXT_PUBLIC_APP_NAME` can still override it per deployment. Internal identifiers keep the working name: the `@watchparty/` package scope, storage keys and the local Supabase project id. Users never see them, and renaming them would only churn imports and lose saved room keys on machines that already ran the build.

### Visual direction: the projection booth
Date: 11 October 2026 (DEFAULT; James has not supplied a brand beyond the name, gap G16)
The app is used in the evening with a film playing, so the interface behaves like a cinema with the house lights down: warm near black surfaces, warm off white text, and one accent, a tungsten amber taken from marquee bulbs and projector light. The video is always the brightest thing on screen. A second colour appears only with meaning: red for destructive actions and errors, green for "in sync".

1. One dark theme, designed for dark rather than inverted from light. Surfaces step up in lightness for elevation; no drop shadows on dark surfaces.
2. Type: a condensed marquee display face (Big Shoulders, at its display optical size) for page headlines and section labels only; a sturdy grotesque (Hanken Grotesk) for all reading text and every piece of user text; a monospace (JetBrains Mono) with tabular figures for timecodes, positions, drift and countdowns, the numbers people read while watching.
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

## Web app and room client

### Synced starts count down only in paid source rooms
Date: 11 October 2026 (DEFAULT)
The prompt gives a play `start_delay_ms` of 0 under "A user's play, pause or seek" and 4,000 under "Cue sync". A play by a controller in a Netflix, Prime Video or Disney+ room uses 4,000 so cue sync members can start on the 3, 2, 1; a play in a YouTube room uses 0, because every YouTube member has auto sync.

### A controller's own action holds corrections for up to 2 seconds
Date: 11 October 2026 (DEFAULT)
When a controller pauses or seeks their own player, the engine would otherwise undo it on its next tick before the new playback state comes back from the database. The engine holds corrections until a newer state arrives or 2 seconds pass (`LOCAL_ACTION_HOLD_MS` in `packages/sync-core/src/engine.ts`).

### Following a new playback state is not a hard seek
Date: 11 October 2026 (DEFAULT)
The prompt defines a hard seek as a seek the engine makes to correct drift. The seek a member's engine makes right after a new state arrives (someone seeked) is an alignment seek: it ignores the 5 second limit and does not count toward the 3 strike stop, so following a host's seek is never delayed (E4).

### Reaction events name their sender
Date: 11 October 2026 (DEFAULT)
The prompt limits reactions to 3 per second per sender, but the reaction payload it defines has no sender. The event carries `from` so receivers can apply the limit. Like every client topic field it is not verified by the server (gap G18).

### YouTube content security and the embed referrer
Date: 11 October 2026
Loading a real YouTube room in Chromium on 11 October 2026 produced no CSP (Content Security Policy) violations. The page itself loads only from `https://www.youtube.com`: the IFrame API script (`/iframe_api`), its widget script (`/s/player/.../www-widgetapi.js`) and the player frame (`/embed/...`). Every other host seen (`i.ytimg.com`, `yt3.ggpht.com`, `www.gstatic.com`, `fonts.gstatic.com`, `www.google.com`, `static.doubleclick.net`, `googleads.g.doubleclick.net`, `jnn-pa.googleapis.com`) was requested from inside YouTube's own frame, which our policy does not govern. So `script-src` and `frame-src` list only `https://www.youtube.com`.
The app sends `Referrer-Policy: no-referrer`, but YouTube refuses embeds that arrive without a referrer. The adapter creates the player frame itself with `referrerpolicy="strict-origin-when-cross-origin"`, which sends only the site's origin, never a room address. Playback itself could not be checked from the build container: YouTube answered "This content isn't available" to its data centre address. Device rows D1, D2 and D9 cover playback.

### Pages render per request
Date: 11 October 2026
Next.js stamps the CSP nonce from `proxy.ts` on its scripts only when the page is rendered for that request, so the root layout opts every page into per request rendering. Most pages need the signed in user anyway.

### The room page runs its timers in a Web Worker
Date: 11 October 2026
`apps/web/public/workers/ticker.js` runs the 20 second `touch_member` timer and the 60 second clock refresh, because browsers throttle page timers in hidden tabs to about once a minute.

### Realtime subscriptions run one at a time
Date: 11 October 2026
`supabase.channel()` returns the existing channel when one with the same topic exists. Two overlapping subscriptions (a moderation epoch change, a check-in that sees a newer epoch, a reconnect) could remove the channel the other had just joined. The room client queues subscriptions and skips one whose topics are already joined. Every 20 second check-in also fetches messages newer than the last one held, so a dropped chat event is recovered within 20 seconds.

### Mesh voice waits before closing on presence
Date: 11 October 2026
Presence can briefly show a member as absent while they re-track. Closing a connection the moment presence says a member left voice made connections drop right after they formed and recover seconds later (found by E7). A presence driven close now waits 3 seconds (`PRESENCE_CLOSE_GRACE_MS`) and is cancelled if the member shows in voice again; a member who really leaves closes their own side anyway.

### The host's page closes the room at once
Date: 11 October 2026
When `close_room` succeeds the host's page shows "This room was closed" without waiting for its own broadcast. Other members hear it on the server topic, and a `touch_member` check-in returns `closed` within 20 seconds if that event is missed.

### A full room's join screen shows the room_full sentence
Date: 11 October 2026
When the preview already counts every seat taken, the join screen shows the `room_full` sentence and disables the join button, rather than letting the member press it to find out (E3).

### A pasted room link is a fresh visit
Date: 11 October 2026
Pasting a room link with a key into a room page that is already open changes only the fragment. The page stores the new key and reloads, so a member who was removed and allowed back, or who got a new link after a key rotation, joins with the new key.

### Handing over to the extension forgets the session in this browser
Date: 11 October 2026 (DEFAULT; gap G42)
The prompt says the room page removes the session from its own storage without signing out. The web app keeps the session in cookies shared by every tab of the site, so the app's other tabs in that browser are signed out until "Bring it back here" returns the session.

### Test and local only switches
Date: 11 October 2026
- `NEXT_PUBLIC_E2E=1` swaps the YouTube adapter for the stub adapter over a local test video (`apps/web/public/e2e/test.webm`, made by the end to end setup and git ignored).
- `NEXT_PUBLIC_DEV_EMAIL_SIGNIN=1` shows an email and password form, for the local stack where Google is off.
- `NEXT_PUBLIC_FUNCTIONS_URL` points the app at the local functions server (`pnpm fn:serve`) where the stack's edge runtime cannot start (gap G33). Unset in every hosted environment.
- The end to end tests feed the fake microphone a steady tone (`e2e/.auth/tone.wav`, generated), because Chrome's own fake device only beeps briefly, too short for the 150 millisecond speaking rule.

### PWA without a service worker
Date: 11 October 2026 (DEFAULT)
The manifest (`app/manifest.ts`) and icons generated from the app name (gap G16) make the app installable in Chrome and Android Chrome, and `apple-touch-icon` with `apple-mobile-web-app-capable` covers iOS. No service worker is registered: nothing in the room works offline, and a worker that only passes requests through adds a cache to reason about and nothing else. Device row D10 checks installation.

### Generated files stay out of the repository
Date: 11 October 2026
James builds in Vercel, so no build output is committed: `.next`, `dist`, coverage, test reports and `apps/web/next-env.d.ts` (written by Next.js on every build) are git ignored. `agentRules: false` stops Next.js writing an `AGENTS.md` into the app folder. The web app's `typecheck` script runs `next typegen` first.

### Packages added for tests
Every package below was checked on npm on 11 October 2026.

| Package | Licence | Why |
|---|---|---|
| `pg` | MIT | End to end tests set up rows (plans, absent hosts) as the local database owner |
| `@types/pg` | MIT | Type definitions |

## Sync extension

Terms used in this section: DOM (Document Object Model, a page's tree of elements); HTTPS (encrypted HTTP, the web's transfer protocol); service worker (the extension's background script, which the browser starts and stops on demand); content script (extension code the browser runs inside a matching web page, in an isolated world that shares the page's DOM but not its JavaScript); panel (the extension page the content script docks on the right of the streaming tab, inside an `iframe`); port (a long lived `chrome.runtime` message channel); JWT (JSON Web Token, the signed token Supabase issues to a signed in user); CSP (Content Security Policy); OFL (the SIL Open Font License).

### Manifest format, key and extension id
Date: 11 October 2026
1. The manifest sets `"manifest_version": 3`. Chrome's Manifest Version page, checked on 11 October 2026, lists this as the only value and says the Chrome Web Store no longer accepts the earlier format.
2. `key` holds the base64 DER (Distinguished Encoding Rules) public key of the key pair made for this project (`PUBLIC_KEY` in `apps/extension/manifest.config.ts`). Every unpacked install in Chrome and Edge computes the same id from it: `appcjgbhipnbklhodimgbmjhbncljoip`. The browser check in `apps/extension/e2e` confirms Chromium loads the build under that id. The Edge Add-ons store may assign a different id when the extension is published there (unconfirmed). `apps/extension/scripts/key-instructions.md` explains how to make another key pair.
3. The web app lists the id in `NEXT_PUBLIC_EXTENSION_IDS`. The Edge Functions must list `chrome-extension://appcjgbhipnbklhodimgbmjhbncljoip` in their `EXTENSION_ORIGINS` secret, or voice credentials fail from the panel (gap G41).
4. `minimum_chrome_version` names the browser release whose service worker lifetime rules this design relies on (messages on a port keep the worker running).

### Build
Date: 11 October 2026
1. Vite with `@crxjs/vite-plugin`, `@vitejs/plugin-react` and `@tailwindcss/vite`. The manifest is written with the plugin's `defineManifest` in `manifest.config.ts`, as the plugin's type definitions and documentation describe. `pnpm --filter @watchparty/extension build` writes `apps/extension/dist`, which is git ignored and is the folder to load unpacked.
2. `envPrefix` is `NEXT_PUBLIC_`, so the extension reads `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` like the web app. Values come from `.env` files at the repository root, then from `apps/extension/.env.local` (git ignored), and variables set in the shell win over both. The build warns when the anon key is missing.
3. The panel page is listed only in `web_accessible_resources`, which the plugin copies without building, so `vite.config.ts` adds it as a build input.
4. The plugin loads content scripts as modules through a small loader, which needs the content script's own chunks to be web accessible to the pages it runs on. The plugin adds those entries itself, limited to the streaming service origins. They hold code only; the Supabase address and anon key sit in a chunk that is not web accessible.
5. `pnpm --filter @watchparty/extension verify-dist` checks the built manifest (key and id, `storage` as the only permission, no wildcard host in `externally_connectable`, web accessible files limited to the services) and searches every built file for secrets: any JWT whose role is not `anon`, any Supabase secret key, and the values of the secret variables found in the shell and in the repository's git ignored env files.

### Permissions and matches
Date: 11 October 2026 (DEFAULT until spike S1 records the watch page addresses, gap G36)
1. `permissions`: `storage` only. `host_permissions`: the watch pages below plus `http://localhost:3000/*` and the site's origin.
2. Content scripts match `https://www.netflix.com/watch/*`; `https://www.primevideo.com/*` and `https://www.amazon.com/gp/video/*` with the `.co.uk`, `.de` and `.ca` equivalents; `https://www.disneyplus.com/video/*`, `https://www.disneyplus.com/*/video/*`, and the same two with `play` in place of `video`, because Disney+ addresses are also seen in that form. The table is `WATCH_PAGES` in `apps/extension/src/shared/watch-pages.ts`.
3. `externally_connectable.matches` is `http://localhost:3000/*` and, when `NEXT_PUBLIC_SITE_URL` is not a local address, that origin followed by `/*`. No wildcard host, so no `vercel.app` wildcard (gap G22).
4. `web_accessible_resources` exposes the panel page only to the service origins (`https://www.netflix.com/*`, `https://www.primevideo.com/*`, the four Amazon origins, `https://www.disneyplus.com/*`).
5. A handover whose content reference is not a watch page (for example a Netflix title page) is refused with `not_a_watch_page`, because the content script would never run in that tab and the member would get a tab with no panel. While checking this, real Netflix redirected a signed out request for `/watch/<id>` to `/title/<id>?fromWatch=true`, a page the content script does not match (gap G36).

### Who holds the session
Date: 11 October 2026 (items 5 and 6 are DEFAULT)
1. The worker stores, in `chrome.storage.session` (cleared when the browser closes): `room:<roomId>` (room id, slug, source, content reference, engine session, the handed over token pair, the tab, and whether the panel gave the session up), `tab:<tabId>` (the room a tab holds) and `tokens:<roomId>` (the newest token pair). The panel's Supabase client keeps its own session under `auth:<roomId>`.
2. The panel restores the session from `auth:<roomId>` when it is there, because it may have been refreshed since the handover, and uses the handed over pair only on its first load: using an older refresh token than the newest would get the session revoked. It writes `tokens:<roomId>` on every `TOKEN_REFRESHED` and `SIGNED_IN`, so the worker always returns the newest pair.
3. "Bring it back here" (`reclaim` on the `room-page:<roomId>` port): the worker sends `stop` to the panel in that room's tab. The panel stops token refresh, leaves voice, calls `RoomController.handOver()` (presence untracked, touch timer and channels stopped), suspends the engine, writes its last tokens, closes realtime and answers `stopped`. The worker waits up to 4 seconds for that answer, then sends `{ type: 'return', room_id, session }` with the newest pair and forgets the session. The panel shows "Watching back on the room page". A `reclaim` sent as a one off message gets the same `return` message as its reply.
4. When the streaming tab closes, the worker sends `return` to every open `room-page:<roomId>` port for that room; with none open it drops the session and the member stops being present after 60 seconds.
5. When the panel reaches any other end state (the member left, was removed or banned, the room closed, the engine session was replaced, or the room could not be resumed), it stops refreshing, writes its last tokens and sends `release`. The worker returns the session to an open room page at once, or to the next one that connects, and otherwise drops it when the tab closes. The prompt covers only "Bring it back here" and closing the tab; without this, leaving from the panel would leave the member signed out of the web app.
6. A second handover of the same room stops the panel in the earlier tab ("You opened this room in another tab, so this one stopped.") and binds the new tab.

### Ports between the content script, the panel and the worker
Date: 11 October 2026
1. The content script connects with the name `content` and the panel with `panel`. The worker pairs them by `sender.tab.id`, one pair per tab; a second connection of the same kind for a tab replaces the first and disconnects it. The pairing is `PortPairing` in `src/background/pairing.ts`, a pure module with unit tests. `window.postMessage` is never used between them.
2. The worker accepts a `content` port only from the top frame of a streaming service page and a `panel` port only from the panel page's own address. It validates every relayed message with the schemas in `src/shared/messages.ts`, and each receiver validates again and drops what does not match.
3. Worker to both sides: `peer` (whether the other side is connected). Worker to content: `bound` (whether the tab holds a room; the content script touches the page only when it does). Worker to panel: `bind` (the room id, or none) and `stop`. Panel to worker, never relayed: `stopped` and `release`.
4. Panel to content: `state`, `server_offset`, `hold`, `tap`, `resync`, `volume`, `suspend`, `navigate`, `panel_ui`, `fs_state`. Content to panel: `capabilities`, `view` (the engine view with the player's readings), `user_action`, `buffering`, `ended`, `content_ref`, `fullscreen`, `tap_result`, `fs_action`.
5. A `room-page:<roomId>` port is accepted only from the app's origins and with a valid room id. Only `reclaim` for that port's own room is acted on.
6. While a room is open the two sides exchange several messages a second, which keeps the worker running. If the browser restarts it anyway, the content script and the panel reconnect within a second and bring each other up to date (gap G38 covers the room page's port).

### The engine runs in the content script
Date: 11 October 2026
1. The content script runs `SyncEngine` with `VideoElementAdapter` from a page timer every 250 ms, and ticks at once on every `state`. Browsers slow page timers in hidden tabs to about once a second, which the once a second drift check tolerates; a tab playing sound is exempt from the stronger throttling. The engine is created on the first `state` and dropped on `suspend`.
2. The panel's `PortEngineHost` implements the room's `EngineHost`. It sends `server_offset` when the panel's clock offset changes by a millisecond or more (checked every 5 seconds and with every state), keeps the player readings that arrive with each `view` (four a second) and projects the position forward while playing.
3. Volume changes carry a sequence number that the content script echoes in its readings. Until a reading with that number arrives, `getVolume` returns the level sent, so ducking does not mistake an older reading for the member's own volume change.
4. "Tap to watch together" is tapped in the panel and played in the page: a click in a frame also counts as user activation for the frames that contain it. The panel waits up to 5 seconds for `tap_result`, then shows the tap button again.

### Panel timers run in a Web Worker
Date: 11 October 2026
The panel is usually visible, but the member may switch tabs while the film plays or sits paused, and after a few minutes hidden, page timers can slow to once a minute, which would make the member flap absent. The 20 second touch and the 60 second clock timers therefore run from a dedicated Web Worker (`src/panel/ticker.ts`), as on the room page, falling back to a page timer when a worker cannot start.

### The video element adapter
Date: 11 October 2026 (DEFAULT until spike S1, gaps G1, G36 and G39)
1. The active video is the visible one, then the largest, then one that is playing, then the longest. The adapter picks again on every DOM change and every 2 seconds, so it follows the services when they replace the element.
2. Capabilities come from one table, `S1_RESULTS` in `src/shared/services.ts`. Every service is `{ seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 }`, marked DEFAULT, because spike S1 has not run (decision rule 1; gap G1 stays open, and members see "Seek manually to stay in sync"). Seeking sets `currentTime` and is already written behind the flag, so flipping `seek` after S1 turns it on. Without `fineRate` only the normal rate is ever set.
3. Buffering is on with `waiting` (and with `stalled` when no data is ready) and off with `playing`, `canplay`, `canplaythrough`, `pause` and `emptied`.
4. A play, pause or seek counts as the member's own only within 1.5 seconds of their own click, tap or key press on the page, and a seek only when it moves more than 1 second. The services autoplay when a title opens, resume from the last position and make small seeks of their own; without this rule, a host opening the tab could start the room for everyone. The engine still filters its own changes as before.

### Episode changes
Date: 11 October 2026 (DEFAULT)
1. Titles are compared by a key read from the address, so tracking parameters do not matter: Netflix `/watch/<number>`, Prime Video `/detail/<id>` or `/dp/<id>`, Disney+ `/video/<id>` or `/play/<id>` (gap G36).
2. When the host's tab moves from one title to another, the panel calls `controller.setSource(source, newRef)`, which resets the room to paused at the start. When the host's tab opens on a title other than the room's (a service redirect, for example), the room is not changed silently: the host sees "This tab is on a different title than the room" with "Play this for everyone" and "Go back".
3. A guest whose tab is on another title sees "You're on a different episode than the host" with "Go to the host's episode", which opens the room's title in the same tab; the content script refuses to navigate to any other site. Meanwhile the panel detaches the engine, so it does not play or pause the wrong title.

### Panel and full screen control
Date: 11 October 2026
1. The panel is 360 pixels wide, docked right over the page without resizing it, inside a closed shadow root. Its host element and toggle tab are styled through element style properties, which a page's CSP does not block. The header's hide button and the tab collapse it; it keeps running while collapsed.
2. The panel renders a narrow room from `packages/ui`: header, `SyncStatus`, `MemberStrip`, Chat and People tabs, a transparent `ReactionBand` floating over the list, the composer, and mic, camera, leave voice, react and leave controls, with the host's sheets, `MySettingsSheet`, member and message menus, reports and `VoiceAudio`. Voice uses `useRoomVoice` and ducking `useDucking`; the voice sheet and controls are small copies of the room page's, which live in the web app.
3. Fonts: the same three families as the web app, from `@fontsource-variable/big-shoulders`, `@fontsource-variable/hanken-grotesk` and `@fontsource-variable/jetbrains-mono`, set as `--font-marquee`, `--font-grotesk` and `--font-timecode`.
4. In full screen the content script puts a small control inside the full screen element: the microphone (mute and unmute an active voice call; joining voice needs the panel, where the microphone permission belongs), the count of chat messages from others since full screen began (tapping it leaves full screen) and a reactions tray. Spike S2 confirms it per service (gap G40).
5. Error sentences: `apps/web/lib/errors.ts` is web app code, not a shared package, so the panel has a copy in `src/panel/errors.ts`. A test fails if the two ever differ. Moving the file into `packages/ui` would remove the copy.

### Browser checks for the extension
Date: 11 October 2026
`apps/extension/e2e/detect.spec.ts` runs only with `EXTENSION_E2E=1` (`pnpm --filter @watchparty/extension e2e` after a build). It launches Playwright's Chromium in the new headless mode with the built extension, which loads there, and checks from `http://localhost:3000`: the worker runs under the fixed id; `ping` gets `pong`; a handover opens the title with the panel docked and the room page's port gets the session back; a handover to another site is refused; and, when the local Supabase stack is running and the build used its address and anon key, a real session handed over resumes the room in the panel, switches the member to auto sync and comes back usable. When nothing answers on port 3000 a blank page is served there for the few seconds the checks take. Playwright's request routing does not catch the first navigation of a tab the extension opens, so the browser resolves `www.netflix.com` to a local HTTPS stub with a throwaway certificate instead, and Netflix is never contacted.

### Packages added for the sync extension
Checked on npm on 11 October 2026 for existence and licence.

| Package | Licence | Why |
|---|---|---|
| `@crxjs/vite-plugin` | MIT | Builds the extension from Vite: manifest, service worker, content scripts |
| `vite` | MIT | The extension's build tool |
| `@tailwindcss/vite`, `tailwindcss` | MIT | The shared design tokens and utility classes in the panel |
| `@fontsource-variable/big-shoulders` | OFL | Marquee face for the panel, bundled with the extension |
| `@fontsource-variable/hanken-grotesk` | OFL | Reading face for the panel |
| `@fontsource-variable/jetbrains-mono` | OFL | Timecode face for the panel |
| `@playwright/test` in `apps/extension` | Apache | The optional browser checks for the extension |
