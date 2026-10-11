# Spike results

A spike is a short throwaway experiment that proves or disproves one risky assumption before the build depends on it. Each result is `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`, with device, browser, date and observations. Spike code lives in `spikes/` and is deleted after Phase 1; this file keeps the results.

The build ran in a cloud container with no phone, no desktop browser with a screen and no streaming subscriptions, so every spike that needs one is BLOCKED and its question is under "Waiting for James" in `docs/gaps.md` (Q5). The checklists below are written so James can run each spike and fill in the result.

## S1: Paid source control from a content script
Result: BLOCKED (needs Netflix, Prime Video and Disney+ subscriptions and a desktop Chrome and Edge; gap G23)
Date: 11 October 2026
Question: Per paid source on desktop Chrome and Edge, can a content script find the video element, play, pause, read position, detect buffering, set volume, set rates 0.95 and 1.05, and seek? Which seek works: setting `currentTime`, or calling the page's own player from a script injected into the page's main world? What are the watch page address patterns and content reference formats?
Pass rule: each capability works 10 times in a row with no error screen.
How to run: open a title on the service, open the browser's developer console on that streaming page itself, paste the contents of `spikes/s1-probe.js` and press Enter. It prints one PASS or FAIL line per capability, ready to copy into the table below (`spikes/README.md` has the details).

| Service | Browser | Find video | Play | Pause | Position | Buffering | Volume | Rate 0.95 | Rate 1.05 | Seek by currentTime | Seek by page player | Watch path pattern | Content reference format |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Netflix | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |
| Netflix | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |
| Prime Video | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |
| Prime Video | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |
| Disney+ | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |
| Disney+ | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | | |

Until S1 runs, every extension adapter ships with `seek: false`, `fineRate: false` and `volume: true` (decision rule 1; gap G1 stays open).

## S2: Panel microphone, endurance and full screen
Result: BLOCKED (needs subscriptions and a desktop with a microphone; gap G23)
Date: 11 October 2026
Question: Does the injected panel get microphone access in each paid source tab on Chrome and Edge, survive 2 hours with the tab visible and 10 minutes hidden, and does the floating control appear in full screen?
Pass rule: all three per service and browser.

| Service | Browser | Microphone in panel | 2 hours visible | 10 minutes hidden | Full screen control |
|---|---|---|---|---|---|
| Netflix | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Netflix | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Prime Video | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Prime Video | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Disney+ | Chrome | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Disney+ | Edge | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

## S3: Mesh voice across networks with TURN forced
Result: BLOCKED (needs an iPhone, an Android phone, a desktop and a Cloudflare TURN key; gaps G21 and G23)
Date: 11 October 2026
Question: Mesh voice between an iPhone on Safari, an Android phone on Chrome and a desktop on Chrome on two different networks, with TURN (Traversal Using Relays around NAT, a server that relays media when a direct path is blocked) forced through `iceTransportPolicy: 'relay'` using credentials made by hand from Cloudflare's API. Does audio connect, and which analyser threshold triggers on speech but not on room noise?
Pass rule: every pair connects within 5 seconds; threshold recorded as a number.
Until S3 runs, the speaking threshold is minus 50 dBFS (decibels relative to full scale), marked DEFAULT in `packages/voice/src/speaking.ts`.

| Pair | Connected | Seconds to connect | Notes |
|---|---|---|---|
| iPhone Safari and Android Chrome | NOT RUN | | |
| iPhone Safari and desktop Chrome | NOT RUN | | |
| Android Chrome and desktop Chrome | NOT RUN | | |

Speaking threshold: not measured.

## S4: Paid sources in phone browsers
Result: BLOCKED (needs subscriptions and phones; gap G23)
Date: 11 October 2026
Question: Do Netflix, Prime Video and Disney+ play in iOS Safari and Android Chrome?
Pass rule: PASS for a service and browser when a title plays for 2 minutes; otherwise FAIL.

