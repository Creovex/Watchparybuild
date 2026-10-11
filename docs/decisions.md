# Decisions

Each entry records what was decided, why, and when. `DEFAULT` marks a decision James did not make himself; the build took the most conservative option and the decision stays open to change.

## Tooling

### Docker runs the local Supabase stack
Date: 11 October 2026
James first asked for no Docker, then allowed it when it is the better route. The Supabase command line tool needs Docker for its local stack (database, sign in service, realtime server, Edge Function runtime), and the realtime authorization test and the Playwright end to end tests need that stack. Docker is used for local development and tests only; nothing deployed depends on it.

### Internal packages are consumed as TypeScript source
Date: 11 October 2026 (DEFAULT)
`packages/sync-core`, `packages/voice` and `packages/ui` export their `src` files directly. Next.js compiles them through `transpilePackages`; Vite and Vitest compile TypeScript natively. Each package's `build` script is a strict type check. This removes a compile step per package and keeps one source of truth for shared code.

### The room client lives in packages/ui
Date: 11 October 2026 (DEFAULT)
The code that joins a room (realtime channels, presence, the `touch_member` worker, reconnection, the engine driver) is needed by both the room page and the extension panel. The prompt's layout has no package for it, so it sits in `packages/ui/src/room` beside the React components that render it, rather than adding a package the prompt did not list.

### Packages added beyond the technology table
Every package below was checked on npm on 11 October 2026 for existence and licence before it was added.

| Package | Licence | Why |
|---|---|---|
| `@supabase/supabase-js` | MIT | Supabase client for web, extension and tests |
| `@supabase/ssr` | MIT | Cookie based Supabase sessions in Next.js server components and middleware |
| `react`, `react-dom` | MIT | Required by Next.js and the extension panel |
| `@vitejs/plugin-react` | MIT | React support in the extension's Vite build |
| `@types/chrome`, `@types/react`, `@types/react-dom`, `@types/node` | MIT | Type definitions |
| `@vitest/coverage-v8` | MIT | Line coverage for the sync core's 90 percent exit check |
| `supabase` | MIT | The Supabase command line tool, pinned per repository |
| `deno` | MIT | Runs Edge Function tests and the concurrency script without a separate install |
| `jsdom` | MIT | Browser globals for unit tests of the shared UI hooks |

## Realtime

### Realtime Authorization syntax
Date: 11 October 2026
Checked on the Supabase Realtime Authorization and Broadcast pages on 11 October 2026.
1. Policies are written on `realtime.messages`; `realtime.messages.extension` is `'broadcast'` or `'presence'`; the topic being joined comes from `(select realtime.topic())`.
2. Select policies govern receiving; insert policies govern sending and presence tracking.
3. Access is evaluated when a client joins a channel and cached for the connection, refreshed only when the client sends a new token. Revoking access in the database does not cut an existing subscription, which is why topics carry the channel epoch.
4. `realtime.send(payload jsonb, event text, topic text, private boolean)` broadcasts from the database. Messages sent this way bypass the insert policy because they run as the database owner.
5. RLS (Row Level Security) is already on for `realtime.messages`; migrations must not try to enable it, and must not create objects in the `realtime` schema.
6. Clients create channels with `config: { private: true }` and call `supabase.realtime.setAuth()` after every token refresh.

Topic parsing is done in one `SECURITY DEFINER` helper, `public.realtime_topic_allowed(topic, for_send)`, so a malformed topic returns false instead of raising inside a policy.

## Design

### Visual direction: the projection booth
Date: 11 October 2026 (DEFAULT; James has not supplied a brand, gap G16)
The app is used in the evening with a film playing, so the interface behaves like a cinema with the house lights down: warm near black surfaces, warm off white text, and one accent, a tungsten amber taken from marquee bulbs and projector light. The video is always the brightest thing on screen. A second colour appears only with meaning: red for destructive actions and errors, green for "in sync".

1. One dark theme, designed for dark rather than inverted from light. Surfaces step up in lightness for elevation; no drop shadows on dark surfaces.
2. Type: a condensed marquee display face (Big Shoulders Display) for page headlines and section labels only; a sturdy grotesque (Hanken Grotesk) for all reading text and every piece of user text; a monospace (JetBrains Mono) with tabular figures for timecodes, positions, drift and countdowns, the numbers people read while watching.
3. Product specific shapes instead of stock decoration: room capacity is drawn as a row of seats (3 or 10); the room link card is a ticket with a perforated edge; the countdown to a synced start is drawn as a film leader (3, 2, 1 with a sweeping hand).
4. Icons are drawn in this repository on one 24 pixel grid with one stroke weight and always sit beside a text label, except close and send where the meaning is universal.
5. Motion is limited to three places where it carries meaning: reactions rising for 2 seconds, the countdown leader, and sheets entering from the bottom. All three have a reduced motion alternative.
6. Spacing uses a 4 pixel base; type uses a fixed scale; every colour is a CSS variable in `packages/ui/src/styles/tokens.css`.

### Fonts are self hosted at build time
Date: 11 October 2026 (DEFAULT)
`next/font/google` downloads the three families during the build and serves them from the app's own origin, so the CSP (Content Security Policy) needs no font host and no visitor request reaches Google. The extension panel bundles the same files.
