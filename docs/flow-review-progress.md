# Movie and Android flow review

## Scope and stopping rules

Review the journey from finding the app through sign in, upload, recovery, invitations, playback, deletion and Android installation. Keep the existing production deployment available. Never advertise an unsigned Android package as installable.

Record each finding once. After a fix, run its focused check and include it in one final regression pass. Reopen a passing check only when a subsequent change affects it. Recheck external configuration once during this review; if it is still unavailable, record the exact blocker instead of retrying without new access.

## Review progress

| Flow | Starting evidence | Current work |
| --- | --- | --- |
| Find Android download | Download page exists but is absent from public navigation | Added public navigation and installation states; signed APK and encrypted key backup verified; publication requires matching live website association |
| Select and upload | Local upload passes; missing R2 browser headers block production | Production preflight, readable identifiers, browser upload, completion and seeking now pass |
| Pause and resume | Reopening the tab passes; same-tab pause leaves the new-upload action active | Fixed same-tab recovery, preserved the selected file and title, and prevented duplicate reservations; focused browser check passed |
| Watch and invite | Two-browser play, pause, seek and private invitations pass | Added pending actions, explicit copy, native focus trapping and Escape; expanded browser checks passed |
| Delete and retry | Storage leases and deletion checks pass | Added pending states and prevented overlapping actions; deletion browser check passed |
| Narrow screens | No complete visual review recorded | Fixed room-card and file-picker overflow; long-title checks passed at widths of 320, 390 and 1280 pixels; screenshots inspected |
| Legacy playback and voice | Timed comments and mesh voice fail browser acceptance | Timed-comment check now waits for actual guest seeks; all fourteen remaining legacy checks passed; voice is blocked by managed media policy |
| Production release | Implementation pushed; Vercel preview succeeded | Repository default and Vercel Production now track main; live routes and all movie browser flows verified |

## Existing checks retained

The implementation commit passed 436 unit checks, 91 function checks, 548 database assertions, concurrency checks, type checking, production builds and five movie browser checks using local compatible storage. Real R2 multipart requests and partial reads passed separately. These results do not establish a working production browser upload or signed Android release.

## Release blockers to verify

- Confirmation of the requested one-day bucket incomplete-upload cleanup rule.
- Live website certificate association before publishing the signed APK.
- Repository signing secrets for future automated builds; the initial release can be signed locally from the preserved identity.
- Real-phone installation, Google sign in, media permissions and private room links.

No environment configuration will be republished as part of this review.

## External evidence

The earlier R2 check returned a forbidden browser preflight. After the owner's configuration change, production preflight returned success and the upload response allowed the production origin and exposed its part identifier. Actual production upload, completion, repeated completion and partial playback reads passed. Temporary hosted accounts and objects were deleted afterward.

The owner changed the repository default to `main`. A fresh push also produced a successful Vercel Production deployment. Both source commit and environment were verified, and the live Android and website association routes respond successfully.

Voice diagnostics exchanged offer and answer successfully on both clients. Neither browser produced a media connection candidate. The managed Chromium policy sets `WebRtcIPHandling` to `disable_non_proxied_udp`, while the local test uses direct media with STUN, the server used to discover connection addresses. The policy was not changed. Voice acceptance needs an appropriate permitted relay configuration or a real device on a supported network. A successful signaling exchange alone is not a voice pass.

A separate production credential check succeeded and returned direct STUN servers. Relay credentials are not configured, so strict-network voice remains limited. The temporary voice-check room and account were removed. Actual audio between phones remains unverified.

## Final verification

All eight movie browser checks passed and screenshots were inspected. All fourteen remaining legacy checks passed in one final run, including timed comments, private joins, chat, reactions, room caps, moderation, account deletion, play, pause, seek and buffering coordination. The voice check remains explicitly blocked by the diagnosed managed policy and was excluded from this final run rather than retried under unchanged conditions.

All 439 unit checks, workspace type checks, production builds and extension output verification passed. The staged credential scan passed. The screenshot review confirmed that the narrow layout contains room cards, long movie titles, navigation and the file picker within the viewport. Backend verification from the implementation remains retained; no backend code changed during this review. Temporary local and hosted review accounts and their storage were cleaned up.

All eight movie cases have subsequently passed against the actual production website and R2, including multipart recovery, same-tab pause/resume, permission refusal, invite copying, deletion during playback, phone layouts and bounded two-browser drift. One test initially allowed only five seconds for a large part to arrive. Its network allowance was corrected to match the other multipart case, then only that case was rerun and passed. Application behavior was unchanged.

Production test cookies now follow the configured HTTPS site origin and support session chunking. Temporary production browser accounts and their stored movies were removed after the checks. Scheduled movie housekeeping and cleanup jobs are active, their latest runs succeeded, and recent worker HTTP responses succeeded.

