# Device matrix

Manual checks on real devices. Each row records the device, browser, date, who ran it and what was observed. Rows stay `NOT RUN` until someone runs them; no row was run during the build because the build environment had no phones, no desktop browser with a screen and no streaming subscriptions (gap G23).

| Id | Setup | Record | Result | Date | Notes |
|---|---|---|---|---|---|
| D1 | iPhone Safari guest, desktop host, YouTube | Tap to start; drift every minute for 10 minutes | NOT RUN | | |
| D2 | Android Chrome guest, desktop host, YouTube | Same as D1 | NOT RUN | | |
| D3 | Mesh voice: iPhone, Android, desktop on different networks | Connects; quality note; YouTube ducking on Android and desktop | NOT RUN | | |
| D4 | Server voice: same devices, host plan `paid`, cameras on | Same as D3 | NOT RUN | | |
| D5 | Netflix: desktop Chrome host, desktop Edge guest | Each capability; drift every 5 minutes for 30 minutes; ducking | NOT RUN | | |
| D6 | Prime Video: same as D5 | Same | NOT RUN | | |
| D7 | Disney+: same as D5 | Same | NOT RUN | | |
| D8 | Each paid source: desktop host, iPhone cue sync guest, then a desktop guest without the extension | Countdown start; guest's "Where am I?" offset 10 seconds after start; whether "Open in <service>" opens the app at the title | NOT RUN | | |
| D9 | Sign in with Google and YouTube sync on iPhone Safari, Android Chrome, desktop Chrome, desktop Edge | Works on each; native share sheet on both phones | NOT RUN | | |
| D10 | PWA install on iPhone and Android | Installs; opens full screen; sign in persists | NOT RUN | | |
| D11 | Room page left in a hidden tab for 10 minutes on desktop Chrome | Member stays present throughout | NOT RUN | | |

PWA means Progressive Web App: a website that can be added to the home screen and opened full screen.

## Drift log template for D1 and D2

| Minute | Expected position | Guest position | Drift (seconds) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |

## "Open in service" behaviour for D8

| Service | iPhone | Android | Desktop without extension |
|---|---|---|---|
| Netflix | | | |
| Prime Video | | | |
| Disney+ | | | |
