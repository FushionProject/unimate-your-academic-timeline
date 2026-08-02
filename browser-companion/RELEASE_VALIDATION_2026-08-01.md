# Browser Companion release validation — August 1, 2026

## Scope and cost boundary

This pass covered only Browser Companion release blockers. It made no paid AI
requests and did not touch Stripe, billing, authentication architecture,
Supabase schema/RLS, or unrelated product features.

## Result

The deterministic Companion suite passes, including five consecutive runtime
stability runs. No reproducible capture, messaging, cross-tab isolation,
SPA/reload, input-isolation, timeout, rate-limit classification, or server-side
Pro enforcement blocker remains in the covered paths.

Two low-risk hardening changes were made:

1. Extension-side authentication and Pro denials now retain stable error codes
   and phases (`AUTH_REQUIRED` / `auth`, `PRO_REQUIRED` / `entitlement`). This
   prevents an entitlement change during an open panel from appearing as a
   generic AI failure.
2. Regression coverage now proves that a non-Pro session is rejected before
   capture or AI work and that backend provenance always uses the actual sender
   tab URL rather than stale or caller-supplied metadata.

## Automated scenarios verified

- Screenshot-first capture occurs exactly once for every eligible Send.
- The entire Companion host is hidden before capture and restored afterward.
- Lost hide acknowledgements fail closed and still attempt restoration.
- Capture failure falls back to compact DOM text only when useful text exists.
- AI/backend failure never triggers a second model route or disguises itself as
  a capture error.
- 429 responses retain `AI_RATE_LIMITED`, honor only short explicit
  `Retry-After` values, retry at most once, and never recapture the page.
- Auth, entitlement, persistence, and AI calls have bounded timeouts.
- Server-side entitlement is checked on both Companion backend entry points and
  is bound to the authenticated Supabase user ID.
- A non-Pro extension session cannot capture the screen or call AI.
- Captures remain bound to the sender window while alternating unrelated tabs.
- Page URL/title provenance is replaced with trusted sender-tab metadata.
- A tab switch during capture fails closed before pixels are captured.
- Content scripts inject at `document_start`; install/update recovery reinjects
  eligible existing tabs and skips Chrome-owned pages.
- Stale runtime access is guarded; toolbar recovery disposes, reinjects, and
  retries once.
- SPA URL changes reset the model-history boundary so another route's page
  claims are not reused as current evidence.
- Persisted chat remains visible, while only turns from the current page session
  are sent back to the model.
- Closed Shadow DOM event isolation, focus trapping, Escape behavior, and
  scroll containment contracts remain present.
- Compact context includes visible DOM, selection context, open shadow roots,
  and permitted same-origin frames; screenshot remains primary evidence.
- Grounding and intent tests pass 55 assertions across solve, answer, explain,
  summarize, follow-up, screenshot-only, combined context, and adversarial
  evidence cases.

## Commands and results

- `npm run companion:check` — passed.
- `npm run companion:test` — passed all six Companion suites.
- `npm run companion:test:runtime:repeat` — passed 5/5 consecutive runs.
- `git diff --check` — passed.

These are automated fixture/service-worker simulations. No Groq request was
made. They are not a substitute for the final installed-extension smoke test.

## Files changed in this validation track

- `browser-companion/background.js`
- `browser-companion/content.js`
- `browser-companion/tests/background.test.mjs`
- `browser-companion/tests/runtime-stability.test.mjs`
- `browser-companion/RELEASE_VALIDATION_2026-08-01.md`

## Manual verification still required

The environment did not expose a controllable installed-Chrome session, so the
following must be verified manually after reloading the unpacked production-safe
extension:

1. Send one no-cost smoke prompt only if a non-billable/test AI environment is
   available; otherwise stop after verifying panel/auth/capture UI behavior.
2. Open an article, LMS fixture, visible math/MCQ page, diagram page, and a
   supported PDF; confirm the Companion disappears from its own screenshot and
   immediately returns afterward.
3. Alternate two unrelated tabs and two windows; confirm no title, URL, visible
   text, or response from one appears as current evidence in the other.
4. Navigate an SPA route, reload a page, reload the extension with tabs already
   open, and use back/forward navigation; confirm one mascot remains and the
   toolbar recovers old tabs without a manual page refresh where Chrome permits.
5. Type, paste, tab, Shift+Tab, press Escape, click, and scroll inside the panel
   on an LMS/form page; confirm the host page receives none of those interactions.
6. Test a free profile and a Pro profile. The free profile must be blocked before
   capture; the Pro profile must proceed. Revoke Pro while the panel is open and
   confirm the next request shows the specific Pro-access message.
7. Visit `chrome://extensions`, the Chrome Web Store, and a browser-owned PDF
   viewer. Confirm Chrome's restriction is explained accurately and no claim of
   page access is made.

## Platform limitations, not launch defects

- Chrome forbids content scripts on internal pages, the Web Store, and some
  browser-owned viewers.
- Closed shadow roots and cross-origin iframe DOM are inaccessible; explicit
  screenshot pixels are the supported evidence path.
- Full navigation replaces the document. `document_start` minimizes, but cannot
  eliminate, the reinjection boundary.
- Model-provider availability and quotas remain external dependencies; typed
  429/timeout handling is verified without invoking the provider.

## Recommendation

Automated status: **release-candidate ready**. Final status remains **manual
smoke test required** for real Chrome capture permissions, installed-extension
reload behavior, and a real Pro entitlement against the launch environment.
