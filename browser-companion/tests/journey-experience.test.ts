import assert from "node:assert/strict";
import { askJourneyHref, readJourneyExperience } from "../../src/lib/journey-experience.ts";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};

assert.equal(
  readJourneyExperience("", () => storage),
  "premium",
);
assert.equal(
  readJourneyExperience("?experience=classic", () => storage),
  "classic",
);
assert.equal(
  readJourneyExperience("?unrelated=1", () => storage),
  "classic",
  "choice persists between pages",
);
assert.equal(
  readJourneyExperience("?experience=unknown", () => storage),
  "classic",
  "invalid query cannot replace saved choice",
);
assert.equal(
  readJourneyExperience("?experience=premium", () => storage),
  "premium",
  "explicit URL can restore new view",
);
assert.equal(
  readJourneyExperience("", () => storage),
  "premium",
);

const blockedStorage = () => {
  throw new Error("Browser storage unavailable");
};
assert.equal(
  readJourneyExperience("?experience=classic", blockedStorage),
  "classic",
  "classic remains available without browser storage",
);
assert.equal(readJourneyExperience("", blockedStorage), "premium");

const prompt = "Help with Research & Society: ‘What changes?’\nDo not send until I review.";
const href = askJourneyHref(prompt, "course-123&next=other");
const target = new URL(href, "https://unimate.test");
assert.equal(target.pathname, "/ask");
assert.equal(target.searchParams.get("prompt"), prompt, "assignment context survives URL encoding");
assert.equal(target.searchParams.get("course"), "course-123&next=other");
assert.equal(
  target.searchParams.has("next"),
  false,
  "course text cannot inject another query parameter",
);
assert.equal(target.searchParams.has("send"), false, "handoff never requests automatic submission");
assert.equal(
  new URL(askJourneyHref("Plan my week"), target.origin).searchParams.has("course"),
  false,
  "general help carries no invented course",
);

console.log(
  "PASS persistent experience choice, storage fallback, and reviewable coursework handoffs",
);
