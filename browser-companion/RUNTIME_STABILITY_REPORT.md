# Browser Companion runtime stability pass

## Reported failures

- `Cannot read properties of undefined (reading 'sendMessage')`.
- AI/backend failures displayed as `Screen capture unavailable`.
- Mascot or messaging missing in tabs that were already open when the unpacked
  extension was reloaded.
- Intermittent behavior while alternating between tabs and windows.

## Root causes

1. After an extension reload, an already-open tab can retain a stale content
   script. Its DOM and observers still exist, but its `chrome.runtime` context is
   invalid.
2. Manifest content scripts are injected on navigation; they do not
   retroactively repair every tab that predates an install/update.
3. The previous toolbar action only attempted `tabs.sendMessage`. A missing
   receiver produced an error badge instead of reinjecting the scripts.
4. Screenshot capture, AI analysis, rate limiting, and generic backend errors
   were flattened into similar strings. The UI therefore labeled a Groq 429 as
   a capture failure.
5. A page could remove the extension host, and the original remount observation
   did not cover every recovery lifecycle.

## Stability changes

### Content runtime

- Every runtime call goes through a guarded adapter; no code directly assumes
  that `chrome.runtime.sendMessage` exists.
- Transient messaging failures receive one short reconnect attempt.
- An invalidated context produces a direct extension-refresh/reconnection
  explanation instead of a JavaScript exception.
- A stale instance responds to a private lifecycle disposal event by
  disconnecting its mutation observer, `pageshow` handler, runtime listener, and
  host before a replacement instance mounts.
- The host remounts if a site removes it and on back/forward-cache restoration.

### Injection and tab consistency

- Manifest V3 now declares the minimum `scripting` permission required for
  recovery.
- Static `document_start` injection remains the normal path.
- On install/update, the service worker rehydrates eligible existing
  HTTP/HTTPS/file tabs.
- If a toolbar toggle finds no receiver, the service worker disposes the stale
  instance, reinjects `context-extractor.js` and `content.js`, then retries the
  toggle once.
- Chrome internal pages and other restricted schemes fail cleanly.

### Screenshot and backend errors

- Sender tab/window, eligible URL scheme, active-tab identity, capture API, and
  returned image data are validated.
- The active tab is rechecked before every capture attempt.
- Errors now carry a stable code, phase, and optional retry interval.
- Capture permission failures remain `capture` errors.
- Screenshot-analysis/backend failures remain `screenshot-analysis` errors.
- Groq 429 responses become `AI_RATE_LIMITED`, not screen-capture failures.
- `Retry-After` is honored once only when Groq explicitly requests a wait of five
  seconds or less.

## Diagnostics panel

The collapsed connection diagnostics panel appears when development diagnostics
are enabled or when a connection/error condition needs attention. Healthy
production chats stay uncluttered. It contains metadata only:

- Content-script injection state and timestamp.
- Runtime/service-worker connection state.
- Capture API availability.
- Reconnect count.
- Last error code, phase, and message.

It does not display or log page text, screenshots, prompts, tokens, or auth
credentials.

The background also exposes `RUNTIME_DIAGNOSTICS`, reporting service-worker
connectivity, sender-tab identification, page eligibility, capture API
availability, permission status, and manifest version.

## Verification

Automated runtime coverage includes:

- Declarative and recovery injection contracts.
- Undefined/invalidated runtime protection.
- Structured async message responses.
- Five alternating sender tabs across two windows.
- Capture isolation to the sender window.
- Tab-switch fail-closed behavior.
- Capture permission classification.
- AI/backend error separation.
- Stale-host disposal, reinjection, and one toolbar retry.
- Diagnostics availability.

The integrated runtime suite was run repeatedly with no intermittent failures:

- Five consecutive passes by the implementation test agent.
- Five consecutive passes after integration.
- Five further passes after exposing diagnostics in auth/error states.
- Five final passes after adding behavioral 429 classification and bounded-retry
  coverage.
- Full Companion suite passed.
- Grounding suite passed with 64 assertions.
- Extension syntax checks passed.
- Lint passed with zero errors and eight pre-existing Fast Refresh warnings.
- Production build passed.
- `git diff --check` passed.

## Remaining manual verification

The automated tests model Chrome's APIs and tab/window switching. Direct control
of the user's installed extension was unavailable because the separate ChatGPT
Chrome Extension used by the test harness is not installed in the selected
Chrome profile. Therefore one manual smoke test remains recommended:

1. Reload the unpacked UniMate extension.
2. Keep several ordinary tabs open without refreshing them.
3. Confirm the mascot is rehydrated or opens through the toolbar.
4. Alternate Send and Analyze Visible Screen across those tabs.
5. Confirm Connection diagnostics stays connected and captures remain bound to
   the active sender tab.

Chrome internal pages, the Chrome Web Store, and browser-owned viewers remain
restricted by Chrome.
