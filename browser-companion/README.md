# UniMate Browser Companion V2

A Chrome Manifest V3 extension that adds a persistent UniMate mascot and Pro-only
screenshot-aware tutor to ordinary web pages.

## Run in development

1. Make sure the root `.env.local` contains `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Set `VITE_UNIMATE_API_URL` to the deployed UniMate
   origin or local dev origin (defaults to `http://localhost:8080`).
   `VITE_COMPANION_DEBUG=true` can also explicitly enable development
   diagnostics; diagnostics default to off.
2. Run `npm run companion:configure:dev` for unpacked development. Production
   packaging should run `npm run companion:configure`, which omits diagnostics.
3. Confirm the reviewed Companion database changes have been applied to the
   target Supabase project before testing chat persistence. Do not assume this
   from the repository state. See `SUPABASE_RELEASE_MIGRATION_REVIEW.md`; SQL is
   intentionally unapplied on this branch.
4. Start UniMate with `npm run dev`, or point the extension at the deployed app.
5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select the `browser-companion` directory.
6. Open any regular `http`, `https`, or permitted `file` page and click the
   yellow mascot. Sign in with an existing UniMate account whose
   `profiles.is_pro` value is `true`.

The first time the panel opens, students must accept the page-context privacy
notice before the extension reads or captures page content. Declining closes the
panel and transmits nothing. A future material data-practice change must increment
the consent version in `background.js` so students are asked again.

After changing extension files, click **Reload** on the extension card and
refresh open pages. Chrome blocks extensions on internal pages such as
`chrome://`, the Chrome Web Store, and some browser-owned viewers.

## V2 experience

- Every Send action captures the visible tab once. There is no separate screen
  analysis mode to learn.
- Highlighted text, the page title and URL, and a small visible-viewport DOM
  sample accompany the screenshot as supporting context.
- The backend classifies the request as solve, answer, explain, summarize,
  flashcard, quiz-me, or general help, then responds as a concise tutor.
- Answers lead with the result and brief work. UniMate does not inventory the
  page or produce browser-analysis reports.

## Architecture

- `content.js` owns the isolated Shadow DOM panel, fresh on-demand context
  collection, runtime diagnostics, and message display.
- `context-extractor.js` is deliberately small. It samples only rendered
  viewport content, selection context, form labels/states, title, and URL. It
  does not perform question ranking or academic reasoning.
- `background.js` validates auth/Pro access, captures the sender's active tab,
  calls the existing screenshot-analysis backend, stores messages, and recovers
  content-script messaging after extension reloads. When Chrome genuinely
  blocks capture, compact text context is used if available.
- `background.js` owns credentials and network traffic. It signs into the same
  Supabase Auth project, refreshes tokens, validates each session through
  `/auth/v1/user`, requests the server-owned `/api/billing-status` decision, and
  blocks non-Pro chat. This keeps Stripe lifecycle state and development
  overrides consistent between the website and extension.
- AI reasoning and intent handling live on the UniMate backend. No Groq key is
  exposed and no AI API was added.
- Each user and assistant message is stored in `companion_chats`. RLS restricts
  SELECT and INSERT to rows where `auth.uid() = user_id`.
- The web app's **Ask UniMate** page reads and writes the same authenticated
  history. Opening the extension panel refreshes that stream, and the website
  provides an explicit refresh button, so students can continue in either UI.
- Ask UniMate also provides a named-chat dashboard. Students can create and
  delete conversations and choose one **In browser** conversation. The
  extension resolves that preference on every open/send and only loads or
  writes messages belonging to the selected conversation.
- Extension auth is stored in `chrome.storage.local`, isolated from websites.
  It uses the existing UniMate account; V1 does not create accounts.

## Explicit exclusions

There is no Stripe or billing UI, Canvas API/LMS integration, or
highlight-to-explain action. Flashcard and quiz-me are conversational AI
formats—not new database-backed product subsystems. Highlighted text is passive
context and never triggers a request.

## Later candidates

- A one-click session handoff from the UniMate website to avoid entering the
  same credentials in the extension.
- Streaming responses, conversation grouping, delete/export controls, and
  retention settings.
- Optional per-site permissions instead of broad host access.
- Store screenshots and promotional artwork, automated Playwright extension
  tests, opt-in telemetry, and Chrome Web Store submission.
- Streaming responses and a dedicated backend companion endpoint if the
  screenshot tutor contract eventually diverges from existing endpoints.

## Known risks

- Manifest V3 content scripts cannot run on Chrome internal pages or the Web
  Store, so “all sites” means all Chrome-supported/authorized web pages.
- Every full navigation creates a new document; `document_start` minimizes the
  gap but Chrome cannot preserve DOM across navigation.
- Broad `<all_urls>` access is necessary for the persistent companion and will receive
  scrutiny during store review. Persistent injection on every ordinary site is
  incompatible with `activeTab`-only access. The extractor skips password,
  email, and telephone values but visible page text can still be sensitive.
- The extension checks `/api/billing-status` before every chat call, and the
  Companion backend entry points independently enforce server-side entitlement.
  The existing profile boolean remains a fast cache while Stripe reconciliation
  and server-only development overrides stay outside the extension bundle.
- Screenshot capture occurs only after Send. It does not continuously capture,
  persist screenshots, or use a screen-sharing picker.
- The exact V1 schema has no conversation or page identifier. Persisted history
  is displayed across sites, but only messages created in the current page
  session are sent back to the model. V2 should add durable conversation
  scoping before supporting sensitive or multi-project workflows.
- Direct REST inserts rely on the SQL migration, Data API exposure, grants, and
  RLS all being deployed correctly.

See `V2_ARCHITECTURE.md` for the current product contract, responsibility
boundaries, measurable acceptance criteria, complexity budget, and platform
limits. The other reports below document the V1 history retained for reference.

See `V1_BLOCKERS_REPORT.md` for numbered-question relevance, host event
isolation, development diagnostics, and their dedicated verification fixtures.

See `HALLUCINATION_GROUNDING_REPORT.md` for the strict provenance contract,
regeneration guard, adversarial tests, and remaining grounding limitations.

See `RUNTIME_STABILITY_REPORT.md` for content-script recovery, screenshot error
classification, connection diagnostics, repeated multi-tab tests, and the final
manual Chrome smoke test.

See `FUNCTIONAL_PIPELINE_REPORT.md` for the numbered-math request trace,
intent/guard correction, pipeline diagnostics, and exact discount-question
regression.

See `CHROME_WEB_STORE_READINESS.md` for permission justifications, privacy/data
disclosures, listing copy, asset requirements, packaging checks, and the legal
and operational blockers that must be closed before submission.
