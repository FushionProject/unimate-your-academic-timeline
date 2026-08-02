# UniMate Browser Companion V2

## Product contract

UniMate is a tutor that happens to see the active tab. A normal request follows
one short path:

1. The student presses Send.
2. The extension captures the visible tab once.
3. It collects the current selection, title, URL, and a small visible-viewport
   text sample as supporting context.
4. The backend identifies the student's intent and answers the task directly.
5. The panel renders a concise tutor response.

The screenshot is the primary source of truth. The extension does not scrape the
whole document, rank large page packets, or perform academic reasoning.

## Responsibilities

### Content script

- Mount and isolate the panel.
- Collect selected text and compact visible-viewport text on demand.
- Send the student's request and display the response.
- Surface actionable runtime diagnostics when something fails.

### Service worker

- Validate the existing Supabase session and `profiles.is_pro`.
- Capture the sender's active visible tab.
- Call the existing UniMate backend.
- Store user and assistant messages in `companion_chats`.
- Recover content-script messaging after extension reloads and navigation.

### Backend

- Treat the screenshot as primary evidence and DOM text as supplemental.
- Classify requests as `solve`, `answer`, `explain`, `summarize`,
  `flashcard`, `quiz`, or `help`.
- Perform all academic reasoning.
- Answer in a concise, task-appropriate tutor format.
- Preserve grounding safeguards without turning answers into evidence reports.

`flashcard` and `quiz` are conversational response intents. V2 does not add a
flashcard database, quiz subsystem, or schema.

## Measurable acceptance criteria

- On a normal `http`, `https`, or permitted `file` tab, each Send captures the
  visible tab exactly once.
- Screenshot failure or a Chrome-restricted page degrades to compact DOM context
  when useful text is available and reports the capture limitation accurately.
- Highlighted text, page title, and URL are preserved as labelled provenance.
- Supporting DOM text is restricted to visible content and remains below the
  extension/backend caps; no full-document dump is sent.
- All seven intents have deterministic classification coverage.
- `solve` and `answer` lead with the result; `explain` leads with an explanation;
  `summarize`, `flashcard`, and `quiz` use their requested study format.
- Default tutor responses stay concise. Page inventories and headings such as
  “Visible on the page” are not part of the normal response contract.
- Supabase authentication, Pro entitlement checks, chat persistence, service
  worker/content-script recovery, and privacy-safe diagnostics remain covered by
  automated tests.
- Runtime stability tests pass five consecutive times.
- Extension syntax checks, Companion tests, lint, and the production build pass.

## Complexity budget

V2 favors one request path over conditional routing. Complexity is assessed by:

- the number of extension production lines;
- the number of screenshot/text routing branches;
- the maximum supporting-context payload;
- whether academic decisions exist outside the backend;
- whether a subsystem still serves a user-visible V2 requirement.

The refactor should reduce production extension code and remove relevance
ranking, giant context packets, page-type classification, and redundant academic
fallback logic. Runtime recovery and diagnostics are intentionally retained.

## Security and privacy

- No Groq or AI secret is bundled in the extension.
- Screenshots are captured only after an explicit Send action and are not stored
  by the extension.
- Page text, screenshots, prompts, auth tokens, and quiz content are not logged.
- Requests continue through the existing UniMate backend.
- V2 does not change Stripe, billing, Supabase schema, RLS, or the UniMate
  website.

## Known platform limits

Chrome internal pages, the Chrome Web Store, browser-owned viewers, and some
cross-origin embeds can block capture or content-script access. V2 reports the
specific limitation and uses compact text context when Chrome permits it. A tab
switch during capture fails closed so content from the wrong tab is never sent.
