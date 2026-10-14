import assert from "node:assert/strict";
import fs from "node:fs";
import {
  COMPANION_GROUNDING_SYSTEM_PROMPT,
  COMPANION_PROMPT_TEMPLATE_ID,
  GROUNDED_FALLBACK_ANSWER,
  buildProvenanceBlock,
  buildTutorTaskInstruction,
  classifyCompanionIntent,
  classifyResolvedCompanionIntent,
  companionMaxTokens,
  detectHallucination,
  normalizeProvenance,
  resolveCompanionReference,
} from "../../src/lib/companion-grounding.ts";
import { readAiProviderError } from "../../src/lib/ai-provider.ts";

const serverSource = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
let passed = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  passed += 1;
};

const intentCases = [
  ["Calculate the area of this shape", "solve"],
  ["Answer question 3", "answer"],
  ["Explain why this is wrong", "explain"],
  ["Summarize these notes", "summarize"],
  ["Make flashcards from this page", "flashcard"],
  ["Quiz me on this chapter", "quiz-me"],
  ["Help me study this", "general-help"],
];
for (const [message, expected] of intentCases) {
  check(`${expected} intent`, classifyCompanionIntent(message) === expected);
  check(`${expected} task instruction`, buildTutorTaskInstruction(expected).length > 20);
}

check("V2 prompt template id", COMPANION_PROMPT_TEMPLATE_ID === "screenshot-first-tutor-v2");
check(
  "screenshot is primary evidence",
  /screenshot is your primary view/i.test(COMPANION_GROUNDING_SYSTEM_PROMPT),
);
check(
  "answers precede explanation",
  /Solve or answer first[\s\S]*Explain briefly next[\s\S]*Summarize only/i.test(
    COMPANION_GROUNDING_SYSTEM_PROMPT,
  ),
);
check(
  "browser narration is forbidden",
  /Never narrate the browser/i.test(COMPANION_GROUNDING_SYSTEM_PROMPT) &&
    /Do not begin with "I see"/i.test(COMPANION_GROUNDING_SYSTEM_PROMPT),
);
check(
  "report headings are forbidden",
  /Never use report headings/i.test(COMPANION_GROUNDING_SYSTEM_PROMPT),
);
check(
  "normal response is concise",
  /2–6 short lines/i.test(COMPANION_GROUNDING_SYSTEM_PROMPT) &&
    companionMaxTokens("Answer this") <= 320,
);
check("detail can expand", companionMaxTokens("Explain step-by-step in detail") > 320);

const biologyPage = normalizeProvenance(
  {
    visiblePageText: [
      "2. Mathematics — Solve",
      "Solve 3x + 4 = 19.",
      "4. Biology — Explain",
      "Photosynthesis converts light energy into chemical energy. Plants use carbon dioxide and water to make glucose and release oxygen.",
      "5. History — Summarize",
    ].join("\n"),
  },
  true,
);
const biologyReference = resolveCompanionReference("Now try number 4.", biologyPage);
check(
  "number 4 resolves to visible section",
  /Biology — Explain/.test(biologyReference?.matchedText),
);
check(
  "visible Explain heading overrides prior solve",
  biologyReference?.semanticType === "explanation",
);
check(
  "follow-up is independently classified as explain",
  classifyResolvedCompanionIntent("Now try number 4.", biologyReference) === "explain",
);
const biologyOrdinalReference = resolveCompanionReference("Try the fourth one.", biologyPage);
check(
  "word ordinal resolves the visible section",
  /Biology — Explain/.test(biologyOrdinalReference?.matchedText),
);
check(
  "word ordinal inherits semantic intent from fresh context",
  classifyResolvedCompanionIntent("Try the fourth one.", biologyOrdinalReference) === "explain",
);

const selectedParagraph = normalizeProvenance(
  {
    selectedText:
      "Chlorophyll absorbs light energy. The light-dependent reactions produce ATP and NADPH.",
    matchedPageText:
      "Photosynthesis uses these products to support carbon fixation in the Calvin cycle.",
  },
  true,
);
const paragraphReference = resolveCompanionReference("Explain this paragraph.", selectedParagraph);
check(
  "deictic paragraph reference prioritizes current selection",
  /Chlorophyll absorbs light energy/.test(paragraphReference?.matchedText),
);
check(
  "explicit current explain request is independently classified",
  classifyResolvedCompanionIntent("Explain this paragraph.", paragraphReference) === "explain",
);

