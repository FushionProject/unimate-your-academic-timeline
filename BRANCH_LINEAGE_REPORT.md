# Branch Lineage Report

## Scope and terminology

This report inspects the repository's Git refs without checking out, merging, resetting, rebasing, deleting, or modifying any branch. Remote state was verified read-only with `git ls-remote`; the only remote branch on GitHub is `main` at `deb8b0f`.

For this report:

- **Current stable branch** means local `main` at `9e5faab85619b30749e595c10ff94b4b0529b8ee`.
- **Published stable branch** means `origin/main` at `deb8b0f443082b6bb7f33c8ef80b1db5734eea84`.
- “Unique commits” means commits reachable from a branch that are not reachable from local `main`.
- “Changed files since published stable” is the number of paths changed from `origin/main` to the branch tip.
- Working-tree changes are not branch lineage. The current worktree contains substantial uncommitted production-hardening, billing, and AI-capacity work; none of it belongs to any branch until it is committed.

## Complete branch inventory

| Branch | Scope | Commit | Subject | Classification | Unique commits vs local `main` | Commits since `origin/main` | Changed files since `origin/main` | Contribution type |
|---|---|---|---|---|---:|---:|---:|---|
| `main` | Local | `9e5faab85619b30749e595c10ff94b4b0529b8ee` | Merge daily habit engine | **ALREADY INCLUDED** | 0 | 3 | 104 | Application code and documentation |
| `codex/ai-capacity-controls` | Local/current worktree | `9e5faab85619b30749e595c10ff94b4b0529b8ee` | Merge daily habit engine | **DUPLICATE** | 0 | 3 | 104 | Application code and documentation at the committed tip; AI-capacity additions are uncommitted |
| `codex/daily-habit-engine` | Local | `72d31d68730e0376c96bb376cc69101edeee60e9` | Add UniMate companion and daily student workflow | **ALREADY INCLUDED** | 0 | 2 | 104 | Application code and documentation |
| `codex/prelaunch-polish` | Local | `7c1354411ebe84b0ff5fb493f75b60cc74c358f8` | Polish prelaunch UniMate UX | **SUPERSEDED** | 0 | 1 | 22 | Application code and documentation |
| `codex/august-10-launch-readiness` | Local | `7c1354411ebe84b0ff5fb493f75b60cc74c358f8` | Polish prelaunch UniMate UX | **DUPLICATE** | 0 | 1 | 22 | Application code and documentation |
| `codex/student-delight-audit` | Local | `7c1354411ebe84b0ff5fb493f75b60cc74c358f8` | Polish prelaunch UniMate UX | **DUPLICATE** | 0 | 1 | 22 | Application code and documentation |
| `origin/main` | Remote | `deb8b0f443082b6bb7f33c8ef80b1db5734eea84` | Add interactive syllabus timeline, custom icon set, and screen assistant | **SUPERSEDED** | 0 | 0 | 0 | Published application baseline |

`origin/HEAD` is not an independent branch; it is a symbolic alias for `origin/main` and therefore points to the same `deb8b0f` commit.

## Requested branch names that do not exist

The following names are not present under local `refs/heads`, remote `refs/remotes`, or GitHub remote heads:

- `codex/apple-polish-audit`
- `codex/production-hardening`
- `codex/security-production-audit`
- `codex/founder-strategy`

Because they are not branches, they cannot truthfully receive one of the branch classifications. Related artifacts exist elsewhere:

- Apple-level and launch-readiness reports were committed inside `codex/daily-habit-engine` and are now included in local `main`.
- `FOUNDER_STRATEGY_REPORT.md`, `INVESTMENT_MEMO.md`, and `COMPETITIVE_MOAT_PLAN.md` were committed inside `codex/daily-habit-engine` and are now included in local `main`.
- `PRODUCTION_INFRASTRUCTURE_AUDIT.md` was committed inside `codex/daily-habit-engine` and is included in local `main`.
- `PRODUCTION_HARDENING_REPORT.md`, `AI_CAPACITY_REPORT.md`, the AI runbook/limits, the Supabase usage migration/rollback, and their associated application changes currently exist only as uncommitted working-tree content on the worktree attached to `codex/ai-capacity-controls`.

## Exact duplicate groups

### Commit `7c1354411ebe84b0ff5fb493f75b60cc74c358f8`

These three branches are exact ref duplicates with identical trees and history:

- `codex/prelaunch-polish`
- `codex/august-10-launch-readiness`
- `codex/student-delight-audit`

