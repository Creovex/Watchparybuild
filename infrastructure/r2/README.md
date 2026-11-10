# Private movie storage

Enable Cloudflare R2, then create `synvello-movies` in the Standard storage class. Keep public access and the public development URL disabled. Enabling the account and accepting any billing terms belongs to the account owner.

In the bucket settings, add the cross-origin resource sharing (CORS) policy from `cors.json`. It permits the production website and the local development and browser test servers. Add an exact preview origin only when testing that preview; never permit every origin.

Under object lifecycle rules, add a rule for every object that aborts incomplete multipart uploads after one day. Do not add a rule that expires completed movies.

Create an account R2 application programming interface (API) token with Object Read & Write permission limited to this bucket. Store its values securely as Supabase Edge Function secrets:

- `R2_ACCOUNT_ID`: Cloudflare account identifier.
- `R2_ACCESS_KEY_ID`: the token's access key identifier.
- `R2_SECRET_ACCESS_KEY`: its secret access key.
- `R2_BUCKET`: `synvello-movies`.
- `R2_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`.

Set `NEXT_PUBLIC_R2_ORIGIN` in Vercel to that same origin, without the bucket path. It is public configuration, not a credential. The bucket token and secret must never use a `NEXT_PUBLIC_` name.

Presigned links grant temporary access to their holder. They are not copy protection. Never log them. A removed room member cannot obtain another link but an issued link remains usable until expiry.

The application reservation limit is not a provider billing cap. Check R2 storage and operation usage, including unfinished uploads, and configure the billing notifications available in the account. Do not describe storage reservations as a guarantee of a zero bill.

Before enabling uploads, verify a multipart upload through a deployed function, readable part identifiers in the browser, rejected incorrect part lengths and partial responses when seeking. A local fake cannot establish real R2 behavior.

## Deployed storage proof

The proof endpoint is disabled by default. After configuring the bucket and credentials, deploy `movie-storage-proof` through the Supabase command line tool with normal JSON Web Token verification enabled. A JSON Web Token is the signed session credential issued by Supabase Auth. Add these Edge Function settings securely:

- `MOVIE_STORAGE_PROOF=1`, only for the duration of testing.
- `MOVIE_UPLOADER_USER_ID`, the account owner's Supabase Auth user identifier, not an email address.
- `SITE_URL=https://synvello.vercel.app`, plus the existing allowed preview origin if needed.

Set `NEXT_PUBLIC_R2_ORIGIN` in Vercel and redeploy the web app. Sign in as the configured owner and open `/storage-proof`. This route is deliberately not linked from the public app. Other users cannot use the storage endpoint even if they discover the route.

Choose a playable test video around 200 MB, at most 250 MiB. The check rejects an incorrectly sized part, uploads the correct parts, checks their readable identifiers, completes the upload and verifies partial reads at the middle and end. Then play and seek in the video element. Remove the test file before closing the page. Cleanup details survive reloads within the same browser tab; they contain no signed URL or account credential. If the tab is permanently closed, remove any objects under `proof/` in the bucket and let the multipart lifecycle rule remove unfinished parts. The proof creates no movie-library record and is not subject to the future library reservation limit.

Disable the proof endpoint after testing by removing `MOVIE_STORAGE_PROOF` or setting it to `0`. Record the actual results, browser, size and deployed commit in `docs/spike-results.md`. Do not mark R2 seeking or size enforcement verified from unit tests alone.

The implementation dependency `aws4fetch` uses the MIT licence. Its exact dependency pin lives in the import and the Deno lockfile. The lockfile retains the downloaded package integrity checksum.
