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
