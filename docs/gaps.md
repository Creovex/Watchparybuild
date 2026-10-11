# Gaps and open questions

A gap is anything this build could not prove, decide or finish. While a gap is open, every item it affects is reported as not done. Gaps G1 to G19 came with the build prompt; gaps found during the build start at G20.

Status values: `OPEN`, `ACCEPTED` (James agreed to ship with the limitation; still reported at handover), `CLOSED BY EVIDENCE`, `CLOSED BY DECISION`.

## Waiting for James

Questions are written here because most answers are account credentials, which belong in `.env.local` and the Supabase dashboard, never in a chat log. Each has a recommended option first.

### Q1: Supabase project for preview testing (gap G21)
Create the free project `watchparty-dev` and put its URL and anon key in `apps/web/.env.local`?
1. Yes, James creates it and pastes the two values into `.env.local` (recommended: nothing else in the preview environment works without it).
2. Use only the local stack on a machine with Docker for now.

### Q2: Google OAuth client (gap G21)
OAuth means the open standard Google sign in uses to hand a signed identity to the app.
1. James creates a Google Cloud OAuth client of type "Web application" and pastes its id and secret into Supabase Auth, Providers, Google (recommended: sign in is required for everyone).
2. Defer; test with email and password on the local stack only.

### Q3: Voice accounts (gap G21)
1. James creates a LiveKit Cloud project and a Cloudflare Realtime TURN key and stores them as Edge Function secrets (recommended: both free allowances cover testing).
2. Mesh voice only for now with STUN, which fails on strict networks.

### Q4: Fixed preview domain (gap G22)
The sync extension's `externally_connectable` list cannot use a `vercel.app` wildcard.
1. A Vercel branch alias such as `watchparty-dev.vercel.app` pinned to the `dev` branch (recommended: free, fixed, no domain purchase).
2. A subdomain of a domain James owns, such as `dev.<domain>`.

### Q5: Test kit (gap G23)
Spikes S1 to S5 and the device matrix need two subscriptions each to Netflix, Prime Video and Disney+ (one per person), one iPhone, one Android phone and two desktops with Chrome and Edge.
1. James confirms the kit and runs the spikes using `docs/spike-results.md` as the checklist (recommended: every paid source decision depends on them).
2. Run YouTube only device rows first and defer paid sources.

### Q6: Signed out guests (gap G9)
1. Keep sign in required for guests (recommended: it is the current DEFAULT and the database rules depend on a signed in user).
2. Allow anonymous guests, which needs Supabase anonymous sign in and a review of every policy.

### Q7: Accept known limits for testing (gaps G13, G15, G18, G20)
1. Mark G13 (movie audio reaching the microphone), G15 (videos that block embedding), G18 (client topic senders not verified) and G20 (the moderate RPC callable without the Edge Function) ACCEPTED for testing and revisit before launch (recommended: none affects two people testing, and each has a tip, a sentence or a later fix ready).
2. Fix G18 and G20 before testing starts.

## G1: Seek method for paid sources
Status: OPEN
Found in: build prompt
What is unknown: No official source confirms a reliable seek method for Netflix, Prime Video or Disney+ from an extension.
Effect on the build: The extension adapters ship with `seek` set by spike S1; until S1 runs, every paid source adapter reports `seek: false` and members see "Seek manually to stay in sync".
Next action: James runs spike S1.

## G2: Prime Video and Disney+ page structure
Status: OPEN
Found in: build prompt
What is unknown: Watch page structure and content reference formats for Prime Video and Disney+ are unconfirmed.
Effect on the build: Content references for paid sources accept any `https` address on the service's host; the extension matches the hosts' watch paths broadly.
Next action: James runs spike S1; the build then tightens the formats.

## G3: Paid sources in phone browsers
Status: OPEN
Found in: build prompt
What is unknown: Phone browser playback for Netflix, Prime Video and Disney+ is assumed unavailable without official confirmation.
Effect on the build: Phones get cue sync for paid sources.
Next action: James runs spike S4.

## G4: Cue sync drift
Status: OPEN
Found in: build prompt
What is unknown: Cue sync cannot measure or correct drift on its own.
Effect on the build: Cue sync members may be a second or more off. "Where am I?" is the only measurement.
Next action: Only a native app closes this; out of scope.