const viewportOrderedPage = normalizeProvenance(
  {
    visiblePageText: [
      "2. Mathematics — Solve",
      "Solve 3x + 4 = 19.",
      "3. Biology — Explain",
      "Photosynthesis converts light energy into chemical energy stored in glucose.",
    ].join("\n"),
  },
  true,
);
const itemAboveReference = resolveCompanionReference(
  "Can you explain the item above?",
  viewportOrderedPage,
);
check(
  "item above resolves from viewport order without selection",
  /Biology — Explain[\s\S]*Photosynthesis/.test(itemAboveReference?.matchedText),
);
check(
  "viewport-resolved item supplies semantic explain intent",
  classifyResolvedCompanionIntent("Now try the item above.", itemAboveReference) === "explain",
);

const mathPage = normalizeProvenance(
  {
    visiblePageText: [
      "1. What is 6 × 7?",
      "A. 36",
      "B. 42",
      "2. Solve 4x + 2 = 18.",
      "A. 3",
      "B. 4",
      "3. Reading",
    ].join("\n"),
  },
  true,
);
const mathReference = resolveCompanionReference("Answer number 2.", mathPage);
check("number 2 isolates the second math problem", /4x \+ 2/.test(mathReference?.matchedText));
check("number 2 excludes adjacent question", !/6 × 7/.test(mathReference?.matchedText));
check(
  "explicit answer intent wins for math reference",
  classifyResolvedCompanionIntent("Answer number 2.", mathReference) === "answer",
);

const notesPage = normalizeProvenance(
  {
    visiblePageText: [
      "2. Background",
      "Earlier developments established the field.",
      "3. Key findings",
      "The study found consistent changes across three trials and discusses their implications.",
      "4. Limitations",
    ].join("\n"),
  },
  true,
);
const notesReference = resolveCompanionReference("Summarize number 3.", notesPage);
check(
  "numbered heading resolves without a question",
  /Key findings/.test(notesReference?.matchedText),
);
check(
  "explicit summarize intent applies to numbered heading",
  classifyResolvedCompanionIntent("Summarize number 3.", notesReference) === "summarize",
);

const provenance = normalizeProvenance(
  {
    selectedText: "S".repeat(3_000),
    matchedPageText: "M".repeat(4_000),
    visiblePageText: "V".repeat(8_000),
    pageTitle: "T".repeat(500),
    pageUrl: `https://example.test/${"u".repeat(800)}`,
  },
  true,
);
check("selected text cap", provenance.selectedText.length <= 2_001);
check("matched text cap", provenance.matchedPageText.length <= 2_501);
check("visible DOM cap", provenance.visiblePageText.length <= 3_501);
check("title cap", provenance.pageTitle.length <= 201);
check("URL cap", provenance.pageUrl.length <= 401);
check("screenshot provenance", provenance.hasScreenshot === true);

const block = buildProvenanceBlock(provenance);
for (const label of [
  "SELECTED_TEXT",
  "MATCHED_PAGE_TEXT",
  "VISIBLE_PAGE_TEXT",
  "SCREENSHOT",
  "PAGE_TITLE",
  "PAGE_URL",
]) {
  check(`${label} labelled`, block.includes(label));
}
check("page text serialized as untrusted JSON", /untrusted data/i.test(block));

const mathProvenance = normalizeProvenance(
  {
    visiblePageText:
      "A square has side 10 m and contains an inscribed circle. A. 25 m² B. 100 m² C. 100 − 25π m²",
  },
  true,
);
check(
  "derived math is allowed",
  !detectHallucination(
    "Answer: 100 − 25π m². The square is 100 and the circle is 25π, so subtract.",
    mathProvenance,
    "Solve this",
  ).flagged,
);

const sparse = normalizeProvenance(
  { visiblePageText: "Question 4: Which organelle performs cellular respiration?" },
  true,
);
check(
  "fabricated long quote is blocked",
  detectHallucination(
    'The passage says: "A hidden 2024 study found that 87% of students chose mitochondria during the national trial."',
    sparse,
    "Answer this",
  ).flagged,
);
check(
  "fabricated citation is blocked",
  detectHallucination("According to Smith et al. (2024), the answer is C.", sparse, "Answer this")
    .flagged,
);
check(
  "fallback is one concise limitation",
  GROUNDED_FALLBACK_ANSWER.length < 220 && !/\n/.test(GROUNDED_FALLBACK_ANSWER),
);

