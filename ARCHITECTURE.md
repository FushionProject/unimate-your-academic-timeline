# UniMate Architecture

This document is a handoff map for future maintainers and AI assistants. It describes the current UniMate codebase, runtime architecture, folder responsibilities, data flow, Supabase usage, Stripe status, AI integrations, deployment assumptions, known blockers, and a short roadmap.

## Current State

UniMate is a student productivity and academic planning app. The current app includes:

- A public landing page.
- Supabase email/password authentication.
- Protected dashboard, planner, and Ask UniMate routes.
- Syllabus upload/parsing into assignments and deadlines.
- Results views with summary, calendar/heatmap, resources, and study-map generation.
- A course dashboard backed by Supabase tables.
- Local notes, study streak, Pomodoro, music player, and Canvas sync helpers.
- AI endpoints backed by Groq and SerpAPI.
- Stripe subscription checkout for UniMate Pro.
- A Pro-gated screen assistant endpoint for screenshot analysis.

The recent audit pass added auth headers to protected client API calls, server-side bearer-token checks, payload limits, malformed JSON handling, responsive layout fixes, Stripe webhook hardening, and stricter Supabase RLS for assignments.

## Tech Stack

### Frontend

- React 19
- TypeScript
- TanStack Router
- TanStack Start
- TanStack Query
- Tailwind CSS 4
- Radix UI primitives
- Lucide React icons
- PDF.js for client-side PDF text extraction

### Server and Build

- Vite 7
- `@lovable.dev/vite-tanstack-config`
- Cloudflare Vite plugin via Lovable/TanStack config
- Cloudflare Worker-style `fetch` entry in `src/server.ts`
- Wrangler config in `wrangler.jsonc`

### Data and Auth

- Supabase Auth
- Supabase Postgres
- Supabase Row Level Security
- `@supabase/supabase-js`

### AI and External APIs

- Groq chat completions for syllabus parsing, resources, study maps, dashboard AI, and screenshot analysis.
- SerpAPI for Ask UniMate web search.
- Canvas LMS REST API through a server-side proxy.

### Payments

- Stripe Checkout subscriptions.
- Stripe webhook for Pro entitlement updates.
- Stripe SDK is not used; the server calls Stripe's REST API directly with `fetch`.

## Runtime Architecture

At a high level:

1. The browser renders the React app through TanStack Start.
2. `src/routes/__root.tsx` wraps the app in `QueryClientProvider`, `AuthProvider`, and `ThemeProvider`.
3. Supabase Auth state is loaded in `src/lib/auth-context.tsx`.
4. Protected routes use `src/components/protected-route.tsx`.
5. Client pages either:
   - Read/write Supabase directly through `src/lib/courses.ts` and `src/lib/profile.ts`, or
   - Call custom server APIs in `src/server.ts` through wrappers in `src/functions`.
6. `src/server.ts` handles all `/api/*` routes first.
7. Any non-API request falls through to the TanStack Start SSR handler.
8. The server normalizes catastrophic SSR errors into a branded HTML error page.

## Main Folders and Responsibilities

### `src/routes`

File-based route components.

- `__root.tsx`: Root app shell. Installs providers, navbar, sidebar, date widget, outlet, and screen assistant.
- `index.tsx`: Public landing/home page.
- `signin.tsx`: Supabase sign-in page.
- `signup.tsx`: Supabase sign-up page.
- `dashboard.tsx`: Protected academic dashboard backed by Supabase courses and assignments.
- `planner.tsx`: Protected syllabus upload/parser entry point.
- `results.tsx`: Syllabus parse results, save-to-planner flow, resources, heatmap, and study map.
- `ask.tsx`: Protected Ask UniMate chat/search assistant.
- `notes.tsx`: Local notes interface.
- `bulletin.tsx`: Bulletin-style local feature.
- `upgrade.tsx`: Stripe checkout entry and Pro status display.

### `src/components`

Feature-level and shared app components.

