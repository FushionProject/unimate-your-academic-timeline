# UniMate Companion V1 blocker fixes

## Root causes

### Incorrect content focus

The extractor produced one large visible-text string. It had no model of
questions, answer choices, DOM order, headings, geometry, or prompt references.
Prompts such as “number 2” were especially broken because the earlier keyword
parser ignored short numbers and generic words such as “number” and “question.”
Any sufficiently long page therefore looked “good enough,” so question 2 was
not isolated and screenshot fallback did not run.

### Host event leakage

The UI already used a closed Shadow DOM for CSS isolation, but composed browser
events still crossed the shadow boundary. Keyboard, pointer, form, and wheel
events could reach delegated handlers on Gmail, Canvas, or another host page.
The panel also lacked focus containment, Escape handling, explicit button types
on every control, and scroll-boundary containment.

## Extraction and relevance strategy

`context-extractor.js` now emits ordered blocks with:

- Stable local ID and DOM order.
- Text and element/control type.
- Top/left viewport position and visibility.
- Heading hierarchy.
- Previous/next relationships.
- Detected question/item number.
- Selected control state.

It detects `Question 2`, `Problem 2`, `#2`, `2.`, `2)`, and ordered-list
numbers, then associates following answer controls and feedback with the active
question. Prompt references are classified as selection, numbered item, nearby
paragraph, visual reference, answer choice, or general request.

Ranking order is:

1. Current highlight and nearby container/heading.
2. Explicitly requested question/item number.
3. Prompt-term overlap.
4. Visible viewport blocks.
5. Nearby heading, controls, choices, and feedback.

For explicit numbered requests, blocks assigned to other question numbers are
excluded from the focused packet. The packet is capped at 14,000 characters;
the existing backend limit remains 30,000. A missing requested item produces
`referenced-item-not-found` with low confidence and triggers a single visible
tab capture after Send.

## Event-isolation strategy

- The panel remains in a closed Shadow DOM and is `inert`/hidden while closed.
- Keyboard, input, composition, clipboard, submit, click, mouse, pointer,
  touch, drag, context-menu, and wheel events stop immediately at the shadow
  boundary after extension controls process them normally.
- Focus moves to the chat/email input on open.
- Tab and Shift+Tab wrap among companion controls.
- Escape closes the panel and returns focus to the mascot.
- Every button has explicit semantics and an accessible name where needed.
- Conversation and panel surfaces use `overscroll-behavior: contain`; wheel
  events at scroll boundaries cannot move the host page.
- No global keyboard blocking remains when the companion is closed.

## Screenshot and request safety

Screenshot capture remains explicit-action-only: Send or **Analyze visible
screen**. No interval, recorder, or screen-sharing picker exists. Missing
numbered content, weak confidence, visual references, short/empty extraction,
blocked frames, and prompt mismatch trigger vision.

The vision payload begins with the untruncated safety instruction, followed by
the bounded user prompt and focused DOM packet. The service worker replaces
page URL/title metadata with the sender tab’s values when available. It never
logs page text, prompts, screenshots, tokens, or quiz content.

## Development diagnostics

`VITE_COMPANION_DEBUG` controls the diagnostic panel.
`npm run companion:configure:dev` explicitly enables it, while the production
safe `npm run companion:configure` disables it unless the environment value is
exactly `true`. When enabled it shows only:

- Active tab URL.
- Extracted block count.
- A bounded selection preview.
- Detected question numbers.
- Matched item.
- Focused context character count.
- Screenshot status.
- Confidence score.

The panel is completely omitted when the flag is false.

## Verification

The rendered-browser fixtures were run manually and pass:

- “What’s the answer to number 2?” selects question 2, both choices, and its
  feedback while excluding question 3.
- Missing number 7 triggers `referenced-item-not-found`.
- A dynamic Canvas-style quiz includes its visible wording, all answer choices,
  selected answer, and score feedback.
- Highlights, same-origin frames, open shadow roots, articles, prompt mismatch,
  and diagram-heavy pages behave as expected.
- Typing the alphabet, arrow keys, Space, Enter, Shift+Enter, Escape, Tab, and
  Shift+Tab does not reach host listeners.
- Enter sends once; extension buttons never submit the host form.
- Wheel input stays in the conversation, Escape restores focus, and host
  keyboard handling resumes while closed.
- Production omits diagnostics; development renders every required field.
- Automated service-worker tests prove text mode never captures, screenshot
  mode uses `captureVisibleTab` exactly once per request with the existing
  vision endpoint, fallback-aware confidence is preserved, and the safety
  instruction survives maximum-size prompt/context truncation.

`npm run companion:check`, `npm run companion:test`, `npm run lint`, and
`npm run build` are the final verification commands.

Direct Gmail and logged-in Canvas automation was unavailable because the
separate ChatGPT Chrome Extension is not installed in the active Chrome
profile. The fixtures reproduce their relevant dynamic-form and delegated-event
behavior, but a final manual smoke test in the unpacked extension remains
recommended.

## Files changed

- `browser-companion/context-extractor.js`
- `browser-companion/content.js`
- `browser-companion/background.js`
- `browser-companion/config.example.js`
- `browser-companion/config.local.js` (generated production-safe configuration)
- `browser-companion/tests/context-fixture.html`
- `browser-companion/tests/event-isolation-fixture.html`
- `browser-companion/tests/background.test.mjs`
- `browser-companion/manifest.json`
- `browser-companion/README.md`
- `browser-companion/PAGE_CONTEXT_REPORT.md`
- `scripts/configure-companion.mjs`
- `package.json`

## Remaining Chrome limitations

- Chrome internal pages, the Web Store, and browser-owned PDF viewers reject
  content-script injection.
- Cross-origin iframe DOM and closed shadow roots are inaccessible; these paths
  use vision when the visible tab can be captured.
- Same-origin iframe geometry is frame-relative; explicit numbered matching is
  exact, but general relevance ranking can be less precise for offscreen frames.
- Canvas/WebGL/scanned document text has no DOM representation.
- Full navigations replace the document; `document_start` reinjects as early as
  Chrome allows.