There is no August-specific or Student-Delight-specific committed delta between them. `codex/prelaunch-polish` is treated as the canonical historical name because its commit subject and `PRELAUNCH_POLISH_SUMMARY.md` match the actual content. The other two refs are duplicates.

### Commit `9e5faab85619b30749e595c10ff94b4b0529b8ee`

These two branches point to the exact same commit and tree:

- `main`
- `codex/ai-capacity-controls`

The AI-capacity branch name is misleading at the Git level. Its capacity-control work has not been committed; switching to or pushing that branch would currently produce the same code as local `main`.

### Remote alias

- `origin/HEAD` and `origin/main` resolve to `deb8b0f443082b6bb7f33c8ef80b1db5734eea84`.

## Ancestor and descendant relationships

The committed lineage is linear until the final merge pointer:

```text
origin/main
deb8b0f
   |
   v
7c13544  prelaunch polish
   |     branches: prelaunch-polish, august-10-launch-readiness,
   |               student-delight-audit
   v
72d31d6  daily habit engine + Companion + reports
   |
   v
9e5faab  merge commit
         branches: main, ai-capacity-controls
```

More precisely:

- `origin/main` is an ancestor of every local branch.
- The three `7c13544` branches are descendants of `origin/main` and ancestors of `codex/daily-habit-engine`, local `main`, and `codex/ai-capacity-controls`.
- `codex/daily-habit-engine` is a descendant of the `7c13544` group and an ancestor/second parent of local `main`'s merge commit.
- Local `main` and `codex/ai-capacity-controls` are identical tips; neither is ahead of the other.
- Local `main` is three commits ahead of `origin/main`: `7c13544`, `72d31d6`, and merge commit `9e5faab`.
- The tree at local `main` is exactly identical to the tree at `codex/daily-habit-engine`. The merge commit introduced no additional file changes beyond the daily-habit branch tree.

## Branches with unique commits not in current stable

There are **none**.

Every actual local branch is either local `main` itself, an exact duplicate of local `main`, or an ancestor already reachable from local `main`. No committed branch contains application or documentation changes that are absent from current local stable.

The uncommitted capacity/hardening work is important but does not count as a branch with unique commits. It must be preserved and reviewed as working-tree content before any branch cleanup.

## Commit and changed-file accounting

### Relative to local stable `main`

| Branch | Commits unique to branch | Commits present in `main` but absent from branch | Files introduced by unique commits |
|---|---:|---:|---:|
| `main` | 0 | 0 | 0 |
| `codex/ai-capacity-controls` | 0 | 0 | 0 |
| `codex/daily-habit-engine` | 0 | 1 | 0 |
| `codex/prelaunch-polish` | 0 | 2 | 0 |
| `codex/august-10-launch-readiness` | 0 | 2 | 0 |
| `codex/student-delight-audit` | 0 | 2 | 0 |
| `origin/main` | 0 | 3 | 0 |

Files introduced by unique commits are zero for every branch because no branch is ahead of local `main`.

### Relative to published `origin/main`

| Branch/group | New commits | Changed files | Content |
|---|---:|---:|---|
| `7c13544` duplicate group | 1 | 22 | UX polish, authentication/API hardening, RLS/Stripe changes, architecture and polish documentation |
| `codex/daily-habit-engine` | 2 | 104 | Everything in prelaunch plus Browser Companion, daily workflow/dashboard work, password flows, audio/assets, tests, reports, strategy documents, and Companion SQL |
| Local `main` / `codex/ai-capacity-controls` committed tip | 3 | 104 | Same final tree as daily-habit; the third commit is a merge with no additional tree delta |
| `origin/main` | 0 | 0 | Published baseline |

## Which branches supersede others

- `codex/daily-habit-engine` supersedes all three `7c13544` refs because it directly descends from that commit and adds the Companion, daily workflow, extensive tests, launch reports, audio, password recovery, and supporting SQL.
- Local `main` supersedes `codex/daily-habit-engine` as the integration ref, although both have the exact same file tree.
- Local `main` supersedes the current published `origin/main` by three commits and 104 changed files, subject to release review and publishing.
- `codex/ai-capacity-controls` does not supersede local `main` in committed history. It is merely a duplicate pointer with uncommitted work in its attached worktree.
- The absent named branches cannot supersede anything. Their relevant documents are already included through `codex/daily-habit-engine`, while production-hardening/capacity code remains uncommitted.

## Classification rationale

### `main` — ALREADY INCLUDED

This is the current local integration/stable ref and already contains the prelaunch and daily-habit lineages.

### `codex/ai-capacity-controls` — DUPLICATE

Its committed tip and tree exactly equal `main`. The branch's named mission only exists as uncommitted working-tree changes and therefore is not mergeable branch history yet.

