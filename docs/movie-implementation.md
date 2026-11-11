# Uploaded movies and Android delivery

## Implemented behavior

Approved accounts upload compatible movies directly to the private R2 bucket. The account quota and the shared nine billion byte pool reserve the entire declared size before an upload starts. Every reservation and lifecycle transition locks the cap row first. Upload parts bind their content length in the signature, and completion reconciles provider parts and verifies the final object size and type.

The library supports posters, preview, resuming from the same file in the original browser, pausing, cancellation and deletion. Upload recovery records are held in IndexedDB, the browser's local database, with a fingerprint of the file's beginning and end. A resumed upload asks R2 which parts actually exist rather than trusting local progress. The server remains authoritative about quota and completion.

Movies become an automatic synchronization source through the existing engine. Owners create private rooms from a movie, members receive temporary playback links, and the normal play, pause, seek, buffering, voice, chat and reaction paths remain in use. The player renews expiring links without changing the shared position. Invitation metadata and posters require the private room key or existing membership; knowing a slug alone does not reveal the added movie metadata.

Deletion first clears movies from rooms and resets playback. Storage reservations remain charged until object, multipart and poster cleanup succeeds. A lease prevents completion and deletion from running concurrently and outlives the hosted function runtime. Account deletion blocks further uploads and cleans stored movies before removing account metadata. Scheduled jobs mark abandoned uploads for deletion and call an authenticated storage cleanup worker. Worker credentials are encrypted in Supabase Vault and never committed.

## Configuration

The owner selected two upload accounts. Their quotas are configured in the hosted profiles table; everyone else's quota remains zero. The total site allowance remains shared. The public storage origin is the default in `apps/web/lib/deployment.ts` and can be overridden with `NEXT_PUBLIC_R2_ORIGIN` for another environment.

Keep R2 credentials in Edge Function secrets only. The deployed cleanup worker additionally uses `MOVIE_CLEANUP_TOKEN`. Its encrypted Vault counterpart is `movie_cleanup_token`; `movie_cleanup_service_key` supplies the gateway credential and `movie_cleanup_url` supplies the endpoint. Refresh the gateway credential if the project rotates keys. No worker credential belongs in web configuration.

The standard Supabase command line tool rejects HTTP-proxy secret placeholders before making a request. `scripts/deploy-functions.py` uses the supported multipart management API and preserves gateway verification. For example:

```sh
python3 scripts/deploy-functions.py --project-ref zkemdupefosllskayozr movie-upload-start movie-upload-urls movie-upload-complete movie-upload-abort movie-delete movie-play-url movie-invite movie-cleanup delete-account
```

The script reads the existing securely injected token under either supported environment name. It prints deployment status, never credentials. Its dry-run option checks the source list without deploying.

## Verification evidence

- Real R2: a two hundred million byte multipart upload completed, an incorrect part length was refused, and reads from the middle and end returned only the requested bytes. The object was removed afterward.
- Hosted API: upload, completion retry, metadata privacy, owner playback and quota rejection passed using temporary accounts.
- Private posters: upload, metadata attachment and a key-authorized invitation passed; a wrong key was refused. The test objects were removed.
- Database: all eleven local SQL suites passed, covering 548 assertions. Parallel connections proved that competing reservations cannot exceed the shared allowance and account deletion blocks further reservations and storage attachment. Existing room-cap concurrency checks and all twelve realtime authorization steps also passed.
- Browser: actual R2 playback between two temporary accounts passed play, pause, seek and the specified drift threshold. Deletion stopped a room, and an account without permission saw no upload control and was refused by the API. An earlier hosted realtime startup stalled; joining now returns a recoverable error on subscription failure and bounds subscription wait time.
- Local compatible storage: all five movie browser checks passed, including browser upload into a private room, deletion during playback, quota refusal, a three-part upload resumed after closing and reopening the tab, and two-browser play, pause and seek. This used Moto, a local storage emulator, with real local database and function handlers. It does not substitute for the remaining R2 browser configuration check.
- Legacy browser suite: thirteen passed and two failed. The timed-comment check reproduced G43. The mesh voice check stayed in the connecting state in this environment. Neither failure is counted as a pass or hidden by retries.
- Web and extension unit suites, function suites, workspace type checks and production builds passed. A confirmed Next.js advisory was resolved by installing the patched release recorded in the manifest and lockfile.
- Android: the Bubblewrap project generated and compiled into an unsigned release package. Its helper library requires the minimum platform set in the manifest. The Gradle distribution checksum is pinned and verified.

## Remaining release gates

