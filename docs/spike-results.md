# Spike results

A spike is a short throwaway experiment that proves or disproves one risky assumption before the build depends on it. Each result is `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`, with device, browser, date and observations. Spike code lives in `spikes/` and is deleted after Phase 1; this file keeps the results.

The build ran in a cloud container with no phone, no desktop browser with a screen and no streaming subscriptions, so every spike that needs one is BLOCKED and its question is under "Waiting for James" in `docs/gaps.md` (Q5). The checklists below are written so James can run each spike and fill in the result.

## S1: Paid source control from a content script
Result: BLOCKED (needs Netflix, Prime Video and Disney+ subscriptions and a desktop Chrome and Edge; gap G23)
Date: 11 October 2026
Question: Per paid source on desktop Chrome and Edge, can a content script find the video element, play, pause, read position, detect buffering, set volume, set rates 0.95 and 1.05, and seek? Which seek works: setting `currentTime`, or calling the page's own player from a script injected into the page's main world? What are the watch page address patterns and content reference formats?
Pass rule: each capability works 10 times in a row with no error screen.
How to run: load `apps/extension` unpacked, open a title, open the extension's service worker console and run the probe in `spikes/s1-probe.js` from the page console. It prints one line per capability.

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
Result: NOT RUN (runs in Phase 3 against the local stack)
Date:
Question: A non member is refused both topics; a member can receive both and send only on the client topic; after an epoch change the removed user cannot join the new topics, and the old topics fall silent once remaining members have moved.
Pass rule: every assertion in `supabase/tests/realtime/s6.test.ts` passes.