### `codex/daily-habit-engine` — ALREADY INCLUDED

Its commit is already reachable from `main`, and its tree equals `main`'s tree.

### `codex/prelaunch-polish` — SUPERSEDED

This is the most accurate canonical name for commit `7c13544`, but all of its work is contained in the later daily-habit commit and local `main`.

### `codex/august-10-launch-readiness` — DUPLICATE

It has no independent August 10 commit or changed file; it exactly duplicates prelaunch polish.

### `codex/student-delight-audit` — DUPLICATE

It has no independent student-delight commit or changed file; it exactly duplicates prelaunch polish.

### `origin/main` — SUPERSEDED

It is the published baseline and remains important, but local `main` is its tested descendant with the later integration. The remote is behind rather than divergent.

## Release-candidate foundation

The best committed release-candidate foundation is:

**Local `main` at `9e5faab85619b30749e595c10ff94b4b0529b8ee`.**

Use it from a clean worktree. Do not treat the currently dirty `codex/ai-capacity-controls` worktree as a reproducible release candidate until its uncommitted changes are separated, committed, and reviewed.

Reasons:

- It contains all committed work from prelaunch polish and daily habit.
- No other branch has unique commits missing from it.
- Its tree exactly equals the most advanced feature branch, `codex/daily-habit-engine`.
- `origin/main` is behind but not divergent, so publication can be straightforward after review.

## Exact branches still requiring review

### Branch-level review

- `main` — requires final integrated Release Candidate review because it contains a very large 104-file delta from published `origin/main`.
- `codex/daily-habit-engine` — does not need a separate merge review because it is already included, but its `72d31d6` commit should be reviewed as the dominant content inside the `main` RC review.

### Work that cannot yet be reviewed as a branch

- `codex/ai-capacity-controls` — the branch ref itself is a duplicate and needs no merge review. Its **uncommitted working tree** requires preservation, separation from earlier uncommitted production-hardening/billing changes, commits, and then independent review. Until that happens there is no AI-capacity commit to merge.

No other existing branch has unique commits requiring merge review.

## Branches that can be ignored or deleted after preservation checks

The following local refs are redundant in committed history and can be ignored immediately. They can be deleted only after confirming no external process relies on their names and after the current uncommitted work is safely preserved:

- `codex/august-10-launch-readiness` — exact duplicate of `codex/prelaunch-polish`.
- `codex/student-delight-audit` — exact duplicate of `codex/prelaunch-polish`.
- `codex/prelaunch-polish` — fully superseded by `codex/daily-habit-engine` and `main`.
- `codex/daily-habit-engine` — already merged into `main`; retain temporarily if useful for audit provenance.
- `codex/ai-capacity-controls` — the ref is redundant with `main`, but **do not delete its attached worktree or branch until every uncommitted capacity/hardening file is committed elsewhere or otherwise safely preserved**.

Do not delete `origin/main`; it is the published primary branch. It should be advanced through the normal reviewed release process.

The names `codex/apple-polish-audit`, `codex/production-hardening`, `codex/security-production-audit`, and `codex/founder-strategy` require no deletion because they do not exist.

## Recommended safe merge or cherry-pick order

### Preferred: preserve the existing integration

1. Freeze a clean worktree at local `main` commit `9e5faab`.
2. Review `main` as the complete RC delta against `origin/main`.
3. Preserve and separate all current uncommitted work before doing anything to `codex/ai-capacity-controls`.
4. Commit production-hardening/billing work on a correctly named branch and review it independently.
5. Commit AI-capacity work on `codex/ai-capacity-controls` (or a fresh clean branch from the accepted RC) and review the migration, rollback, limits, and tests independently.
6. Merge the accepted hardening changes into the RC.
7. Merge the accepted AI-capacity changes after the hardening baseline it depends on.
8. Run the full integrated release suite and staging migration checks.
9. Advance/push `origin/main` only after approval.

No existing prelaunch, August, Student Delight, or daily-habit branch needs to be merged again; doing so would duplicate already included history.

### If reconstructing a clean linear RC from `origin/main`

1. Start from `origin/main` at `deb8b0f`.
2. Cherry-pick `7c13544` (`Polish prelaunch UniMate UX`).
3. Cherry-pick `72d31d6` (`Add UniMate companion and daily student workflow`).
4. Do not cherry-pick `9e5faab`; it is a merge commit whose resulting tree is already exactly the `72d31d6` tree.
5. Add separately reviewed hardening and capacity commits afterward.

This reconstruction produces the same committed application tree as current local `main` before the uncommitted hardening/capacity work.
