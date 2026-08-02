# UniMate Daily Habit Engine

Branch: `codex/daily-habit-engine`
Primary metric: Weekly Active Students
Recommendation: **Proceed with a measured closed-beta launch.** The daily loop is now useful enough to test, but retention claims should wait for real cohort data.

## Product thesis

Students do not need another place that stores school information. They need a calm answer to: **“What should I do next?”** UniMate now uses the deadlines students already saved to produce that answer, then connects it directly to completion and AI help. No new database objects, notification system, calendar, or gamification layer was added.

The repeatable loop is:

1. Open UniMate.
2. See one recommended starting point.
3. Start it, ask for help, or mark it complete.
4. Watch the next useful step take its place.
5. Use the Browser Companion when the work moves into another tab.

## Top habit-forming improvements

- A new **Today** area leads the dashboard before semester analytics.
- One concrete focus item is selected from existing deadline data.
- Past-due work is surfaced as catch-up work without shame-heavy language.
- Students see due-today, catch-up, and upcoming counts at a glance.
- A compact semester progress bar makes invisible progress visible.
- Completing the focus item immediately reveals the next useful step.
- A calm completion message reinforces momentum without points, XP, or confetti.
- “Help me start” connects the daily plan to Ask UniMate.
- Ask UniMate’s first prompt is now “What should I focus on today?”
- A second prompt supports the realistic pre-class window: “Help me plan the next 45 minutes.”
- The Companion empty state now encourages getting unstuck and continuing, rather than describing browser context.
- Students with no unfinished deadlines get permission to use Notes or enjoy the breathing room.

## Why students will return tomorrow

UniMate now changes meaningfully when deadline state changes. It is not a static semester report: it presents today’s most relevant unfinished commitment, shows what requires recovery, and advances when work is completed. Canvas can show what exists; ChatGPT can answer a question; UniMate’s advantage is joining the student’s semester state, immediate next action, AI help, notes, and in-browser work into one continuous loop.

## Top 25 improvements implemented

1. Added a daily brief derived from existing assignment data.
2. Prioritized unfinished past-due work for recovery.
3. Used due-today work when no recovery item exists.
4. Used the next upcoming deadline when today is clear.
5. Added a clear “Today” label above semester analytics.
6. Added a single recommended starting action.
7. Displayed the associated course beside the focus item.
8. Displayed a human-readable due date.
9. Distinguished “Past due,” “Due today,” and “Your next deadline.”
10. Added a direct Mark done action.
11. Added pending-state protection against repeated completion clicks.
12. Added an accessible completion status announcement.
13. Added a calm next-step completion message.
14. Added a reversible message when an item is restored.
15. Added a “Help me start” bridge to Ask UniMate.
16. Added a due-today count.
17. Added a catch-up count.
18. Added a coming-next count.
19. Added semester completion totals.
20. Added an accessible progress bar with a numeric value.
21. Added a useful all-clear state rather than an empty dashboard.
22. Added a Notes action to the all-clear state.
23. Replaced the generic weekly AI starter with a today-focused prompt.
24. Added a 45-minute planning starter for real student schedules.
25. Reframed the Companion empty state around momentum and getting unstuck.

## Browser Companion and daily usage

The Companion contributes to habit formation by letting the daily loop survive outside UniMate. A student can identify the next task on the dashboard, open the actual assignment in another tab, and ask for help without breaking concentration or starting a disconnected chat. Its shared conversation history with Ask UniMate preserves continuity between planning and execution.

This pass intentionally did not introduce new installation infrastructure. Existing discovery, account linking, shared chats, privacy consent, runtime recovery, and Pro entitlement behavior remain intact.

## What currently causes churn

- Syllabus parsing can delay the moment when the dashboard becomes personal.
- AI provider rate limits can interrupt the exact moment a student asks for help.
- Notes and Bulletin content are device-local, which may violate multi-device expectations.
- Companion installation and activation still require more effort than a built-in browser feature.
- UniMate has no validated reminder or notification loop; return behavior must currently come from utility.
- Some large client bundles remain, especially the shared app and PDF paths.

## First-week retention risks

1. The student never adds enough accurate deadlines for Today to become useful.
2. The student compares UniMate only with ChatGPT and misses the semester-state advantage.
3. The Companion fails or rate-limits during the first meaningful study session.
4. The student expects device-local work to sync elsewhere.
5. The student has a light week and does not yet establish a morning check-in habit.

## Predicted impact

These are directional product estimates, not measured forecasts.

| Metric           | Expected direction            | Why                                                                                        |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Day 1 retention  | Moderate improvement          | Faster path from saved deadlines to an immediately useful next action.                     |
| Day 7 retention  | Meaningful improvement        | Dashboard content changes as deadlines move and work is completed.                         |
| Day 30 retention | Small-to-moderate improvement | Semester context compounds, but reminders and cross-device expectations remain unresolved. |

## Verification

- Production build: passed.
- ESLint: passed with 0 errors and 8 existing Fast Refresh warnings.
- Dashboard tests: passed, including daily-brief priority and counts.
- Browser Companion syntax checks: passed.
- Browser Companion suite: passed.
- Grounding tests: 55 assertions passed.
- Runtime stability: passed five consecutive runs.
- Diff whitespace validation: passed.
- Desktop, mobile, and onboarding logic were reviewed against responsive structure and the previously completed live walkthrough. A fresh automated visual browser connection was unavailable in this run, so live screenshot verification of the new Today card remains a final pre-merge check.

## Files changed for this mission

- `src/lib/semester-pressure.ts`
- `src/routes/dashboard.tsx`
- `src/routes/ask.tsx`
- `browser-companion/content.js`
- `browser-companion/tests/semester-pressure.test.ts`
- `DAILY_HABIT_REPORT.md`

## Launch confidence

**82 / 100 for a closed beta.**

The core daily value proposition is now coherent and testable. The remaining uncertainty is behavioral rather than architectural: students must prove that today’s focus and the cross-surface study loop are valuable enough to reopen without notifications.

## Six months later: why Student B never left

Student B did not stay because UniMate was a better blank chatbot. They stayed because UniMate remembered the shape of the semester, showed the right next commitment each morning, helped at the moment of friction, and carried the same conversation into the browser where the work happened. Each return required less re-explaining and produced a clearer next step. UniMate became the place the academic day began and the place completed work became visible.