The owner applied browser cross-origin resource sharing (CORS), and actual production browser upload and interruption/resume checks now pass. The narrow object token cannot inspect bucket administration, so confirmation of the requested one-day incomplete-upload lifecycle rule remains open. Application cleanup jobs and recent worker HTTP responses were checked successfully.

The repository now defaults to `main`, and a fresh push produced a verified Production deployment. The live domain serves the movie library and Android page. The previous deployment is retained for rollback.

The Android package has a permanent signing key and a verified encrypted backup in project Vault. Package signature, name and alignment checks passed, and its certificate matches the production website association. The initial package and checksum are published in a separate public application-download bucket because the integration refused the GitHub binary upload. The website checks the artifact before offering the link. Automated future repository releases still need signing secrets, which the integration cannot configure. Real Android and iPhone checks remain outstanding, including Google sign in, microphone/camera permissions, verified links retaining private fragments and phone-specific codec support.

Android's official [developer verification guidance](https://developer.android.com/developer-verification) describes limited distribution to up to twenty devices without government identification or a registration fee. Other distribution paths and regional enforcement still need checking against the owner's actual audience before wider release.

Cloudflare's official [R2 pricing](https://developers.cloudflare.com/r2/pricing/) lists Standard storage at $0.015 per gigabyte-month, Class A operations at $4.50 per million, Class B operations at $0.36 per million and free direct internet egress. The monthly free allowance covers ten gigabyte-months, one million Class A operations and ten million Class B operations. These are account-level allowances, not a billing cap for this application. Its [lifecycle guidance](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) documents a default seven-day expiry for incomplete uploads; this project requests a shorter rule. Both sources were checked on 10 November 2026.

## Repeatable checks

Run the existing unit, function, type and build commands from the repository root. The added SQL suite is `supabase/tests/database/11_movies.test.sql`. With the documented local stack, run `pnpm db:movies` for movie reservation and account-deletion races. The legacy browser suite has failures in timed comments, G43, and mesh voice, G54; a complete browser pass is not claimed.

The separate movie browser runner uses a private file holding only temporary test sessions and explicitly refuses ordinary account emails. Configure `MOVIE_E2E_STATE_FILE` securely and run:

```sh
pnpm exec playwright test -c playwright.movies.config.ts
```

This runner covers browser upload, two-member playback, deletion during a room and permission refusal. Use temporary test accounts with a small quota and remove them and their test rooms afterward. Session files and test traces must not be committed. Do not describe unrun tests as passed.

For local storage, the private state file may also specify `backend` and `functions` origins. Run the web app with the corresponding public Supabase configuration, `NEXT_PUBLIC_FUNCTIONS_URL` and `NEXT_PUBLIC_R2_ORIGIN`. Configure the function server's R2 endpoint and credentials for the emulator only. Give the temporary uploader at least fifty million bytes of quota for the three-part recovery fixture. The runner creates that fixture under the ignored `e2e/.auth` directory. Moto does not prove provider signature enforcement; retain the separate real R2 proof for that check.

## Flow review

The subsequent review fixed same-tab pause and resume, duplicate storage and room actions, library loading retry, preview and invitation keyboard access, and phone overflow in room cards and file pickers. Android is discoverable from public navigation. Its page distinguishes an unpublished app from a download lookup failure, and can find an Android release when a newer unrelated release has no app asset.

All eight movie browser checks passed using local compatible storage. They cover browser upload into a private room, invitation copy and keyboard dismissal, deletion during playback, upload permission refusal, reopening an interrupted multipart upload, same-tab pause and resume without another reservation, invalid-file recovery, long titles at phone and desktop widths, and synchronized play, pause and seek. Screenshots were inspected at phone and desktop sizes. The three added download selection checks passed alongside the existing unit suites, for 439 checks total.

The timed-comment check now waits for the guest to receive each seek before pinning or playing, rather than relying on fixed delays. Its focused run passed. Voice diagnostics established that signaling succeeds but the managed browser's network policy prevents the direct media used by the local test; that policy was preserved. Final regression and deployment results are tracked in `docs/flow-review-progress.md`.

## Production acceptance

All eight movie browser checks have now passed against the real production website and R2. The initial pass had seven successes and one test timeout while waiting only five seconds for a large part to arrive. That test's network allowance was corrected to match the other multipart case, and only that case was rerun successfully. No application behavior was changed to obtain the result.

The test authentication helper now uses the configured site origin, secure HTTPS cookies and session chunking so production tests do not depend on localhost. Temporary accounts and their movies were removed after testing. Actual phone behavior and installation remain separate acceptance gates.