## G5: Streaming service terms
Status: OPEN
Found in: build prompt
What is unknown: The streaming services' terms may restrict third party control of their players; no legal review has been done. Teleparty and Rave operate this way.
Effect on the build: Risk to public launch, not to testing.
Next action: James gets legal advice before launch.

## G6: Vercel Hobby is non commercial
Status: OPEN
Found in: build prompt
What is unknown: Nothing; Vercel's free plan forbids commercial use.
Effect on the build: A public launch on Hobby breaches its terms.
Next action: Move to Vercel Pro before launch.

## G7: Supabase free projects pause
Status: OPEN
Found in: build prompt
What is unknown: Nothing; free projects pause after a week without activity.
Effect on the build: Testing pauses when idle; unfit for launch.
Next action: Move to Supabase Pro before launch.

## G8: No payments
Status: OPEN
Found in: build prompt
What is unknown: Billing is out of scope.
Effect on the build: A plan becomes `paid` only when James edits `profiles.plan` in the database.
Next action: James asks for billing when ready.

## G9: Sign in required for guests
Status: OPEN
Found in: build prompt
What is unknown: Requiring sign in for guests is a DEFAULT, not James's decision.
Effect on the build: Someone without a Google account cannot join.
Next action: James answers Q6.

## G10: No public room directory
Status: OPEN
Found in: build prompt
What is unknown: Whether public rooms should be discoverable.
Effect on the build: Public rooms are joinable by link only.
Next action: James asks for a directory if wanted.

## G11: YouTube playback rates
Status: OPEN
Found in: build prompt
What is unknown: YouTube is expected to lack the 0.95 and 1.05 rates on every device.
Effect on the build: The YouTube adapter checks `getAvailablePlaybackRates()` at load and uses seeks when the rates are missing.
Next action: James runs spike S5.

## G12: Microphone inside the injected panel
Status: OPEN
Found in: build prompt
What is unknown: Whether an extension page framed inside Netflix, Prime Video or Disney+ gets microphone access.
Effect on the build: Desktop voice in streaming tabs may need Chrome's side panel instead.
Next action: James runs spike S2.

## G13: Movie audio reaching the microphone
Status: OPEN
Found in: build prompt
What is unknown: Echo cancellation removes only audio played by the same page; the movie plays in another tab.
Effect on the build: Without headphones, others may hear the movie twice. The room shows a one time headphones tip on desktop.
Next action: James decides whether this is ACCEPTED.

## G14: iOS stops web voice when locked
Status: OPEN
Found in: build prompt
What is unknown: Nothing; iOS suspends web audio capture when the screen locks or the browser goes to the background.
Effect on the build: Phone voice drops when locked. The room shows a one time tip on iPhones.
Next action: Only a native app closes it.

## G15: YouTube videos that block embedding
Status: OPEN
Found in: build prompt
What is unknown: Some videos block embedding or need an age check.
Effect on the build: Those videos cannot be used; members see "This video can't be played outside YouTube."
Next action: James decides whether this is ACCEPTED.

## G16: Product name, domain, icons, terms and privacy
Status: OPEN
Found in: build prompt
What is unknown: The product name, domain, icon art, terms text and privacy text.
Effect on the build: The display name comes from `NEXT_PUBLIC_APP_NAME`; icons are generated from that name; terms and privacy pages carry placeholder text marked for James.
Next action: James supplies them.

## G17: Chrome Web Store fee and review
Status: OPEN
Found in: build prompt
What is unknown: The store's current fee and review rules.
Effect on the build: Publishing may cost money and time.
Next action: Check at publish time.

## G18: Client topic senders are not verified
Status: OPEN
Found in: build prompt
What is unknown: Supabase broadcast does not prove which member sent a client topic event.
Effect on the build: A malicious member could disrupt mesh signalling or spoof reactions and heartbeats in their own room. Server topic events cannot be forged.
Next action: James decides ACCEPTED for testing, or asks for signed signalling before launch.

## G19: Reports reviewed only in the dashboard
Status: OPEN
Found in: build prompt
What is unknown: Whether an admin screen is needed.
Effect on the build: There is no moderation tooling for a public launch.
Next action: James asks for an admin screen when needed.

