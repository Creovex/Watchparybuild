# Acceptance criteria at handover

Each criterion from the build prompt, with the evidence that it is met or the gap that keeps it open. A criterion with any open gap is reported NOT DONE, even when the code for it is built (writing rule 5). Checked on 11 October 2026 in the cloud build container: Chromium only (Microsoft Edge is not installed there), no phones, no streaming subscriptions, no hosted accounts.

| # | Criterion | Status | Evidence or gap |
|---|---|---|---|
| 1 | Sign in with Google works on iPhone Safari, Android Chrome, desktop Chrome and desktop Edge (D9) | NOT DONE | Built (`components/SignIn.tsx`, `app/auth/callback`). No Google OAuth client exists yet (G21) and D9 has not run (G23). Every end to end test signs in through the same session code with the local stack's email form. |
| 2 | A host can create public and private rooms and share each link with the native share sheet on a phone (D9) | NOT DONE | Creating both kinds is covered by E1 and E2 (pass). The share sheet (`navigator.share`) is built on the new room ticket and in Room settings; D9 has not run (G23). |
| 3 | A private room refuses a missing or wrong key with a clear sentence (E2) | DONE | E2 passes: no key and a wrong key both show the `bad_key` sentence, the right key joins, and the key never stays in the address bar. |
| 4 | A free host's room admits 3 present members and refuses a fourth; a paid host's admits 10 and refuses an eleventh (E3, E11) | DONE | E3 and E11 pass. The concurrency script admits exactly 2 of 5 simultaneous joins in all 5 rounds. |
| 5 | YouTube stays in sync on all four browsers: 3 seconds after every play, pause and seek, position within 0.6 seconds of expected (E4, D1, D2, D9) | NOT DONE | E4 passes in Chromium with the stub player. Edge was not available (E4 runs in Edge with `E2E_EDGE=1`). D1, D2 and D9 have not run (G23); YouTube refused playback to the build container's data centre address, so real YouTube playback is unproven there (the player, its API and the error path were checked). |
| 6 | The engine follows every rule in "Engine loop" (Phase 2 tests) | DONE | `packages/sync-core`: 119 tests, 99.8 percent line coverage; every step, drift branch, limit, the 3 strike stop and reset, and change matching are tested. |
| 7 | Paid sources auto sync on desktop Chrome and Edge for every capability S1 passed; each failed capability has a gap (D5 to D7) | NOT DONE | The sync extension is built and tested (128 unit tests; in headless Chromium a real handover resumed the room in the panel and "Bring it back here" returned a working session). Spike S1 has not run (G1, G2, G23, G36, G39), so every adapter ships with seek off, and D5 to D7 have not run. The panel's microphone and full screen control wait on S2 (G12, G40). |
| 8 | Phones and extensionless desktops in paid source rooms get cue sync with a countdown and cue controls (D8) | NOT DONE | Built: the countdown leader, "Open in" links, "I'm paused at", "Where am I?" and a controller's play, pause and jump to. D8 has not run (G23). |
| 9 | Voice connects for 3 members in a mesh room and for every member of a server room, with mute, camera toggle and speaking rings (E7, D3, D4) | NOT DONE | E7 passes (two members, mesh, fake media: both connect and speaking fires). Server voice needs LiveKit (G21); D3 and D4 have not run (G23). A full 10 person voice test needs 10 devices and is not run. |
| 10 | Ducking lowers movie volume while others speak and restores it, wherever the adapter supports volume (D3, D5 to D7) | NOT DONE | Built and unit tested (`Ducker`, fades, release, manual change). D3 and D5 to D7 have not run (G23). |
| 11 | Chat, reactions and timed comments reach other members within 1 second locally (E6) | DONE | E6 passes: chat under 1 second, the timed comment reappears when the other member passes it, a reaction reaches the other member. |
| 12 | Wait for everyone pauses and resumes around a buffering member (E12) | DONE | E12 passes: pause within 3 seconds, resume within 3 seconds, a host pause is never resumed. |
| 13 | The host can lock, remove, ban, allow back, mute and unmute voice, transfer host and close the room (E8, E13, E14) | DONE | E8, E13 and E14 pass. |
| 14 | Every read rule, RPC code and Edge Function code has a passing test (Phase 3 and Phase 5 exit checks) | DONE | `pnpm db:test`: 526 pgTAP assertions pass. `pnpm fn:test`: 68 Deno tests pass, covering every code each function lists. S6 passes. |
| 15 | No secret value appears in the built web app or extension | DONE | See "Secret scan" below. |
| 16 | Every error code has a sentence; no raw error reaches the screen (Phase 7 test) | DONE | `apps/web/test/errors.test.ts` passes for every RPC, Edge Function and voice code; unknown codes fall back to the `internal` sentence, and the error page shows only that sentence. |
| 17 | `docs/gaps.md`, `docs/decisions.md`, `docs/spike-results.md` and `docs/device-matrix.md` are complete and follow the writing rules | DONE | All four are written; a scan found no dash punctuation and no version numbers in authored text. |
| 18 | The app installs as a PWA on iPhone and Android and a hidden desktop tab stays present (D10, D11) | NOT DONE | Manifest, icons and the Web Worker timer are built. D10 and D11 have not run (G23). |
| 19 | When the host leaves or goes absent, the present guest who joined first becomes host (E9) | DONE | E9 passes for both cases. |

## Secret scan

Done on 11 October 2026.

1. The web app was built (`next build`) with sentinel values in every secret variable the project has (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`) and with the local stack's real service role key in `SUPABASE_SERVICE_ROLE_KEY`. A search of `apps/web/.next` found none of those values, and none of the local stack's JWT secret, secret API key or storage secret.
2. The extension was built and `pnpm --filter @watchparty/extension verify-dist` passed: no JWT with a role other than `anon`, no `sb_secret_` key, and the local service role key absent. A separate search of `apps/extension/dist` for the local stack's service role key, JWT secret and secret API key found none of them. Only the anon key and public addresses are present, as intended.