| Service | iOS Safari | Android Chrome |
|---|---|---|
| Netflix | NOT RUN | NOT RUN |
| Prime Video | NOT RUN | NOT RUN |
| Disney+ | NOT RUN | NOT RUN |

## S5: YouTube on phones
Result: BLOCKED (needs an iPhone and an Android phone; gap G23)
Date: 11 October 2026
Question: YouTube on iOS Safari and Android Chrome: available playback rates, whether one tap starts playback, and seek latency.
Pass rule: PASS when one tap starts playback; rates and seek latency recorded either way.
Until S5 runs, the YouTube adapter reads `getAvailablePlaybackRates()` at load to set `fineRate`, and starts `seekLatencySec` at 0.3.

| Browser | One tap starts playback | Available rates | Seek latency (average of 5) |
|---|---|---|---|
| iOS Safari | NOT RUN | | |
| Android Chrome | NOT RUN | | |

## S6: Realtime authorization
Result: PASS
Date: 11 October 2026
Where: the local Supabase stack in Docker on the build container, driven by a Deno test with the Supabase JavaScript client over WebSocket. Four signed in test users: a host, a member, a member the host removes, and a non member.
Question: A non member is refused both topics; a member can receive both and send only on the client topic; after an epoch change the removed user cannot join the new topics, and the old topics fall silent once remaining members have moved.
Pass rule: every assertion in `supabase/tests/realtime/s6.test.ts` passes.
How to run: `pnpm db:s6` with the variables exported as in `supabase/tests/README.md`. The test is permanent and runs in about 50 seconds.

| Check | Result |
|---|---|
| Non member joins the server topic | Refused: `CHANNEL_ERROR`, "Unauthorized: You do not have permissions to read from this Channel topic" |
| Non member joins the client topic | Refused the same way |
| Members join both topics | `SUBSCRIBED` |
| Member broadcasts on the client topic | Acknowledged `ok`; the host receives it |
| Member broadcasts on the server topic | Acknowledged `error`; never received |
| Member tracks presence on the client topic | `ok`; the host sees the member |
| Member tracks presence on the server topic | `error`; the host never sees it |
| A database event (`chat`) on the server topic | Received by members |
| Non member joins a public channel with the server topic's name | Subscribes, but receives no database event |
| Host removes a member through the `moderate` RPC (Remote Procedure Call) | The `moderation` event `{ target, action: 'remove', new_epoch: 2 }` reaches the host, the member and the removed user on the epoch 1 server topic |
| Removed user joins the epoch 2 server and client topics | Refused, `CHANNEL_ERROR` |
| Removed user joins the epoch 1 server topic again on a new connection | Refused, `CHANNEL_ERROR` |
| Member joins epoch 3, ahead of the room | Refused |
| Events on the removed user's still open epoch 1 server subscription after a chat message and a title change | None; the remaining members received both on the epoch 2 topic |
| Removed user broadcasts on the epoch 1 client topic after the members moved | Acknowledged `error`; nothing reaches the members on the new topics |

Observations:
1. The local stack needed no configuration change for private channels: the policies on `realtime.messages` decide access exactly as the Realtime Authorization documentation describes.
2. The local stack also accepts public channels, but Realtime keeps public and private channels with the same topic name apart, so no database broadcast reached the public one. Hosted projects have an "Allow public access" Realtime setting that must be turned off (gap G26).
3. A refused join reaches the client as `CHANNEL_ERROR`, with the "Unauthorized" message, about 5 seconds after `subscribe` (measured twice on the local stack), not at once. Joins that are allowed answer `SUBSCRIBED` quickly. The room client should treat `CHANNEL_ERROR` on a room topic as final rather than retrying.
4. After the removal, the removed user's own send on the old client topic was answered with `error`, even though that subscription had been authorized when it joined. The design does not rely on this; the epoch change is what keeps server events away from them.
5. Payloads sent with `realtime.send` arrive with an extra `id` key when the row has none (decision "Server topic events" in `docs/decisions.md`).
