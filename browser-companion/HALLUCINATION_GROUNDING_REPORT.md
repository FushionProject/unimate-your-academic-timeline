# Browser Companion grounding fix

## Root cause

Browser Companion requests previously relied on the model to distinguish page
evidence from plausible academic background. Screenshot analysis could correctly
read part of a Canvas result and then continue creatively, with no deterministic
check between generation and display. Follow-up history and page context also
lacked a single server-enforced provenance contract.

## Grounding changes

All Browser Companion AI paths now use the shared grounding contract in
`src/lib/companion-grounding.ts`:

- Only `SELECTED_TEXT`, `MATCHED_PAGE_TEXT`, `VISIBLE_PAGE_TEXT`, `SCREENSHOT`,
  `PAGE_TITLE`, and `PAGE_URL` are authoritative for page-specific claims.
- Direct observations, reasonable inferences, and general knowledge must remain
  separate.
- Missing passages, keys, and source material must be acknowledged instead of
  reconstructed.
- Insufficient-evidence responses state the limitation directly and give one
  practical next step instead of producing a multi-section report.
- Default answers are bounded to 320 model tokens; explicit detail requests may
  use up to 800.
- Page evidence is serialized as JSON and marked untrusted, preventing extracted
  page text from escaping a hand-written prompt delimiter.

The response policy classifies the student's intent as solve, answer, explain,
summarize, or general help. Supported tasks now lead with the answer or solution,
then give the shortest useful reasoning. Page summaries and evidence-report
headings are reserved for explicit summary requests or genuine uncertainty.

The extension sends the relevance-ranked packet as `MATCHED_PAGE_TEXT` and the
broader rendered extraction as `VISIBLE_PAGE_TEXT`. Screenshot and text
follow-ups carry the same bounded user/assistant-only history. Persisted messages
from earlier pages remain visible in the panel but are not sent as evidence for a
new page session.

## Validation and regeneration

Every draft is checked for:

- Unsupported long quotations.
- Reconstruction language such as “the passage usually cited is”.
- References to unseen textbooks, videos, lectures, or articles.
- Unsupported statistics, dates, and other specific numbers.
- Claims that a correct answer is known without actual answer-key evidence.
- Long responses with very low overlap with supplied text.

A screenshot alone is not treated as proof that a claimed answer key or quote was
visible. The student's prompt is intent, not evidence, so planted fake facts
cannot validate themselves.

If the first draft is flagged, the backend regenerates once with a stricter
grounding reminder. If the second draft is also flagged, the backend returns a
fixed uncertainty response. Only the accepted or fixed response is persisted and
displayed. The extension also rejects empty or anomalously large responses as a
final transport-level backstop.

## Tests

`browser-companion/tests/grounding.test.mjs` covers:

- Incorrect quiz result without a visible source passage or answer key.
- Full visible multiple-choice wording and options without inventing a key.
- Requests for missing passages.
- User instructions encouraging guessing.
- Unsupported long quotations and automatic regeneration.
- Two unsafe drafts falling back to the deterministic safe response.
- Unsupported numbers and unseen source references.
- Screenshot requests that claim an unseen correct answer.
- Prompt-planted fake facts and provenance delimiter injection.
- Text, highlight, combined screenshot/text, screenshot-only, and follow-up
  route wiring.

Final verification:

- `npm run companion:check`
- `npm run companion:test` — 56 grounding assertions plus routing tests.
- `npm run lint` — zero errors; eight pre-existing Fast Refresh warnings.
- `npm run build`
- `git diff --check`

## Files changed

- `src/lib/companion-grounding.ts`
- `src/server.ts`
- `browser-companion/background.js`
- `browser-companion/content.js`
- `browser-companion/tests/grounding.test.mjs`
- `browser-companion/tests/background.test.mjs`
- `browser-companion/README.md`
- `package.json`

## Remaining limitations

- Deterministic checks cannot independently OCR screenshot pixels. They therefore
  conservatively block unsupported quotes and answer-key claims that are absent
  from extracted text, even if a low-quality screenshot might contain them.
- Short unsupported paraphrases without numbers or trigger phrases can evade
  pattern-based detection. The strict system prompt and second-pass regeneration
  reduce this risk, but a future V2 could use a separate vision verifier that
  returns structured evidence spans before answer generation.
- Model providers and vision-model availability can change. Endpoint errors expose
  only status codes in server logs so page contents are not echoed.

No Stripe, billing, Supabase schema, RLS, pricing, or unrelated web-app behavior
was changed for this fix.
