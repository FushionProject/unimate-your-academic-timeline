# Page-context capture hardening

## Original root cause

The V1 content script treated `document.body.innerText` as the page. That works
for ordinary static documents but is not a reliable representation of what
Chrome paints. Canvas and similar applications can render useful content in
form-control state, ARIA labels, component shadow trees, same-origin frames, or
DOM inserted after the panel opened. The prior UI therefore claimed “Using page
text” even when the string sent to AI omitted the visible question and choices.

## Extraction methods now used

Every Send or manual screen-analysis action performs a new extraction:

1. Current selection, capped at 8,000 characters.
2. The nearest question/group/section plus its preceding heading, capped at
   6,000 characters.
3. Rendered text nodes in viewport-first order.
4. Headings, accessible names, `aria-label`, `aria-labelledby`, native labels,
   radio/checkbox states, selected options, non-sensitive field values, alerts,
   statuses, and score/feedback text.
5. Open shadow roots and slotted nodes.
6. Accessible same-origin iframe documents.
7. Page title, URL, and domain.

Hidden/inert/`aria-hidden` branches, scripts, styles, templates, navigation,
footers, the companion itself, and normalized duplicate lines are excluded.
Password, email, and telephone input values are never extracted. Cleaned page
text is capped at 26,000 characters; the final backend context remains below
the existing 30,000-character endpoint limit.

## Exact screenshot fallback triggers

`chrome.tabs.captureVisibleTab` runs only after the user clicks Send or
**Analyze visible screen**. It is never scheduled, streamed, or continuously
recorded. Screenshot mode is selected when any of these is true:

- The manual screen button was clicked.
- No highlighted, nearby, or rendered page text was extracted.
- There is no highlight and cleaned text is under 240 characters.
- The prompt has at least two meaningful terms and fewer than 34% occur in the
  extracted context.
- A visible canvas, SVG, image, video, embed, or object is present while text is
  under 900 characters.
- At least one frame is inaccessible while text is under 1,200 characters.

If usable DOM text exists, screenshot mode sends both sources. The vision
request labels page title, URL, highlight, nearby text, and cleaned page text,
then includes the one-shot screenshot. The capture is recompressed if necessary
to stay under the existing endpoint’s 2.5-million-character image limit.

## UI behavior

The panel reports **Using highlighted text**, **Reading visible page**, **Using
page text + screen**, **Using visible screen**, **This page restricts text
access**, or **Screen capture unavailable** according to the actual path.

## Verification

The rendered fixture at `tests/context-fixture.html` was run manually and
passes:

- Normal article extraction without navigation clutter.
- Highlighted paragraph plus nearby heading.
- Dynamically inserted Canvas-style question.
- Every visible radio option and the checked answer.
- “Incorrect” and “0 / 1 pts” feedback.
- Accessible same-origin iframe content.
- Open shadow-root content.
- Diagram-heavy automatic screenshot decision.

`tests/background.test.mjs` verifies that screenshot mode calls
`captureVisibleTab`, sends `imageBase64` to the existing vision endpoint with
labeled DOM context, and that normal text mode never captures.

Direct automation against the user’s installed extension could not run because
the separate ChatGPT Chrome Extension was unavailable in the active Chrome
profile. The deterministic rendered-browser fixture and service-worker API
mocks cover the pipeline, but a final real Canvas/Pro-account smoke test remains
recommended after reloading the unpacked extension.

## Remaining limitations

- Chrome internal pages, the Chrome Web Store, and browser-owned PDF viewers do
  not allow content-script injection. The extension action shows a temporary
  error badge/title on these pages, but cannot render its panel there.
- Cross-origin iframe DOM and closed shadow roots cannot be traversed. These
  conditions contribute to automatic screenshot fallback.
- Same-origin iframe geometry is currently frame-relative, so general relevance
  ranking may overvalue an offscreen frame. Explicit numbered-item matching is
  unaffected.
- Text painted entirely into canvas/WebGL, diagrams, and scanned PDFs has no DOM
  representation and requires vision.
- Full navigation destroys the old document; `document_start` reinjects the
  mascot in the new document as early as Chrome permits.
- The extension retains `<all_urls>` because a persistent mascot and automatic
  context on every ordinary site cannot be implemented with `activeTab` alone.

## Changed files

- `manifest.json`: load the extractor before the UI and remove redundant
  `activeTab`.
- `context-extractor.js`: new structured rendered/accessibility extraction and
  screenshot-decision engine.
- `content.js`: fresh on-demand context, accurate state labels, and manual
  screen-analysis control.
- `background.js`: labeled combined context, one-shot capture routing,
  restricted-page feedback, and unchanged existing backend/auth/Pro paths.
- `tests/context-fixture.html`: browser fixtures for article, Canvas-style,
  form, iframe, shadow, highlight, dynamic, and visual cases.
- `tests/background.test.mjs`: deterministic capture/text routing test.
- `README.md`: current architecture, permissions, and limitations.
- `package.json`: extractor syntax and background routing test commands.
