# Deferred Post-Launch Work

These items are intentionally outside the August 10 release scope unless a launch gate changes.

## Product and continuity

- Add a consolidated Settings page for theme, account, privacy, Companion, and notification preferences.
- Sync Notes and Bulletin Board across devices after an approved schema/RLS design and migration plan.
- Add undo for destructive actions, using one consistent pattern across courses, assignments, chats, notes, and links.
- Add conversation export/deletion and a documented retention workflow.

## Performance and engineering

- Profile and split the roughly 649 kB main client chunk; isolate PDF.js and other route-heavy dependencies without destabilizing launch.
- Add automated visual regression, authenticated end-to-end, email-delivery, and production-extension tests.
- Resolve eight Fast Refresh warnings by separating shared exports from component modules.
- Adopt versioned Supabase migrations after a migration/rollback design review.
- Upgrade dependencies in a dedicated branch with compatibility testing; do not mix upgrades into hotfixes.

## AI and operations

- Add a provider adapter and validated fallback matrix only after text/vision grounding parity tests.
- Evaluate folding related concepts into the primary Ask response to remove a second model call.
- Add consent-aware product analytics after vendor, retention, privacy language, and cost approval.
- Add external uptime/error monitoring after pricing and data-handling review.
- Refine usage caps from real cohort data while preserving a hard budget ceiling.

## Billing

- Complete subscription lifecycle synchronization, durable webhook event idempotency, customer portal, delayed-payment handling, failure communication, and cancellation/expiration behavior.
- Consider storing subscription id/status/current-period data only through an explicitly approved schema/RLS migration.

## Browser Companion

- Consider optional per-site permissions if product research shows the persistent all-sites mascot is not essential.
- Add automated packaged-extension tests in real Chrome profiles and store-update regression coverage.
- Add a production-safe website-to-extension session handoff after a security review.
- Revisit cross-origin iframe and browser-owned PDF limitations only within Chrome’s platform constraints.

## Security and data

- Replace local Canvas tokens with a secure OAuth or encrypted server-side design before ever making Canvas a visible launch feature.
- Review and explicitly restrict `SECURITY DEFINER` function execution privileges after schema-change approval.
- Formalize backup recovery objectives and recurring restore drills.