check(
  "both existing Companion endpoints use shared tutor generation",
  serverSource.includes('url.pathname === "/api/dashboard-ai"') &&
    serverSource.includes('url.pathname === "/api/analyze-screenshot"') &&
    (serverSource.match(/generateGroundedCompanionAnswer/g) || []).length >= 3,
);
check(
  "backend emits V2 intent diagnostics",
  serverSource.includes("selectedIntent") &&
    serverSource.includes("promptTemplate") &&
    serverSource.includes("COMPANION_PROMPT_TEMPLATE_ID"),
);
check(
  "upstream 429 is preserved for bounded extension retry",
  serverSource
    .slice(
      serverSource.indexOf("async function aiTextCompletion"),
      serverSource.indexOf("async function handleDashboardAI"),
    )
    .includes("readAiProviderError(res)") &&
    serverSource
      .slice(
        serverSource.indexOf("async function handleAnalyzeScreenshot"),
        serverSource.indexOf("async function handleAiUsageSummary"),
      )
      .includes("readAiProviderError(providerResponse)") &&
    serverSource.includes("error instanceof AiProviderError") &&
    serverSource.includes("retryable: error.retryable") &&
    serverSource.includes('"retry-after": String(error.retryAfterSeconds)') &&
    serverSource.includes("error.retryable && error.retryAfterSeconds"),
);
const rateLimited = await readAiProviderError(
  new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
    status: 429,
    headers: { "retry-after": "3" },
  }),
);
check(
  "true provider rate limits remain retryable429 with their retry window",
  rateLimited.status === 429 &&
    rateLimited.code === "AI_RATE_LIMITED" &&
    rateLimited.retryable &&
    rateLimited.retryAfterSeconds === 3,
);
const billingUnavailable = await readAiProviderError(
  new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), {
    status: 429,
    headers: { "retry-after": "3" },
  }),
);
check(
  "provider billing limits are not student rate limits",
  billingUnavailable.status === 503 &&
    billingUnavailable.code === "AI_BILLING_UNAVAILABLE" &&
    !billingUnavailable.retryable &&
    billingUnavailable.retryAfterSeconds === 0,
);

console.log(`PASS ${passed} screenshot-first tutor grounding assertions`);

// Whole numeric evidence, not digit substrings or URL metadata.
for (const [source, answer, blocked] of [
  ["Population: 1,024.", "Population: 1024.", false],
  ["Population: 1024.", "Population: 1,024.", false],
  ["Population: 1234.", "Population: 123.", true],
  ["Value: 1.024.", "Value: 1024.", true],
  ["Value: -1024.", "Value: 1024.", true],
  ["Value: 1024.", "Value: -1024.", true],
  ["Rate: 12.5%.", "Rate: 12.5%.", false],
  ["Rate: 125%.", "Rate: 12.5%.", true],
  ["Count: 125.", "Rate: 125%.", true],
  ["Count: 9007199254740992.", "Count: 9007199254740993.", true],
]) {
  assert.equal(
    detectHallucination(answer, normalizeProvenance({ visiblePageText: source }), "Summarize this")
      .flagged,
    blocked,
    `${source} -> ${answer}`,
  );
}
assert.ok(
  detectHallucination(
    "Population: 1234.",
    normalizeProvenance({ pageUrl: "https://course.test/1234", pageTitle: "Course 1234" }),
    "Summarize this",
  ).flagged,
);

// Policy distinction: this guard checks attribution, not arithmetic correctness.
// Old tests requiring every newly authored number to match a binary equation
// were intentionally removed: they rejected hints, quizzes, and ordinary
// academic knowledge. Source-reporting negatives below remain strict.
const teachingCases = [
  [
    "What is 12 × 12?",
    "Just give me one hint, without the answer.",
    "Try 12 × 10 = 120 first, then add two more groups of 12.",
  ],
  [
    "Multiplication combines equal groups.",
    "Quiz me with a new multiplication practice problem.",
    "Practice question: What is 120 × 3?",
  ],
  [
    "Which gas is released during photosynthesis?",
    "Answer this question.",
    "The correct answer is oxygen. Plants release oxygen during photosynthesis.",
  ],
  [
    "Light travels at a constant speed in a vacuum.",
    "Explain the speed of light simply.",
    "Light travels at about 300,000 km/s in a vacuum.",
  ],
  [
    "Human cells contain chromosomes.",
    "Explain this simply.",
    "There are 46 chromosomes in a typical human body cell, arranged in 23 pairs.",
  ],
  [
    "Find the area of a circle with radius 12 cm.",
    "Solve this.",
    "Answer: 144π cm², approximately 452.39 cm². Area = π × 12².",
  ],
  [
    "Percent means out of a hundred.",
    "Explain percentages with an example.",
    "Hypothetical example: A survey found 87% of 200 students agreed. How many students is that?",
  ],
];
for (const [text, question, answer] of teachingCases) {
  assert.equal(
    detectHallucination(answer, normalizeProvenance({ visiblePageText: text }), question).flagged,
    false,
    answer,
  );
}
const source = normalizeProvenance({
  visiblePageText: "Photosynthesis produces oxygen. Which gas is released?",
});
for (const answer of [
  "87% of students prefer this method.",
  "A survey found 97% agree.",
  "There were 999 participants.",
  "General background: the page says 87% of students agree.",
  "The page says:\n87% agree.",
  "According to Smith (2024), 87% preferred this method.",
  "Practice question: The page says 87% of students agree.",
  "Your assignment is worth 45% of the grade.",
  "The syllabus says the exam is worth 45% of your grade.",
  "The answer key says the correct answer is oxygen.",
  "Your professor marked oxygen correct.",
  'The passage reads "An unseen scientific study proves that every instructor selected this answer."',
])
  assert.ok(detectHallucination(answer, source, "Explain this").flagged, answer);