## G20: The moderate RPC can be called without the Edge Function
Status: OPEN
Found in: Phase 3
What is unknown: The prompt says the `moderate` RPC (Remote Procedure Call: a Postgres function the client calls through Supabase) is called only by the `moderate` Edge Function, and also that the function calls it with the caller's JWT (JSON Web Token, the signed token Supabase issues to a signed in user). Both together mean any host can call the RPC directly, so the database changes but LiveKit is not told.
Effect on the build: In a server voice room a host who bypasses the app could mute or remove someone in the database while LiveKit still lets them publish until their token expires (10 minutes) or they reconnect. The app itself always goes through the Edge Function. Mesh rooms are unaffected.
Next action: James decides ACCEPTED, or asks for the RPC to require a header that only the Edge Function sets.

## G21: Accounts and keys not provided
Status: OPEN
Found in: Phase 0
What is unknown: The Supabase project, Google OAuth client, LiveKit Cloud project and Cloudflare TURN key.
Effect on the build: Nothing that needs a hosted service has run: Google sign in, server voice, TURN relay.
Next action: James answers Q1 to Q3.

## G22: Fixed preview domain
Status: OPEN
Found in: Phase 0
What is unknown: Which fixed domain serves the preview environment.
Effect on the build: The extension's `externally_connectable` list holds `http://localhost:3000` and a placeholder preview entry read from `NEXT_PUBLIC_SITE_URL` at build time.
Next action: James answers Q4.

## G23: Test kit not confirmed
Status: OPEN
Found in: Phase 0
What is unknown: Whether the subscriptions and devices listed in Q5 are available.
Effect on the build: Spikes S1 to S5 and every device matrix row are BLOCKED.
Next action: James answers Q5.

## G24: profile_public cannot use security_invoker
Status: OPEN
Found in: Phase 3
What is unknown: The prompt asks for views created with `security_invoker = true` so table RLS still applies, and also for `profile_public` to show the names of other people who share a room. A profile row is readable only by its owner, so an invoker view would show the caller's own row and nobody else's.
Effect on the build: DEFAULT taken: `profile_public` runs with its owner's rights instead of the caller's, is marked `security_barrier`, exposes only `id`, `display_name` and `avatar_url`, and returns only the caller and people who share at least one room with them in any membership state. The Supabase security advisor will list it as a view that bypasses RLS. Tested in `supabase/tests/database/01_read_access.test.sql`.
Next action: James decides ACCEPTED, or asks for another shape, such as a profiles policy for people who share a room combined with column grants limited to the three public columns.

## G25: Join key for members already in a private room
Status: OPEN
Found in: Phase 3
What is unknown: The prompt says `join_room` checks the key for private rooms, with no exceptions. E14 then has a joined member open the room in a second browser context, which has no key: the room page moves the key out of the address bar into the first tab's `sessionStorage`. Without an exception that second join returns `bad_key` and E14 cannot pass.
Effect on the build: DEFAULT taken: the key is not asked of a user whose membership row is already `joined`, or of the room's host. Everyone else, including a member who left, needs the current key, so rotating the key still shuts out old links. Tested in `supabase/tests/database/03_join_room.test.sql`.
Next action: James decides ACCEPTED, or asks for the key on every join, in which case the second context in E14 must be opened with the full room link.

## G26: Realtime public access on the hosted projects
Status: OPEN
Found in: spike S6
What is unknown: Hosted Supabase projects have a Realtime setting, "Allow public access", that must be turned off before Realtime refuses every channel that is not private. The local stack has no such setting and accepts public channels. S6 showed that a public channel with a room topic's name receives none of the database's private broadcasts, so room data does not leak, but while the setting is on anyone holding the project's public anon key can open public channels and spend the project's message quota.
Effect on the build: None on the local stack. On `watchparty-dev` and production, public channels stay usable until the setting is turned off.
Next action: James turns off "Allow public access" in the Realtime settings of `watchparty-dev` when creating it (Q1), and of the production project.

## G30: Voice credentials need the engine session
Status: OPEN
Found in: Phase 5
What is unknown: The prompt lists only `room_id` as the input of `turn-credentials` and `livekit-token`, yet requires the caller to be a "not replaced" member. Only the caller's `engine_session` (the value `join_room` returns) can show that, and the prompt does not say how the functions get it.
Effect on the build: DEFAULT taken: both functions require `{ room_id, engine_session }` and answer `not_member` when the session is not the member's current one. A closed room also answers `not_member`. The web app and the extension panel must send the engine session they hold.
Next action: James decides ACCEPTED, or names another way to tell a replaced browser context apart.

