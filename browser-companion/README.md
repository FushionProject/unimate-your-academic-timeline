# UniMate Browser Companion

Implementation notes updated October 12, 2026. Automated checks do not establish
that a production deployment, Store listing, or real installed-Chrome test has
passed. See the release gates below.

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
   from the repository state. See `SUPABASE_RELEASE_MIGRATION_REVIEW.md` and
   `AI_ENTITLEMENT_ROLLOUT.md`; neither source files nor historical audit reports
   prove the current deployment's migration state.
4. Start UniMate with `npm run dev`, or point the extension at the deployed app.
5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select the `browser-companion` directory.
6. Open any regular `http`, `https`, or permitted `file` page and click the
   yellow mascot. Review the consent notice, then sign in with an existing
   UniMate account. Free accounts can open the Pro upgrade page, but cannot
   collect page context or send Companion AI requests. Validate paid access
   through the approved billing flow; do not edit profile flags to unlock users.

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
- AI reasoning and intent handling live on the UniMate backend. The server uses
  OpenAI; no AI provider key belongs in the extension. Only the public Supabase
  client configuration and HTTPS UniMate origin are packaged.
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
  It uses the existing UniMate account and does not create a second account.
- Same-page follow-ups survive panel reopening. A navigation or conversation
  switch resets the model's local page history; older saved messages remain
  visible but are not evidence about the new page.
- Failed questions remain in the composer. An answer that could not sync has a
  save-only retry, with no second model call. Provider billing/configuration
  outages retain the question without asking the student to upgrade or retry.
- Page sharing can be paused from the panel. Consent is checked again immediately
  before capture and before the context is sent to the backend.

## Explicit exclusions

Checkout and billing management happen in the website; the extension only opens
the website's upgrade page. There is no Canvas API/LMS integration or
highlight-to-explain action. Flashcard and quiz-me are conversational AI
formats—not new database-backed product subsystems. Highlighted text is passive
context and never triggers a request.

## Later candidates

- A one-click session handoff from the UniMate website to avoid entering the
  same credentials in the extension.
- Streaming responses, in-panel conversation management/export, and retention
  settings. Named conversation selection and deletion already exist in Ask UniMate.
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
- Durable chats are scoped by conversation and account. Model follow-up context
  is kept only for the current page session, not durably scoped to a page URL.
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

## Release gates

1. Verify the production backend, paid-Pro entitlement, required migrations,
   durable quota flags, and an approved provider spending ceiling. The owner's
   current $25/month AI budget is an authorization, not evidence that a provider
   or application-side cap has been applied.
2. Confirm the canonical domain, published privacy/terms/support pages, monitored
   support mailbox, asset rights, and publisher-account/listing details.
3. Configure a production HTTPS origin with debug disabled. Run
   `npm run companion:package`; the ZIP includes only approved runtime files,
   has `manifest.json` at its root, and rejects unsafe client configuration.
   This command creates a local archive only; it does not upload or publish.
4. Test that exact release in real Chrome with synthetic coursework and isolated
   Free/Pro accounts. Cover consent decline/pause, paid unlock, active-tab
   capture, reload recovery, chat sync, sign-out, and restricted pages. Live AI
   tests require the approved budget to be configured first.
5. Prepare current listing screenshots and promotional artwork, submit through
   the approved publisher account, and obtain the listing URL. Set
   `VITE_COMPANION_STORE_URL` to the verified Chrome Web Store detail URL and
   redeploy the website so Pro users see the install action.
