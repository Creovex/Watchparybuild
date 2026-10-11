# Watchparty

A mobile friendly watch party website: sign in with Google, start a room, send the link, and watch YouTube, Netflix, Prime Video or Disney+ in sync with voice, optional camera, chat, reactions and timed comments. The product name is not decided (gap G16); the display name comes from `NEXT_PUBLIC_APP_NAME`.

Everyone who writes in this repository follows [docs/WRITING_RULES.md](docs/WRITING_RULES.md).

## Where things are

| Path | What it holds |
|---|---|
| `apps/web` | The Next.js web app: every page, the room, the YouTube adapter, the error sentences (`lib/errors.ts`), the PWA (Progressive Web App) manifest and icons |
| `apps/extension` | The Chrome and Edge sync extension for Netflix, Prime Video and Disney+ |
| `packages/sync-core` | Pure TypeScript shared by everything: schemas, clock offset, expected position, the sync engine |
| `packages/voice` | Voice: one interface with mesh (direct) and server (LiveKit) implementations |
| `packages/ui` | Design tokens, components and the room client shared by the room page and the extension panel |
| `supabase/migrations` | The database: tables, Row Level Security (RLS) policies, RPCs (Remote Procedure Calls), triggers, scheduled jobs |
| `supabase/functions` | Edge Functions for calls that need a third party secret |
| `supabase/tests` | Database tests (pgTAP), the realtime authorization test, the concurrency script, Edge Function tests |
| `e2e` | Playwright end to end tests E1 to E14 |
| `docs` | Gaps, decisions, spike results, the device matrix |

Open questions for James are at the top of [docs/gaps.md](docs/gaps.md). Every decision taken without him is marked DEFAULT in [docs/decisions.md](docs/decisions.md).

## Accounts

| Service | What for | Where the values go |
|---|---|---|
| Supabase | Database, sign in, realtime, Edge Functions | Project address and anon key in `.env.local` and in Vercel; the rest stays in Supabase |
| Google Cloud | The OAuth client for Google sign in (OAuth is the open standard Google sign in uses) | Supabase dashboard, Authentication, Sign In / Providers, Google: paste the client id and client secret there. They never go in this repository or in any `.env` file of the web app |
| LiveKit Cloud | Server voice for rooms of 10 | `LIVEKIT_URL` in Vercel and as an Edge Function secret; `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` as Edge Function secrets only |
| Cloudflare Realtime TURN | Relaying mesh voice when a direct path is blocked (TURN is a relay server for WebRTC media) | `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` as Edge Function secrets only |
| Vercel | Hosting the web app | Project settings, Environment Variables |

Never put the Supabase service role key, the LiveKit API secret or the Cloudflare TURN token in client code, the extension or any `NEXT_PUBLIC_` variable.

## Running it on your machine

You need Node.js, pnpm and Docker. The Supabase command line tool is a dev dependency, so it is run with `pnpm exec supabase`.

```sh
pnpm install
pnpm db:start                      # starts the local Supabase stack in Docker and applies the migrations
pnpm exec supabase status -o env   # prints API_URL and ANON_KEY for the next step
cp .env.example apps/web/.env.local
```

In `apps/web/.env.local` set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the status output, and add `NEXT_PUBLIC_DEV_EMAIL_SIGNIN=1`. Google sign in is off on the local stack; that flag shows an email and password form on the start page, for the local stack only.

```sh
pnpm dev                           # the web app on http://localhost:3000
```

The sync extension:

```sh
cp .env.example apps/extension/.env.local   # same values as the web app
pnpm --filter @watchparty/extension build
```

Then load `apps/extension/dist` unpacked in `chrome://extensions` or `edge://extensions` with developer mode on. The manifest carries a fixed public key, so every unpacked install gets the id recorded in `docs/decisions.md`; put that id in `NEXT_PUBLIC_EXTENSION_IDS`.

## Tests

| Command | What it runs |
|---|---|
| `pnpm test` | Unit tests in every package (Vitest), including the sync core at 90 percent line coverage or more and the error sentence test |
| `pnpm db:test` | pgTAP database tests against the local stack |
| `pnpm db:s6` | Spike S6 as a permanent test: realtime authorization on the room topics |
| `pnpm db:concurrency` | Five simultaneous joins on a free room admit exactly two |
| `pnpm fn:test` | Edge Function tests (Deno) |
| `pnpm e2e` | Playwright end to end tests E1 to E14; needs `pnpm db:start` first |

`supabase/tests/README.md` lists the environment variables the Deno tests read. The end to end tests start their own dev server on port 3100 with a local test video in place of YouTube, and create their own users with the local stack's admin API. Set `PW_CHROMIUM_PATH` to use an installed Chromium instead of Playwright's download, and `E2E_EDGE=1` to also run them in Microsoft Edge.

## Deploying the preview

1. **Supabase.** Create the free project `watchparty-dev`. Then:
   ```sh
   pnpm exec supabase link --project-ref <project ref>
   pnpm exec supabase db push
   pnpm exec supabase functions deploy turn-credentials livekit-token moderate delete-account
   pnpm exec supabase secrets set LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
     CLOUDFLARE_TURN_KEY_ID=... CLOUDFLARE_TURN_API_TOKEN=... SITE_URL=https://<preview domain> \
     EXTENSION_ORIGINS=chrome-extension://<extension id>
   ```
   In the dashboard: turn on the Google provider with the OAuth client id and secret; add `https://<preview domain>/auth/callback` to the redirect URLs; turn off "Allow public access" in Realtime settings so every channel is private; and set the room link address with `update public.app_config set value = 'https://<preview domain>' where key = 'site_url';` in the SQL editor.
2. **Google Cloud.** In the OAuth client, add the Supabase callback address the Google provider page shows as an authorised redirect URI.
3. **Vercel.** Import the repository and set Root Directory to `apps/web`. Vercel finds the pnpm workspace from the lockfile, installs from the repository root and builds the shared packages from source; nothing built is committed. Add `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_EXTENSION_IDS` and `LIVEKIT_URL`. Pin the `dev` branch to a fixed domain (gap G22), because the extension cannot allow a `vercel.app` wildcard.
4. **Extension.** Rebuild it with `NEXT_PUBLIC_SITE_URL` set to the preview domain so its `externally_connectable` list includes it.

Vercel Hobby is for non commercial use and Supabase free projects pause after a week without activity (gaps G6 and G7); both need paid plans before a public launch.
