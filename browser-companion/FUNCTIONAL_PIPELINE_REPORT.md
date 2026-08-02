# Browser Companion functional request-pipeline fix

## Observed behavior

On the Test Prep Review page, question 1 and all five options were visible:

- Original price with successive 10% and 15% discounts.
- Paid price: `$306`.
- Visible options including `$400`.

The request `Answer question 1 on the screen` nevertheless returned the fixed
insufficient-context fallback.

## Full pipeline trace

### 1. Page extraction

The rendered-DOM extractor identifies numbered question 1 and associates its
stem and following answer choices with the same question number. It produces:

- A broader visible-page extraction.
- A focused question-1 packet.
- Detected question number `1`.

### 2. Extension request mapping

The focused packet is sent as `MATCHED_PAGE_TEXT`; the broader extraction is sent
as `VISIBLE_PAGE_TEXT`. Selected text, page title, and URL remain separately
labelled.

### 3. Intent classification

The old classifier did not recognize `Answer question 1 on the screen`, so it
fell through to generic `help`. Numbered forms such as `answer question 1`,
`answer problem 2`, `answer #3`, and `answer number 4` now classify as `answer`.

### 4. Prompt selection

Both text and screenshot routes use:

- Template ID: `grounded-tutor-intent-first-v3`.
- Explicit `RESPONSE_INTENT`.
- The same labelled provenance contract.
- Answer/solve first, short explanation second, summary only on request.

### 5. Hallucination guard

The guard previously rejected legitimate math work for two reasons:

1. Derived intermediate values such as `0.765` or `$400` could be treated as
   unsupported numbers merely because they were calculated rather than copied.
2. Phrasing such as `The correct answer is $400` could be rejected when no answer
   key was displayed, despite `$400` being a visible option and the result being
   derivable from the supplied problem.

For solve/answer/explain requests containing mathematical work, derived numeric
steps are now allowed. Direct-answer phrasing is also allowed when the claimed
answer appears in the supplied sources. Missing passages, unseen answer choices,
fabricated statistics, and unsupported source claims remain blocked.

## Expected response

The fixed path can return:

> Answer: $400 (choice C). The discounts leave 0.90 × 0.85 = 0.765 of the
> original price, so $306 ÷ 0.765 = $400.

## Pipeline diagnostics

When development diagnostics are enabled, the collapsed Connection diagnostics
panel reports metadata for the exact request path:

- Extracted page-text length.
- Focused/matched text length.
- Broader visible text length sent.
- Detected question number.
- Server-selected intent.
- Prompt-template ID.
- Runtime/service-worker/capture state.
- Last structured error code and phase.

This replaces console logging so quiz text, prompts, screenshots, tokens, and
credentials are not written to developer logs.

## Regression coverage

The tests now assert:

- `Answer question 1 on the screen` selects `answer`.
- The complete discount problem and choices survive the provenance path.
- Legitimate derived intermediate values pass the hallucination guard.
- `$400`, a visible option, can be returned directly without a displayed key.
- Server intent/template/context-length metadata reaches the extension
  diagnostics.
- Runtime stability still passes five consecutive iterations.

## Numbered-question parity and UI cleanup

Normal prompts and the manual screen button now converge automatically. When a
student asks for a numbered answer and the focused DOM packet contains a
multiple-choice stem but fewer than two choices, the normal Send path selects
`incomplete-answer-choices` and captures the visible tab. It sends combined
matched DOM, broader page text, and screenshot evidence without requiring a
highlight or a second click. Complete DOM questions remain text-only.

Normal answers are capped at 320 model tokens and instructed to use no more than
four short lines or steps. The panel removes decorative Markdown/LaTeX artifacts,
shortens the manual fallback action to **Use screen**, and hides healthy
production diagnostics. Diagnostics remain available in development and
automatically reappear for connection or runtime errors.

Final verification:

- `npm run companion:check` passed.
- `npm run companion:test:runtime:repeat` passed five times.
- Full Companion tests passed.
- Grounding suite passed with 67 assertions.
- Lint passed with zero errors and eight pre-existing Fast Refresh warnings.
- Production build passed.
- `git diff --check` passed.
