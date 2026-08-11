import assert from "node:assert/strict";
import { DAILY_QUOTES, getDailyQuote } from "../../src/lib/daily-quotes.ts";
import {
  daysUntilSemesterEnd,
  formatSemesterEndDate,
  normalizeSemesterEndDate,
} from "../../src/lib/semester-date.ts";

assert.equal(normalizeSemesterEndDate("2026-12-15"), "2026-12-15");
assert.equal(normalizeSemesterEndDate(" 2026-12-15 "), "2026-12-15");
assert.equal(normalizeSemesterEndDate("2026-02-30"), null);
assert.equal(normalizeSemesterEndDate("12/15/2026"), null);
assert.equal(normalizeSemesterEndDate(null), null);

assert.equal(
  daysUntilSemesterEnd("2026-12-15", new Date(2026, 11, 14, 23, 55)),
  1,
  "the countdown should compare calendar days rather than elapsed hours",
);
assert.equal(daysUntilSemesterEnd("2026-12-15", new Date(2026, 11, 15, 1)), 0);
assert.equal(daysUntilSemesterEnd(null), null, "no saved date means no countdown");
assert.equal(formatSemesterEndDate("2026-12-15"), "December 15, 2026");

assert.ok(DAILY_QUOTES.length >= 7, "there should be enough attributed quotes to rotate");
for (const quote of DAILY_QUOTES) {
  assert.ok(quote.text.trim(), "every quote needs text");
  assert.ok(quote.author.trim(), "every quote needs an author");
  assert.ok(quote.source.trim(), "every quote needs recorded provenance");
}
assert.deepEqual(
  getDailyQuote(new Date(2026, 7, 10)),
  getDailyQuote(new Date(2026, 7, 10, 23, 59)),
  "the quote should remain stable throughout a local calendar day",
);

console.log("PASS semester end date validation and attributed daily quotes");
