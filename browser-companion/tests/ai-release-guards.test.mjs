import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
let passed = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  passed += 1;
};

check(
  "production AI routes contain no mock academic responses",
  !/returning mock data|mockResponses/.test(source),
);
check("missing AI configuration is typed", /code: "AI_NOT_CONFIGURED"/.test(source));
check("unavailable search is typed", /code: "SEARCH_UNAVAILABLE"/.test(source));
check(
  "provider calls share a bounded timeout",
  /AI_PROVIDER_TIMEOUT_MS/.test(source) && /fetchWithTimeout/.test(source),
);
check(
  "rate limits preserve Retry-After",
  /AI_RATE_LIMITED/.test(source) && /retry-after/.test(source),
);
check("empty model responses are typed failures", /AI_EMPTY_RESPONSE/.test(source));
check(
  "chat history is normalized and bounded",
  (source.match(/normalizeCompanionHistory\(/g) || []).length >= 4,
);
check("provider response bodies are not logged", !/console\.error\("Groq API error:"/.test(source));
check(
  "Ask UniMate forbids invented citations and answer keys",
  /Never invent a passage, answer key, quotation, URL, or citation/.test(source),
);
check(
  "optional related concepts do not trigger retries",
  /Related concepts are optional\. Never fail or retry/.test(source),
);
check(
  "stable questions and follow-ups skip redundant web search",
  /needsWebSearch\(String\(question\)\)/.test(source) &&
    /if \(searchRequired && serpApiKey\)/.test(source),
);

console.log(`PASS ${passed} AI release guard assertions`);