- `navbar.tsx`: Top navigation and auth-aware sign-in/sign-out controls.
- `sidebar.tsx`: Desktop side navigation.
- `protected-route.tsx`: Redirects unauthenticated users to sign in.
- `screen-assistant.tsx`: Floating Pro-gated screenshot assistant UI.
- `date-widget.tsx`: Date/countdown/motivation widget.
- `music-player.tsx`: Local/WebAudio study music player.
- `pomodoro-timer.tsx`: Pomodoro timer UI.
- `syllabus-timeline.tsx`: Timeline visualization for syllabus items.
- `theme-provider.tsx`: Theme context and toggling.
- `logo-mark.tsx`, `icons.tsx`: Branding and custom icons.

### `src/components/ui`

Reusable UI primitives, mostly Radix/shadcn-style components. These are generic building blocks used by routes and feature components.

### `src/lib`

Core utilities, integrations, and domain data hooks.

- `supabase.ts`: Creates the Supabase browser client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `auth-context.tsx`: Auth provider and `useAuth()` hook.
- `auth-fetch.ts`: Helper that attaches the current Supabase access token to server API calls.
- `courses.ts`: TanStack Query hooks for `courses` and `assignments`.
- `profile.ts`: Reads current user's `profiles.is_pro`.
- `canvas.ts`: Canvas LMS local config/cache and proxy-backed fetch helpers.
- `pdf.ts`: Client-side PDF text extraction.
- `error-capture.ts`: Captures errors for SSR error normalization.
- `error-page.ts`: Branded SSR error HTML.
- `utils.ts`: Shared utility helpers.

### `src/functions`

Client wrappers around AI/server endpoints.

- `ask-unimate.ts`: Calls `/api/ask-unimate`.
- `parse-syllabus.ts`: Calls `/api/parse-syllabus`.
- `extract-resources.ts`: Calls `/api/extract-resources`.
- `generate-study-map.ts`: Calls `/api/generate-study-map`.

These wrappers now attach Supabase bearer tokens through `getAuthHeaders()`.

### `src/hooks`

Small client-side hooks.

- `use-study-streak.ts`: Study streak state.
- `use-assistant-enabled.ts`: Feature toggle/local state for the floating assistant.
- `use-mobile.tsx`: Mobile viewport helper.

### `supabase`

SQL files for manual setup in the Supabase SQL editor.

- `schema.sql`: `courses` and `assignments` tables plus RLS.
- `profiles.sql`: `profiles` table, Pro entitlement model, trigger for new users, and backfill.

### `public`

Static files. Currently includes audio assets under `public/audio`.

### `dist`

Build output. Do not edit manually.

### `goplatinum_export`

Unrelated/exported legacy material. It appears separate from the UniMate app and should not be treated as part of the main architecture unless explicitly requested.

## Data Flow

### Authentication Flow

1. User signs up or signs in through `signin.tsx` or `signup.tsx`.
2. `AuthProvider` in `src/lib/auth-context.tsx` uses Supabase Auth.
3. Supabase stores the session client-side.
4. `AuthProvider` exposes `user`, `session`, `loading`, `signIn`, `signUp`, and `signOut`.
5. Protected routes check `user` through `ProtectedRoute`.
6. Server API calls include `Authorization: Bearer <Supabase access token>`.
7. `src/server.ts` validates tokens against Supabase `/auth/v1/user`.

### Planner/Syllabus Flow

1. User visits protected `/planner`.
2. User uploads or pastes syllabus content.
3. PDF text extraction runs client-side if needed through `src/lib/pdf.ts`.
4. Client calls `/api/parse-syllabus` through `src/functions/parse-syllabus.ts`.
5. Server validates auth, payload size, and JSON shape.
6. Server calls Groq to extract dated academic items.
7. Client navigates/renders `/results`.
8. Results page can:
   - Save items to Supabase planner data.
   - Extract resources through `/api/extract-resources`.
   - Generate a study map through `/api/generate-study-map`.

### Dashboard Flow

1. Protected `/dashboard` loads Supabase `courses` and `assignments` using TanStack Query hooks in `src/lib/courses.ts`.
2. User can add/delete courses and add/toggle/delete assignments.
3. Dashboard builds an academic context string from local query data.
4. Dashboard AI calls `/api/dashboard-ai` with bearer token and context.
5. Server validates session and calls Groq or returns mock data when the Groq key is missing.

