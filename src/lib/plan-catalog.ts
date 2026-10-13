import { AI_ENTITLEMENTS } from "./ai-entitlements";

// This is the existing monthly checkout contract. Change it only alongside
// the configured Stripe price and the server's expected amount.
export const PRO_PLAN = Object.freeze({
  name: "UniMate Pro",
  monthlyPrice: "$5.99",
  textMonthly: AI_ENTITLEMENTS.pro.textMonthly,
  syllabusMonthly: AI_ENTITLEMENTS.pro.syllabusMonthly,
  screenshotMonthly: AI_ENTITLEMENTS.pro.screenshotMonthly,
  screenshotDaily: AI_ENTITLEMENTS.pro.screenshotDaily,
});

export const FREE_FEATURES = [
  "Your semester dashboard and deadline timeline",
  "Courses, assignments, and course notes",
  `${AI_ENTITLEMENTS.free.syllabusLifetime} AI syllabus imports to get started`,
] as const;

export const PRO_FEATURES = [
  "Everything in Free, with your AI school assistant",
  "Explain concepts, build study plans, and practice for exams",
  "Writing feedback and help breaking down assignments",
  `${PRO_PLAN.textMonthly} AI messages per calendar month, shared across Ask and Companion`,
  `${PRO_PLAN.syllabusMonthly} AI syllabus imports per calendar month`,
  `Browser Companion with ${PRO_PLAN.screenshotMonthly} screen questions per month (up to ${PRO_PLAN.screenshotDaily}/day)`,
  "Saved conversations that continue in the Browser Companion",
] as const;