## G31: When speaking stops
Status: OPEN
Found in: Phase 5
What is unknown: The prompt says speaking starts once the level stays above the threshold for 150 ms but not when it stops.
Effect on the build: DEFAULT taken: speaking stops once the level stays at or below the threshold for 150 ms. Ducking adds its own 600 ms before restoring the movie, so the speaking ring may flicker between words while the movie volume does not.
Next action: James decides ACCEPTED or gives a release time; spike S3 can measure one alongside the threshold.

## G32: Camera size in server voice
Status: OPEN
Found in: Phase 5
What is unknown: The prompt sets 320 by 240 at 15 frames per second for mesh voice only, and asks for simulcast in server voice without a capture size.
Effect on the build: DEFAULT taken: server voice captures the camera at the same 320 by 240 at 15 frames per second, with simulcast on. At that size LiveKit sends fewer simulcast layers, which keeps phone uploads low in 10 person rooms.
Next action: James decides ACCEPTED, or asks for a larger capture in server voice after device row D4.

## G33: Edge Functions cannot boot in the cloud build sandbox
Status: OPEN
Found in: Phase 5
What is unknown: In the sandbox this build ran in, outgoing HTTPS passes through a proxy with its own certificate. The local edge runtime runs in Docker, does not trust that certificate and cannot download the functions' npm packages, so `supabase functions serve` answers every call with a boot error. It is not known whether this happens on James's machine; it should not.
Effect on the build: The functions were checked instead by running each `index.ts` with the repository's Deno against the local stack: preflights, `unauthorized`, STUN in test mode, `not_member`, `wrong_voice_mode`, the real `moderate` RPC and `delete-account` all answered as specified. `pnpm fn:serve` (`supabase/tests/functions/serve-local.ts`) now serves all four handlers from one Deno process, and with `E2E_FUNCTIONS_URL` pointing at it all fourteen Playwright tests passed in the sandbox on 11 October 2026, E7, E13 and E14 included. What stays unproven is the edge runtime itself serving them. Stopping `functions serve` also removed the stack's edge runtime container; `supabase stop` then `supabase start` brings it back.
Next action: Run `pnpm exec supabase functions serve` and the Playwright suite without `E2E_FUNCTIONS_URL` on a machine without that proxy, and record the result here.

## G34: How many LiveKit retries
Status: OPEN
Found in: Phase 5
What is unknown: "Retries the LiveKit call 3 times" can mean 3 attempts in all or 1 attempt and 3 retries.
Effect on the build: DEFAULT taken: 1 attempt and 3 retries, 250, 500 and 1,000 ms apart, so at most about 2 seconds pass before the host sees `voice_sync_failed`.
Next action: James decides ACCEPTED or asks for 3 attempts in all.

## G35: Environment variables the functions need for CORS
Status: OPEN
Found in: Phase 5
What is unknown: The prompt says the functions answer preflights for the site URL, the preview domain and the extension origin, but its table of environment variables has none the functions can read for them.
Effect on the build: DEFAULT taken: the functions read `SITE_URL`, `PREVIEW_URL` and `EXTENSION_ORIGINS` (comma separated `chrome-extension://<id>` origins) from their secrets. The local stack sets `SITE_URL` in `supabase/config.toml`. `.env.example` and the hosted projects' Edge Function secrets do not list them yet, so a hosted function answers preflights for none of them until they are set.
Next action: The lead adds the three to `.env.example`; James sets them as Edge Function secrets on `watchparty-dev` together with the LiveKit and Cloudflare secrets (Q3).

## G42: Handing over to the extension signs the browser's other tabs out
Status: OPEN
Found in: Phase 6
What is unknown: Whether James accepts that, during a handover, the app's other tabs in the same browser lose their session. The web app keeps the session in cookies every tab of the site shares, and the prompt requires the room page to remove it from its storage without signing out, because only one holder may refresh a session.
Effect on the build: While the extension holds the room, other tabs of the app in that browser behave as signed out until "Bring it back here" or closing the streaming tab returns the session. The room itself is unaffected.
Next action: James decides ACCEPTED, or asks for the extension to sign in with its own session instead of taking the page's.