### Ask UniMate Flow

1. Protected `/ask` collects question, mode, class context, and optional Canvas context.
2. Client calls `/api/ask-unimate`.
3. Server validates auth, request size, question length, and optional Canvas context length.
4. Server calls SerpAPI for web search.
5. Server calls Groq to synthesize an answer.
6. Server may call Groq again to generate related concepts.

### Canvas Flow

1. Canvas config and cache live in browser `localStorage`.
2. Canvas API calls go through `/api/canvas-proxy`.
3. Client includes the current Supabase auth header.
4. Server requires auth, validates request size, validates the Canvas host and `/api/v1/` path, and forwards the Canvas token to the upstream Canvas origin.

Current security note: Canvas tokens are still stored in `localStorage`. That is convenient for a local/client-only feature, but not ideal for a production-grade security posture.

### Pro / Screen Assistant Flow

1. `screen-assistant.tsx` appears only when the assistant feature is enabled and the user is signed in.
2. The browser uses `navigator.mediaDevices.getDisplayMedia()` to capture one frame.
3. Client sends the image data URL and optional question to `/api/analyze-screenshot`.
4. Server validates session.
5. Server reads `profiles.is_pro` through Supabase REST using the user's access token.
6. Non-Pro users receive `402` with `upgradeRequired: true`.
7. Pro users get Groq vision analysis.

## Supabase Database Schema

### `public.courses`

Defined in `supabase/schema.sql`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `course_code text not null default ''`
- `score numeric`
- `grade text`
- `created_at timestamptz not null default now()`

Indexes:

- `courses_user_id_idx` on `user_id`

Purpose:

- Stores each user's courses/classes.
- Used by dashboard and planner save flows.

### `public.assignments`

Defined in `supabase/schema.sql`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `course_id uuid not null references public.courses(id) on delete cascade`
- `name text not null`
- `due_at timestamptz not null`
- `completed boolean not null default false`
- `created_at timestamptz not null default now()`

Indexes:

- `assignments_user_id_idx` on `user_id`
- `assignments_course_id_idx` on `course_id`

Purpose:

- Stores deadlines/tasks tied to a course.
- Used by dashboard and saved syllabus results.

### `public.profiles`

Defined in `supabase/profiles.sql`.

Columns:

- `id uuid primary key references auth.users(id) on delete cascade`
- `is_pro boolean not null default false`
- `stripe_customer_id text`
- `created_at timestamptz not null default now()`

Purpose:

- Stores Pro entitlement.
- Intentionally not user-writable.
- Updated only by the Stripe webhook using `SUPABASE_SERVICE_ROLE_KEY`.

### Profile Creation Trigger

`supabase/profiles.sql` creates:

- Function: `public.handle_new_user()`
- Trigger: `on_auth_user_created`

Behavior:

- After a new `auth.users` row is inserted, create a matching `public.profiles` row with `is_pro = false`.
- Backfills missing profile rows for older users.

## RLS Notes

RLS is enabled on:

- `public.courses`
- `public.assignments`
- `public.profiles`

### Courses Policies

Users can select, insert, update, and delete only their own courses.

Important details:

- Insert policy checks `auth.uid() = user_id`.
- Update policy has both `USING` and `WITH CHECK`, preventing a user from reassigning a course to another user.

### Assignments Policies

Users can select and delete only assignments where `auth.uid() = user_id`.

Insert/update also check:

- `auth.uid() = user_id`
- The referenced `course_id` exists in `public.courses`
- That course belongs to the same authenticated user

This prevents a user from creating an assignment that points to another user's course.

### Profiles Policies

Users may only select their own profile row.

There are intentionally no user insert/update/delete policies on `profiles`, because `is_pro` is a paid entitlement. The Stripe webhook uses the service role key server-side to update it.

Security caveat:

- `public.handle_new_user()` is a `security definer` function in the public schema. That is common for Supabase profile triggers, but future maintainers should keep the function narrow, retain a fixed `search_path`, and avoid adding user-controllable privileged behavior to it.

## Server API Endpoints

All custom endpoints are implemented in `src/server.ts`.

### `POST /api/ask-unimate`

Purpose:

