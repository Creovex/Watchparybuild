# Movie and Android flow review

## Scope and stopping rules

Review the journey from finding the app through sign in, upload, recovery, invitations, playback, deletion and Android installation. Keep the existing production deployment available. Never advertise an unsigned Android package as installable.

Record each finding once. After a fix, run its focused check and include it in one final regression pass. Reopen a passing check only when a subsequent change affects it. Recheck external configuration once during this review; if it is still unavailable, record the exact blocker instead of retrying without new access.

## Review progress

| Flow | Starting evidence | Current work |
| --- | --- | --- |
| Find Android download | Download page exists but is absent from public navigation | Added public header and footer links, installation guidance, unavailable and website fallback states; no signed release exists |
| Select and upload | Local upload passes; missing R2 browser headers block production | Added loading retry, clear completion progress and file limits; live API upload and seeking passed; browser preflight remains blocked |
| Pause and resume | Reopening the tab passes; same-tab pause leaves the new-upload action active | Fixed same-tab recovery, preserved the selected file and title, and prevented duplicate reservations; focused browser check passed |
| Watch and invite | Two-browser play, pause, seek and private invitations pass | Added pending actions, explicit copy, native focus trapping and Escape; expanded browser checks passed |
| Delete and retry | Storage leases and deletion checks pass | Added pending states and prevented overlapping actions; deletion browser check passed |
| Narrow screens | No complete visual review recorded | Fixed room-card and file-picker overflow; long-title checks passed at widths of 320, 390 and 1280 pixels; screenshots inspected |
| Legacy playback and voice | Timed comments and mesh voice fail browser acceptance | Timed-comment check now waits for actual guest seeks; all fourteen remaining legacy checks passed; voice is blocked by managed media policy |
| Production release | Implementation pushed; Vercel preview succeeded | Repository default branch is now confirmed as main; a fresh deployment must verify Vercel production tracking; no signed Android asset exists |

## Existing checks retained

The implementation commit passed 436 unit checks, 91 function checks, 548 database assertions, concurrency checks, type checking, production builds and five movie browser checks using local compatible storage. Real R2 multipart requests and partial reads passed separately. These results do not establish a working production browser upload or signed Android release.

## Release blockers to verify

- Cloudflare bucket cross-origin resource sharing (CORS) and the requested incomplete-upload cleanup rule.
- Repository default branch and Vercel production branch administration.
- Permanent Android signing material, secure backup, repository signing secrets and website certificate association.
- Real-phone installation, Google sign in, media permissions and private room links.

No environment configuration will be republished as part of this review.

## External evidence

The live R2 check returned a forbidden browser preflight for the production origin. A server upload succeeded, but its response had no browser origin or exposed part identifier. Completion, repeated completion and partial playback reads passed. The temporary hosted account and object were deleted afterward. No further bucket-setting retry is planned until the owner supplies new configuration evidence.

The previous review found that the repository still defaulted to the old working branch. The owner has since changed its default to `main`, confirmed through the repository API. No published release currently contains `synvello.apk`.

Voice diagnostics exchanged offer and answer successfully on both clients. Neither browser produced a media connection candidate. The managed Chromium policy sets `WebRtcIPHandling` to `disable_non_proxied_udp`, while the local test uses direct media with STUN, the server used to discover connection addresses. The policy was not changed. Voice acceptance needs an appropriate permitted relay configuration or a real device on a supported network. A successful signaling exchange alone is not a voice pass.

## Final verification

All eight movie browser checks passed and screenshots were inspected. All fourteen remaining legacy checks passed in one final run, including timed comments, private joins, chat, reactions, room caps, moderation, account deletion, play, pause, seek and buffering coordination. The voice check remains explicitly blocked by the diagnosed managed policy and was excluded from this final run rather than retried under unchanged conditions.

All 439 unit checks, workspace type checks, production builds and extension output verification passed. The staged credential scan passed. The screenshot review confirmed that the narrow layout contains room cards, long movie titles, navigation and the file picker within the viewport. Backend verification from the implementation remains retained; no backend code changed during this review. Temporary local and hosted review accounts and their storage were cleaned up.

## Handoff

The fixes target `main`. Production promotion remains blocked by branch administration and missing bucket browser configuration. The existing live deployment is retained. The Android download page is implemented and discoverable, but it cannot offer an installable app until permanent signing, secure key backup, website association and a signed release are completed. Device acceptance is still required afterward.

Next external action: apply `infrastructure/r2/cors.json` in the bucket settings, confirm incomplete-upload cleanup, and change the repository default and Vercel production branches to `main`. Supply signing secrets through the provider settings, never chat. Retry production upload or media checks only after the relevant setting changes.

## Deployment follow-up

The repository default branch is now confirmed as `main`. Its latest tested application commit passed the Vercel preview build. The live production deployment still serves the earlier application and returns not found for the Android page and website association file.

This progress update supplies a fresh push to `main` after the owner reports changing branch settings. Inspect the resulting Vercel environment and commit before treating it as a production release. Retain the preceding production deployment for rollback. Application code and backend dependencies are unchanged, so the completed implementation checks remain valid.

After the deployment settles, check the live pages and upload flow once. If Vercel still creates only a preview, record that evidence and request the specific production setting rather than repeatedly pushing commits. Signing, device verification and any remaining R2 browser configuration are separate gates.