## G36: Watch page addresses and title formats for the extension
Status: OPEN
Found in: Phase 6 (tied to G2)
What is unknown: Which addresses are each service's watch pages, and how a title is named in them. The extension uses DEFAULT patterns until spike S1 records them: Netflix `/watch/*`; all of `www.primevideo.com` and Amazon's `/gp/video/*`; Disney+ `/video/*` and `/play/*`, with or without a locale before them. While testing, real Netflix redirected a signed out `/watch/<id>` request to `/title/<id>?fromWatch=true`, a page the content script does not match.
Effect on the build: A room whose content reference is not a watch page cannot be handed over: the extension refuses it with `not_a_watch_page` rather than opening a tab with no panel. Prime Video matching its whole site may run the content script on pages that are not players (it stays idle there unless the tab holds a room). Title comparison for episode changes uses DEFAULT address patterns.
Next action: James runs S1 and records the patterns; then `WATCH_PAGES` (`apps/extension/src/shared/watch-pages.ts`), the title patterns in `apps/extension/src/shared/services.ts` and the content reference validation in sync-core and the database are tightened to match.

## G37: The room page shows one sentence for every refused handover
Status: CLOSED BY DECISION
Found in: Phase 6
What is unknown: How the room page should word a handover the extension refuses.
Effect on the build: Each refusal reason now has its own sentence in `apps/web/app/r/[slug]/Handover.tsx` (`not_a_watch_page` tells the host to set the address of the title while it plays, and tells a guest to ask the host), and the room page rejoins the room in place with the sentence as a notice instead of reloading.
Next action: James reviews the sentences with the others at handover.

## G38: The room page's return port does not reconnect
Status: OPEN
Found in: Phase 6
What is unknown: Whether the reopening below works when the browser really restarts the extension's service worker, which no test here triggers.
Effect on the build: `listenForReturn` in `apps/web/lib/extension.ts` now reopens the `room-page:<roomId>` port when it closes (backing off up to 30 seconds), and "Bring it back here" also sends `reclaim` as a one off message, which the extension answers with `return`. Until it is seen working after a real restart, a member could be left signed out of the web app if the worker restarts and the streaming tab is then closed.
Next action: During spike S2, stop the service worker from `chrome://extensions` while a room is handed over, then close the streaming tab and check the room page gets the session back.

## G39: Which player events count as the member's own
Status: OPEN
Found in: Phase 6
What is unknown: Whether the services' own autoplay, resume seeks and small seeks can be told apart from the member's play, pause and seek. DEFAULT taken: an event counts only within 1.5 seconds of the member's own click, tap or key press on the page, and a seek only when it moves more than 1 second.
Effect on the build: A member who controls the service's player some other way (media keys on the keyboard, a remote, the browser's own media controls) is followed by the room engine but does not move the room. A service that starts playing on its own does not start the room.
Next action: James checks during S1 and device rows D5 to D7 that pausing and seeking with the service's own controls move the room, and that opening a title does not.

## G40: Panel and full screen control on the real services
Status: OPEN
Found in: Phase 6 (tied to G12 and spike S2)
What is unknown: Whether each service's page lets the panel `iframe` load and use the microphone, and whether the floating control shows in each service's full screen view. It cannot show when a service makes the video element itself full screen, since a video element shows no children. The panel worked in a stub watch page in headless Chromium; no real service has been tried.
Effect on the build: If the panel cannot load or use the microphone on a service, voice there needs the browser's side panel instead (decision rule 3). In full screen the control can mute and unmute an active voice call and send reactions; joining voice and reading chat need the panel.
Next action: James runs S2 on each service in Chrome and Edge and records the results.

## G41: The extension's origin in the Edge Function secrets, and the Edge store id
Status: OPEN
Found in: Phase 6 (tied to G17 and G35)
What is unknown: Whether the hosted Edge Functions list `chrome-extension://appcjgbhipnbklhodimgbmjhbncljoip` in `EXTENSION_ORIGINS`, and which id the Edge Add-ons store gives the published extension.
Effect on the build: Until the origin is listed, `turn-credentials` and `livekit-token` refuse the panel's calls on a hosted project, so voice does not start in a streaming tab. A different Edge store id would need adding to `NEXT_PUBLIC_EXTENSION_IDS` and `EXTENSION_ORIGINS` as well.
Next action: James sets `EXTENSION_ORIGINS` with the Edge Function secrets (Q3, G35); the store id is checked when publishing (G17).