- Web-search-assisted academic Q&A.

Requires:

- Supabase bearer token.
- `SERPAPI_KEY` for real search.
- `GROQ_API_KEY` for real AI answer.

Request fields:

- `question`
- `conversationHistory`
- `classContext`
- `mode`
- `canvasContext`

Limits:

- JSON body: `1_000_000` bytes.
- Question: `4_000` characters.
- Canvas context: `30_000` characters.
- Chat history trimmed to 10 messages.

Behavior:

- Calls SerpAPI.
- Calls Groq for answer.
- Calls Groq again for related concepts when appropriate.
- Returns mock/fallback data when keys are missing.

### `POST /api/dashboard-ai`

Purpose:

- Dashboard study recommendations, grade/on-track analysis, motivation, and academic chat.

Requires:

- Supabase bearer token.
- `GROQ_API_KEY` for real AI.

Request fields:

- `type`: `study-tonight`, `on-track`, `motivation`, or `chat`
- `academicContext`
- `message`
- `chatHistory`

Limits:

- JSON body: `1_000_000` bytes.
- Academic context: `30_000` characters.
- Message: `4_000` characters.
- Chat history trimmed to 10 messages.

### `POST /api/parse-syllabus`

Purpose:

- Extract academic deadlines, exams, quizzes, and assignments from syllabus text.

Requires:

- Supabase bearer token.
- `GROQ_API_KEY` for real AI.

Request fields:

- `syllabusText`

Limits:

- JSON body: `1_000_000` bytes.
- Syllabus text: `80_000` characters.

Date behavior:

- Prompt includes today's date.
- If a date omits a year, the model is told to infer the nearest upcoming academic occurrence and avoid past years.
- If the syllabus names a term/year, the model is told to use that year.

### `POST /api/extract-resources`

Purpose:

- Extract portals, textbooks, office hours, and contact information from syllabus text.

Requires:

- Supabase bearer token.
- `GROQ_API_KEY` for real AI.

Limits:

- JSON body: `1_000_000` bytes.
- Syllabus text: `80_000` characters.

### `POST /api/generate-study-map`

Purpose:

- Generate study tasks from parsed syllabus items.

Requires:

- Supabase bearer token.
- `GROQ_API_KEY` for real AI.

Request fields:

- `items`

Limits:

- JSON body: `1_000_000` bytes.
- Max items: `120`.

### `POST /api/canvas-proxy`

Purpose:

- Proxy Canvas LMS REST API calls to avoid browser CORS limitations.

Requires:

- Supabase bearer token.

Request fields:

- `apiUrl`
- `apiToken`
- `path`

Limits and validation:

- Request body: `50_000` bytes.
- Canvas URL must be HTTPS.
- Host cannot be localhost, raw IPv4, or a hostname without a dot.
- Path must start with `/api/v1/`.

Security note:

- This is not intended to be a general-purpose proxy.
- It still accepts caller-supplied Canvas tokens, so rate limiting and tighter domain allow-listing would be valuable before broad public launch.

### `POST /api/analyze-screenshot`

Purpose:

- Pro-gated screenshot/homework assistant.

Requires:

- Supabase bearer token.
- `profiles.is_pro = true`.
- `GROQ_API_KEY` for real vision analysis.

Request fields:

- `imageBase64`
- `question`

Limits:

- Request body: roughly `MAX_IMAGE_DATA_URL_CHARS + 10_000`.
- Image data URL: `2_500_000` characters.
- Question: `4_000` characters.

Behavior:

- Validates auth first.
- Checks Pro status through Supabase REST.
- Calls a Groq vision-capable chat-completion model.
- Strips `<think>...</think>` blocks from model output.

### `POST /api/create-checkout-session`

Purpose:

- Start a Stripe Checkout subscription session for UniMate Pro.

Requires:

- Supabase bearer token.
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Behavior:

- Validates Supabase session.
- Creates a Stripe Checkout session with `mode=subscription`.
- Sets `client_reference_id` and `metadata[user_id]` to the Supabase user id.
- Includes `customer_email` when available.
- Returns `{ url }` for redirect.

### `POST /api/stripe-webhook`

Purpose:

