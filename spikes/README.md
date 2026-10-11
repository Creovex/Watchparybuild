# Spikes

A spike is a short throwaway experiment that proves or disproves one risky assumption before the build depends on it. This folder holds spike code only. It is deleted after Phase 1; the results live in `docs/spike-results.md`.

## S1 probe: paid source control

`s1-probe.js` checks what a script in a Netflix, Prime Video or Disney+ tab can do with the page's video element. It tries each capability 10 times in a row: find the video, play, pause, read the position, buffering events, volume, rates 0.95 and 1.05, and seeking by `currentTime`. On Netflix it also tries a seek through Netflix's own player, which an extension could only use from a script injected into the page's main world (the page's own JavaScript context).

To run it, on desktop Chrome and then Edge, for each service:

1. Sign in to the service and start playing any title.
2. Open the developer tools (F12) and go to Console.
3. Paste the whole of `s1-probe.js` and press Enter. Leave the tab in front.
4. When the probe asks, turn on network throttling (developer tools, Network, Slow 3G) for the buffering check, then turn it off when it says so.
5. Copy the printed table row into the S1 table in `docs/spike-results.md`, fill in the watch path pattern and the content reference format by hand, and note anything odd (an error screen after seeking, the volume resetting).

Seeking by `currentTime` runs last because a service may show an error screen afterwards. If it does, that capability is FAIL; reload the tab before the next service.

The probe changes nothing outside the tab and sends nothing anywhere.
