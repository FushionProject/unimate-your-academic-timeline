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
  serverSource.includes("class AiRateLimitError") &&
    serverSource.includes("upstreamRetryAfterSeconds") &&
    serverSource.includes("return jsonResponse(") &&
    serverSource.includes('"retry-after": String(error.retryAfterSeconds)') &&
    serverSource.includes("new AiRateLimitError(upstreamRetryAfterSeconds(groqResponse))"),
);

console.log(`PASS ${passed} screenshot-first tutor grounding assertions`);