## Handoff

The website is live from `main`, and actual browser uploads work. The previous deployment is retained for rollback. The signed Android package has been verified for signature, alignment, package identifier and label. Its permanent identity is backed up in encrypted project Vault and the backup has been read back successfully. No signing key or password is committed or sent in chat.

The initial APK was published to separate public download storage after its actual certificate matched the production website association. Its signature and downloaded bytes were verified, and the public manifest records its immutable URL and checksum. The website checks availability before offering the download. Google Play publication is not required. Device acceptance remains open afterward. The owner should keep an additional independent signing backup and configure repository secrets before using automated future releases; see `apps/android/README.md`.

## Deployment follow-up

The fresh `main` push `16829e0` produced a successful Production deployment and made the Android page available on the live domain. Browser tests then ran against that live domain rather than a preview or local emulator. This closes the earlier production-branch and browser-CORS gates.

The Android certificate update adds the real public release fingerprint to the website association and leaves the private identity outside Git. The three new association checks passed with the current web suite, for 63 web unit checks. Workspace type checks passed. The Android workflow build-number check confirms that automated updates follow the initial release rather than reusing its build number.

The production certificate matches the signed APK. The integration refused the GitHub binary upload, so the initial package and checksum are hosted in a dedicated public application-download bucket. Anonymous and ordinary-account writes were refused. The website uses this verified artifact if the repository feed is unavailable. Phone installation, sign in, media permissions, private links and iPhone fullscreen remain separate manual gates.

## Release receipt and stop point

Application commit `1e8e4e9` was pushed to `main` and verified as a successful Vercel Production deployment. The live homepage and Android page both responded successfully. The final targeted web suite passed all 66 checks, and workspace type checks and the production build passed. The earlier unchanged backend and movie-flow results remain retained.

The actual download button at `https://synvello.vercel.app/android` was clicked in Chrome. It downloaded `synvello.apk`, with a size of 1115926 bytes. The downloaded checksum matched the public manifest, its package signature verified, and its certificate matched the live website association. The checksum is `b7a6ab5ecda1be2cb8c79218e1973facd52cc874255da9d2088f1b02662479cb`. Screenshots of the live download page were inspected. All temporary review accounts and movies were removed, and the two approved uploader accounts remain.

Implementation and deployment verification stop here. Do not rerun passing checks without a relevant change. Remaining acceptance needs a real Android phone for installation, Google sign in, microphone/camera, fullscreen and private invitation links, plus the separate iPhone checks. Confirm the requested bucket lifecycle rule and keep an independent signing backup. Future automated repository releases need the documented signing secrets. None of these pending checks is represented as already passed.

## MKV support follow-up — 2026-11-12

MKV selection now prepares a browser-compatible H.264/AAC MP4 on the device before the existing upload flow. Compatible H.264 video is copied; AC-3/E-AC-3, DTS and TrueHD primary audio can be converted to AAC. Other video codecs need device decoder support. The app reports preparation progress, supports cancellation, and keeps the completed temporary copy for byte-identical recovery after reload. Extra audio tracks and subtitles are not imported. Both source and output retain the 5 GiB limit, and temporary device disk space is required.

The eight focused browser cases passed: five audio formats with playback, seeking, independent FFmpeg decoding, matching H.264 frame hashes and identical recovery after reload; damaged input; VP9 video conversion; and cancellation followed by another selection. The production Next.js build also passed a full local browser MKV selection/preparation/upload/watch/seek case against the local backend and compatible multipart storage. All 66 web unit checks, workspace type checks, frozen lockfile validation and production builds passed. Run the codec cases with `pnpm exec playwright test -c playwright.mkv.config.ts`; the upload case is E24 in the movie acceptance suite.

A production-storage browser attempt stopped before selection because Chromium rejected the managed environment's proxy certificate. Automatic review rejected adding that certificate to the persistent browser trust store; TLS verification was retained and no trust change was made. Local upload acceptance used the separate local stack instead. Temporary hosted review accounts were removed. The existing real-phone acceptance gates remain open, including large-file preparation and HEVC/device compatibility. No unrelated passing checks were reopened.

MKV implementation commit `477b408` was pushed to `main` and its Vercel deployment succeeded. The live media-library notice matched the new implementation over verified HTTPS. The production browser gate above remains distinct from that deployment result.


## Upload progress and synchronization follow-up — 2026-11-12

Upload progress now tracks bytes in flight for each of the three concurrent multipart requests, instead of waiting for a whole 16 MiB part to finish. Completed and in-flight bytes are added without double counting, failed attempts are removed before retry, and pausing aborts each request. The full-width amber bar stays visible while paused, MKV preparation has its own determinate/working indicator, and shared storage uses the same styling. Remaining-time estimates wait for an initial measurement and are omitted on recovered uploads rather than treating recovered bytes as newly transferred.