- Receive Stripe events and flip Supabase Pro entitlement.

Requires:

- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`

Behavior:

- Reads raw request body.
- Verifies `Stripe-Signature` manually using Web Crypto HMAC SHA-256.
- Supports multiple `v1` signatures.
- Enforces 300-second timestamp tolerance.
- Uses constant-time comparison for signature checks.
- Handles `checkout.session.completed`.
- Ignores non-subscription or unpaid sessions.
- Updates `profiles.is_pro = true` and saves `stripe_customer_id`.

## AI Providers

### Groq

Used by:

- `/api/ask-unimate`
- `/api/dashboard-ai`
- `/api/parse-syllabus`
- `/api/extract-resources`
- `/api/generate-study-map`
- `/api/analyze-screenshot`

Environment variable:

- `GROQ_API_KEY`

Text model currently used:

- `llama-3.3-70b-versatile`

Screenshot/vision model currently used:

- `qwen/qwen3.6-27b`

Important note:

- The screenshot handler comments note that Groq model availability can shift. If screenshot analysis starts returning model errors, check Groq's current model list and replace the vision-capable model.

### SerpAPI

Used by:

- `/api/ask-unimate`

Environment variable:

- `SERPAPI_KEY`

Purpose:

- Performs Google search through SerpAPI and passes top results to Groq for synthesis.

## Stripe Status

Stripe is partially implemented and functional at the code level:

- Checkout session creation exists.
- Webhook verification exists.
- Pro entitlement update exists.
- Upgrade page exists.
- Pro-gated screenshot analysis exists.

Required Stripe environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`

Required Supabase variable for webhook updates:

- `SUPABASE_SERVICE_ROLE_KEY`

Current limitations:

- No subscription cancellation/downgrade handling yet.
- No handling for `customer.subscription.deleted`, `customer.subscription.updated`, payment failure, refunds, or chargebacks.
- Webhook currently only upgrades on `checkout.session.completed`.
- No local Stripe CLI test script is checked into the repo.

Recommended next Stripe events:

- `customer.subscription.deleted`: set `is_pro = false`.
- `customer.subscription.updated`: sync active/trialing/past_due/canceled state.
- `invoice.payment_failed`: optionally mark account past due or notify user.
- `checkout.session.completed`: keep current upgrade path.

## Environment Variables

Client-exposed:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Server-only:

- `GROQ_API_KEY`
- `SERPAPI_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

Local development:

- `src/server.ts` attempts to load `.env.local` only in dev mode.
- Production Cloudflare deployments should set secrets through Wrangler/Cloudflare, not rely on local files.

Security rule:

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET` to browser code.

## Deployment Process

### Local Development

Run:

```bash
npm run dev
```

The dev server usually starts on:

```text
http://localhost:8080/
```

If the port is busy, Vite will choose another port such as `8081`.

### Build

Run:

```bash
npm run build
```

This builds both:

- Client output under `dist/client`
- Server/Worker output under `dist/server`

Known build warning:

- Vite warns that some chunks are larger than 500 kB. This is currently non-blocking.
- In sandboxed runs, Wrangler may log an `EPERM` about writing logs under `~/Library/Preferences/.wrangler/logs`. The build has still completed successfully despite this warning.

### Cloudflare/Wrangler

Config:

- `wrangler.jsonc`

Important fields:

- `name`: `unimate`
- `main`: `src/server.ts`
- `compatibility_date`: `2025-09-24`
- `compatibility_flags`: `nodejs_compat`

Vite/TanStack config:

- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`.
- The config redirects TanStack Start's server entry to `src/server.ts`.
- Do not manually add duplicate TanStack/React/Tailwind/Cloudflare plugins; the Lovable config already includes them.

Production secrets should be configured in Cloudflare/Workers, for example through Wrangler secret commands or the dashboard.

## Current Blockers and Risks

### Not Yet Committed

The repo currently has local modifications from the audit/fix pass. They are not staged or committed unless a later workflow does that.

### Stripe Downgrade Lifecycle Missing

Users can be upgraded to Pro, but there is no complete subscription lifecycle sync yet. Cancellations and failed payments do not currently set `is_pro` back to false.

### Canvas Token Storage

Canvas tokens are stored in `localStorage`. This is simple, but less secure than a server-side encrypted token store.

### No Rate Limiting

Protected AI endpoints now require auth and enforce payload limits, but there is no per-user or per-IP rate limiting. This matters because Groq and SerpAPI calls have cost and abuse potential.

### AI Output Validation Is Limited

Some AI responses are parsed as JSON. Invalid JSON from Groq currently fails the endpoint with a server error. More robust repair/retry/schema validation would improve reliability.

### Tests Are Mostly Manual

Current verification has relied on:

- `npm run lint`
- `npm run build`
- live API smoke tests
- browser route checks

There is no dedicated automated test suite yet.

### Large Bundle Warning

The app builds successfully but emits a large chunk warning. Future optimization should consider code splitting, especially around PDF and heavy route-level dependencies.

### Supabase SQL Is Manual

Schema files are plain SQL intended for the Supabase SQL editor. There is no formal migrations workflow checked in yet.

## Recent Verification Status

Recent commands passed:

```bash
npm run lint
npm run build
```

Known lint output:

- 0 errors.
- 8 fast-refresh warnings from existing files that export non-component values.

Recent live API smoke checks confirmed:

- Unauthenticated protected endpoint calls return `401`.
- Invalid bearer tokens return `401`.
- Oversized syllabus payloads return `413`.

## Short Roadmap

### 1. Commit Current Stabilization Work

Review, stage, commit, and push the current audit/fix changes. Include a concise commit message covering auth hardening, API validation, responsive fixes, RLS updates, and Stripe webhook hardening.

### 2. Add Automated Tests

Add coverage for:

- Protected route redirects.
- API auth failures.
- API payload limits.
- Supabase data hook behavior with mocked clients.
- Stripe webhook signature verification.
- Syllabus parsing result handling.

### 3. Complete Stripe Subscription Sync

Handle:

- Subscription cancellation.
- Subscription status changes.
- Payment failures.
- Optional customer portal.

Consider expanding `profiles` to store:

- `stripe_subscription_id`
- `subscription_status`
- `current_period_end`

### 4. Add Rate Limiting

Protect costly endpoints:

- `/api/ask-unimate`
- `/api/dashboard-ai`
- `/api/parse-syllabus`
- `/api/extract-resources`
- `/api/generate-study-map`
- `/api/analyze-screenshot`
- `/api/canvas-proxy`

Use a Cloudflare-native solution, Durable Object, KV, or another rate-limit provider.

### 5. Improve AI Reliability

Add:

- Zod validation for server-side AI JSON outputs.
- JSON repair/retry for malformed AI responses.
- Better error messages for users.
- Provider/model fallback logic.

### 6. Move Supabase SQL to Migrations

Adopt Supabase CLI migrations so schema changes are versioned and replayable.

### 7. Secure Canvas Integration

Replace `localStorage` Canvas tokens with:

- Encrypted server-side storage, or
- Short-lived session-only token handling, or
- A proper OAuth flow if available.

Also consider a stricter Canvas host allow-list.

### 8. Optimize Bundles

Investigate route-level code splitting and heavy dependencies, especially PDF.js and large shared chunks.

## Quick Orientation for Future AI Assistants

Start with these files:

1. `src/server.ts` for API endpoints, auth enforcement, AI, Stripe, and SSR fallback.
2. `src/routes/__root.tsx` for app shell/providers.
3. `src/lib/auth-context.tsx` and `src/lib/supabase.ts` for auth/session setup.
4. `src/lib/courses.ts` for Supabase app data.
5. `src/routes/dashboard.tsx`, `src/routes/planner.tsx`, and `src/routes/results.tsx` for the main student workflows.
6. `supabase/schema.sql` and `supabase/profiles.sql` for database/RLS.
7. `vite.config.ts` and `wrangler.jsonc` for deployment/build behavior.

Before making changes:

- Run `git status --short --branch`.
- Do not overwrite user changes.
- Prefer existing route/component/hook patterns.
- Run `npm run lint` and `npm run build` before handoff.
- For Supabase changes, check RLS carefully and avoid putting service-role behavior in client code.