assert.equal(
  detectHallucination(
    "A survey found 87% agreed.",
    normalizeProvenance({ visiblePageText: "A survey found 87% agreed." }),
    "Explain this",
  ).flagged,
  false,
);
const quoted = "Photosynthesis converts light energy into chemical energy stored in sugars.";
assert.equal(
  detectHallucination(
    '"' + quoted + '"',
    normalizeProvenance({ selectedText: quoted }),
    "Quote this",
  ).flagged,
  false,
);
assert.ok(
  detectHallucination(
    '"A source passage that was never supplied cannot be reconstructed as an exact quotation."',
    source,
    "Quote this",
  ).flagged,
);
assert.equal(
  detectHallucination(
    "The answer key says the correct answer is oxygen.",
    normalizeProvenance({ visiblePageText: "Answer key: correct answer is oxygen." }),
    "Answer this",
  ).flagged,
  false,
);
const missing = normalizeProvenance({ visiblePageText: "Question 1. Define a cell." });
assert.ok(
  detectHallucination("Answer: B.", missing, "Answer question 9").reasons.includes(
    "missing_requested_source",
  ),
);
for (const answer of [
  "I cannot see question 9, but choose B.",
  "Scroll up to question 9 and select B.",
]) {
  assert.ok(
    detectHallucination(answer, missing, "Answer question 9").reasons.includes(
      "missing_requested_source",
    ),
  );
}
assert.equal(
  detectHallucination(
    "Question 9 isn't visible. Please paste it or capture that section.",
    missing,
    "Answer question 9",
  ).flagged,
  false,
);
assert.equal(
  detectHallucination("Answer: 144.", normalizeProvenance({}, true), "Answer question 9").flagged,
  false,
  "A screenshot may contain the numbered question; the guard is not OCR",
);
const longTeaching =
  "Think of a cell as a small working community. Nutrients supply the raw material and energy for its activities. " +
  "Enzymes are proteins that help chemical reactions happen under conditions the cell can tolerate. " +
  "Membranes separate spaces so each process can maintain the conditions it needs. Transport proteins control what enters and leaves those spaces. " +
  "Energy transfers connect these processes, letting the cell build molecules, move materials, and respond to changes around it. " +
  "To study this, sketch one boundary, then add an arrow for nutrients entering and an arrow for waste leaving. " +
  "Next, describe what each arrow means in your own words. You can build the details gradually instead of trying to memorize everything at once.";
assert.ok(longTeaching.length > 600);
assert.equal(
  detectHallucination(
    longTeaching,
    normalizeProvenance({ visiblePageText: "Cell biology." }),
    "Explain in detail",
  ).flagged,
  false,
);

// Exact captured live answer remains a regression without arithmetic whitelists.
const discountQuestion = "Solve question 4 and show me the shortest useful working.";
const discountSource = normalizeProvenance({
  visiblePageText:
    "Question 4. A textbook costs $80. A student discount reduces the price by 25%. What is the sale price?",
});
const capturedDiscountAnswer =
  "Answer: $60\n\n80 × 0.25 = 20, so the discount is $20.\n80 − 20 = $60.\n\nA 25% discount means you pay 75% of the original price.";
assert.equal(
  detectHallucination(capturedDiscountAnswer, discountSource, discountQuestion).flagged,
  false,
);
for (const suffix of [
  "A study found 97% of students agree.",
  "75% of students agree.",
  "There were 999 participants.",
]) {
  assert.ok(
    detectHallucination(capturedDiscountAnswer + "\n" + suffix, discountSource, discountQuestion)
      .flagged,
    suffix,
  );
}
console.log(
  "PASS authored teaching vs source reporting, missing targets, and exact live discount regression",
);