All 69 web unit checks passed, including transport progress, cancellation and expired-URL responses. Web type checks and production builds passed. The throttled browser upload case observed nonzero progress before any multipart receipt existed, and pause/resume retained the same upload. Mobile active and desktop paused screenshots were inspected. The dedicated two-viewer movie case passed play, pause, seek and resume; two ten-sample windows measured maximum differences of 0.022 seconds during playback and 0.023 seconds after seeking and resuming. A newly prepared MKV with Dolby sound was also uploaded and played by two viewers with a seek-alignment check below 0.3 seconds. These are local-stack browser measurements, not a guarantee for every device or network. The earlier real-phone and production-browser certificate limits remain open.

## Desktop fullscreen and shared playback repair — 2026-11-12

The room now enters native fullscreen when available and expands the same mounted player over the full window if the request is refused. Header/chat panels are covered, video retains its aspect ratio, keyboard focus stays out of the covered room, and Escape or Exit fullscreen restores the room. The browser's own video fullscreen control is available again. Four focused browser cases passed for full viewport playback without remounting the video, refused requests, missing-standard-API landscape behavior, and native API enter/exit events. Desktop and landscape screenshots were inspected.

Uploaded movies now publish a timeline drag at `seeking` rather than waiting for new media data and `seeked`. Native player events are filtered once, removing the extra five-second/one-second seek matching that could swallow a nearby user drag. Small shared seeks align directly, native movie drift above 0.25 seconds is corrected directly, and native seeks do not add the generic player's estimated seek latency. Play, playing seeks and buffer resumes use a common start time one second ahead. Unauthorized guest controls realign immediately. Rapid user playback requests are serialized, adjacent pending seeks coalesce to the final target, and a stale user request is retried once against the latest room state.

A network `stalled` event no longer marks a movie as buffering when its current position already has playable data. Readiness is also cleared by loading/progress/seek events while room playback is paused, so a pause does not require a new `playing` event to recover. Member readiness writes are serialized and use the latest state, preventing a delayed buffering update from overwriting a newer ready update. Engine attachment reports its actual initial readiness.

All three two-browser playback cases passed after the repair: sustained play/pause/seek/resume; small and rapid host drags with delayed playback requests and rejection of independent guest seeks; and stalled-download/real-buffer-pause recovery with a deliberately delayed buffering write. The final sustained playback samples measured maximum differences of 0.001 seconds while playing and 0.031 seconds after seek/resume. The 124 sync-core, 74 web and six UI unit checks passed, as did workspace type checks and the production build. Browser checks used the local stack and temporary storage; temporary review accounts and rooms are cleaned afterward. Existing real-device and production-browser certificate gates remain separate. The owner requested that microphone work be skipped, so no voice implementation or relay configuration changes are included.


### Backward seek and admin-only movie controls — 2026-11-12

- Addressed a gap where an incoming movie position updated shared state but playback alignment could be skipped while the old position buffered, autoplay was blocked, or drift correction had stopped. New movie states now seek the actual adapter immediately, independently of those conditions.
- Native seeks remain buffering until seeking ends and current data is ready; old buffered frames no longer count as readiness during a seek.
- Uploaded movies expose native playback controls only to the room admin. Guests retain the room fullscreen and volume controls. Server `set_playback` rejects guest user actions even in existing upload rooms with `control_mode=everyone`; room settings explain the admin-only policy. Explicit host transfer retains the existing admin semantics.
- Five requested two-browser scenarios passed: backward seek paused, backward seek playing, rapid alternating drags with delayed commands, backward seek while the guest buffers, and guest UI/API control rejection. Frame checks use `requestVideoFrameCallback.mediaTime`, verifying frames submitted for display instead of only room/currentTime values. The guest attempted-play test accepts only the expected AbortError when enforcement interrupts it, then verifies both players' status.
- Four additional movie scenarios passed: delayed media loading/rejoin after a newer backward seek, sustained play/pause/seek (maximum sampled drift 0.007s playing and 0.016s resumed), small/rapid seeks, and buffering recovery with reordered readiness requests. The explicit buffer signal case is simulated; the delayed media response case holds the actual HTTP response. These are local Chromium tests, not claims of testing the users' computers or every codec/file.
- Four fullscreen cases, 126 sync-core unit tests, 75 web unit tests, 6 UI unit tests, 170 database assertions (playback, host controls, movie isolation), workspace types and production build passed.
- Reviewed the Supabase security advisor results before changing the RPC: existing definer functions intentionally mediate access with auth/member checks, private tables deny direct access, and existing filtered views are unchanged. This change preserves grants/search_path and tightens the user-action check; it introduces no new exposure. Advisor references: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view.
