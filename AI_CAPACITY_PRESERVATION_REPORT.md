# AI Capacity Preservation Report

## Outcome

**PRESERVED WITH UNRELATED CHANGES REMAINING**

The uncommitted AI capacity and cost-control implementation was identified, isolated from unrelated work, preserved on a dedicated branch, and committed without applying its database migration or enabling production quotas.

## Original State

- Original branch: `codex/ai-capacity-controls`
- Original commit: `9e5faab85619b30749e595c10ff94b4b0529b8ee` (`Merge daily habit engine`)
- Original branch relationship: the branch pointed to the same commit as local `main`.
- Working tree: modified and untracked files were present. AI capacity work was mixed with billing, browser-session synchronization, general production hardening, database hardening, dependency-lock changes, reports, and temporary files.
- Initial inspection performed: `git status`, `git branch --show-current`, `git log --oneline --decorate -10`, `git diff --stat`, `git diff --name-only`, and `git diff`.

## Capacity Work Confirmed

The working tree contained the implementation described by all five expected artifacts:

- `AI_CAPACITY_REPORT.md`
- `AI_USAGE_LIMITS.md`
- `AI_PRODUCTION_RUNBOOK.md`
- `SUPABASE_USAGE_MIGRATION.sql`
- `SUPABASE_USAGE_ROLLBACK.sql`

The implementation includes durable quota reservation/completion logic, per-feature Free and Pro limits, burst limits, duplicate suppression, circuit-breaker and degraded-mode controls, model configuration, screenshot/search controls, privacy-safe usage summaries, request correlation IDs, and related regression tests.

## Preservation Branch and Commit

- Preservation branch: `codex/ai-capacity-controls-saved`
- Branch base: `9e5faab85619b30749e595c10ff94b4b0529b8ee`
- Preservation commit: `a368bcfb5c39748764903f8d3b5e6aad4bd9b22a`
- Commit message: `Preserve AI capacity and cost controls`
- Difference from `main`: 19 files, 1,741 insertions, 141 deletions

## Files Preserved

- `.env.example` — AI model, quota, breaker, degraded-mode, feature-disable, and admin configuration examples only
- `AI_CAPACITY_REPORT.md`
- `AI_PRODUCTION_RUNBOOK.md`
- `AI_USAGE_LIMITS.md`
- `SUPABASE_USAGE_MIGRATION.sql`
- `SUPABASE_USAGE_ROLLBACK.sql`
- `src/lib/ai-capacity.ts`
- `src/server.ts` — capacity enforcement, accounting, request limits, provider state, search/screenshot controls, model selection, admin summary route, request-size protection, and required entitlement lookup only
- `src/components/screen-assistant.tsx` — request correlation header
- `src/functions/ask-unimate.ts` — request correlation header
- `src/functions/parse-syllabus.ts`
- `src/functions/extract-resources.ts`
- `src/functions/generate-study-map.ts`
- `browser-companion/background.js` — bounded persistence, request IDs, and in-flight duplicate suppression only
- `browser-companion/tests/ai-capacity.test.ts`
- `browser-companion/tests/ai-release-guards.test.mjs`
- `browser-companion/tests/production-hardening.test.mjs`
- `scripts/secret-scan.mjs`
- `package.json` — verification scripts

## Files and Changes Intentionally Excluded

The following remain unstaged and were not included in the preservation commit:

- Stripe subscription lifecycle, checkout, portal, webhook, and billing UI/configuration work
- Website-to-extension sign-out and account/session synchronization changes
- Broader Browser Companion trust, manifest, runtime, and entitlement changes
- Canvas proxy and general API hardening not required by capacity controls
- Supabase profile/RLS/index hardening unrelated to the usage migration
- Dependency lockfile changes
- General architecture and Browser Companion documentation edits
- `BILLING_IMPLEMENTATION.md`
- `BRANCH_LINEAGE_REPORT.md`
- `PRODUCTION_HARDENING_REPORT.md`
- the existing `tmp/` directory
- this preservation report, which was created after the preservation commit

No local files were discarded, reset, cleaned, overwritten, or deleted.

## Verification Results

Verification of an isolated archive of the preserved commit:

| Check | Result |
|---|---|
| Production build | Pass |
| ESLint | Pass with 8 existing Fast Refresh warnings and 0 errors |
| AI capacity tests | Pass |
| Rate-limit and quota tests | Pass as part of the capacity suite |
| Duplicate/concurrency protections | Pass in capacity and Companion suites |
| Browser Companion suite | Pass |
| Grounding tests | Pass, 55 assertions |
| Runtime stability | Pass, including 5 consecutive runs |
| Billing safeguards | Pass |
| Secret scan | Pass, 188 repository files checked; values were not printed |
| `git diff --check` | Pass |
| Dependency audit | Fails: 12 advisories (10 high, 2 low) in existing dependencies |
| Clean-commit production-hardening guard | Fails because that guard also requires intentionally excluded webhook, Canvas, billing, RLS, manifest, and session-sync hardening |
| Full current-working-tree production-hardening guard | Pass |

The hardening discrepancy is an expected scope boundary, not evidence that the capacity files were lost. The hardening guard was created alongside several unrelated working-tree changes and therefore is not independently green on the capacity-only commit.

## Supabase Migration Status

- Migration prepared: yes
- Rollback prepared: yes
- Migration applied: **no**
- Durable quotas enabled in production: **no**
- Production behavior remains configuration- and deployment-dependent until the migration, RLS requirements, environment configuration, and manual rollout steps are reviewed and applied explicitly.

## Main and Remote State

- Local `main`: `9e5faab85619b30749e595c10ff94b4b0529b8ee`
- `origin/main`: `deb8b0f443082b6bb7f33c8ef80b1db5734eea84`
- Local `main` is three commits ahead and zero commits behind:
  1. `7c13544` — `Polish prelaunch UniMate UX`
  2. `72d31d6` — `Add UniMate companion and daily student workflow`
  3. `9e5faab` — `Merge daily habit engine`
- `origin/main` is an ancestor of local `main`; pushing local `main` would be a normal fast-forward.
- No remote branch currently exists for `codex/ai-capacity-controls-saved`; `origin` is a valid target for publishing it.
- Nothing was pushed automatically.

## Recommended Push Commands

Review the commit first, then publish only the preservation branch:

```bash
git show --stat --oneline a368bcfb5c39748764903f8d3b5e6aad4bd9b22a
git push -u origin codex/ai-capacity-controls-saved
```

After a separate release review confirms the three local-main commits are intended for the remote:

```bash
git log --oneline origin/main..main
git push origin main
```

Do not combine these pushes merely for convenience. The preservation branch should be reviewed independently before merge or cherry-pick.

## Exact Next Review Step

Open a review of `main..codex/ai-capacity-controls-saved`. Review the migration and RLS design first, then the reservation/completion transaction semantics, configuration defaults, circuit-breaker behavior, and admin usage endpoint authorization. Resolve the existing dependency advisories and decide whether the separate production-hardening changes should be preserved on their own branch. Only after those reviews should the Supabase migration be applied in a non-production environment and durable enforcement be enabled manually.

## Risk of Losing Work

The AI capacity implementation is protected by commit `a368bcf` on a dedicated local branch, so the immediate working-tree-loss risk is low. It is not yet backed up to a remote, so disk loss or repository corruption remains a risk until the preservation branch is pushed. Unrelated work remains only in the working tree and is still at risk until it is separately classified and preserved.

**PRESERVED WITH UNRELATED CHANGES REMAINING**
