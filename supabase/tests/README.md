# Database tests

Three suites check the database against the local Supabase stack. All three are the Phase 3 exit check.

| Suite | What it proves | Command |
|---|---|---|
| pgTAP (unit tests written in SQL and run inside Postgres) in `database/` | Every read rule, every RPC (Remote Procedure Call, a Postgres function the client calls) and each of its codes, the column grants, the scheduled job functions, the realtime topic rules and account deletion | `pnpm db:test` |
| Spike S6 in `realtime/s6.test.ts` | Realtime authorization with real WebSocket clients: who may join, send on and keep receiving each room topic, before and after a removal | `pnpm db:s6` |
| Concurrency in `concurrency.ts` | Five people joining a free host's room at the same moment are admitted exactly two at a time | `pnpm db:concurrency` |

## Before running

Start the local stack and apply the migrations from the repository root:

```sh
pnpm exec supabase start
pnpm exec supabase db reset
```

## pgTAP

```sh
pnpm db:test
```

This runs `supabase test db`, which runs every `*.test.sql` file in `database/` in name order. Each file opens a transaction, includes `database/_helpers.psql` with `\ir`, and rolls back at the end, so nothing stays in the database. The helpers file has the `.psql` extension so it is not run as a test of its own.

The helpers act as a person by setting the `authenticated` role and the JWT (JSON Web Token) claims for the transaction, and simulate time by moving `last_seen_at` or `created_at` into the past as the database owner.

To run one file: `pnpm exec supabase test db supabase/tests/database/03_join_room.test.sql`.

## Variables for the Deno suites

The S6 and concurrency suites run on Deno (a TypeScript runtime, installed as a dev dependency) and talk to the local stack through its API. They read three variables. Export them from the running stack in the same shell:

```sh
set -a
eval "$(pnpm exec supabase status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY)"
set +a
```

These are the local stack's demo keys. Never commit them, and never point these tests at a hosted project's service role key. The service role key is used only to create and delete test users and rooms; every check runs as a signed in user who signed in with email and password, which is enabled on the local stack only.

On a network that inspects HTTPS with its own certificate authority, also export `DENO_CERT=<path to that authority's certificate>` so Deno can download `@supabase/supabase-js` the first time.

## Spike S6

```sh
pnpm db:s6
```

Creates a host, a member, a member to remove and a non member, then checks each rule and prints what it observed. Takes about 50 seconds, mostly spent proving that messages do not arrive. Results are recorded in `docs/spike-results.md` under S6.

## Concurrency

```sh
pnpm db:concurrency
```

Runs five rounds. In each, a free host creates a room (room cap 3, the host present) and five other people call `join_room` at once from their own clients. Every round must end with exactly two admitted, three refused with `room_full`, and three joined rows. Exits with status 1 otherwise.

## Why the scripts set DENO_NO_PACKAGE_JSON

Deno reads the root `package.json` when it finds one, expects npm packages in `node_modules`, and, seeing `pnpm-workspace.yaml`, rewrites `package.json`. The scripts run Deno with `DENO_NO_PACKAGE_JSON=1` and `--no-config` so it uses its own module cache and changes no file.
