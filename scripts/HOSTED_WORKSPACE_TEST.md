# Private hosted workspace check

`test-hosted-study-workspace.mjs` checks real persistence between a protected UniMate Preview and an installed Companion in a fresh Chromium profile. It is an operator script, excluded from Vercel uploads and the extension package.

Prerequisites:

- Back up the database and apply the study-workspace migration before this run. This script does neither.
- Supply the exact ready Preview deployment URL (not an alias or Production). The script verifies its UniMate project/team using the existing Vercel CLI login and obtains short-lived development OIDC access in memory.
- The existing marked account in ignored `.stripe-sandbox.local/test-user.json` must have Pro access. Any temporary test entitlement is managed and restored separately by the operator; this run is **not billing/purchase evidence**.
- Use existing Chromium and matching installed Playwright. Do not install another browser or reuse a personal browser profile.

Example (the URL must be replaced with the verified new Preview):

```sh
UNIMATE_HOSTED_WORKSPACE_TEST=approved \
UNIMATE_WORKSPACE_PREVIEW_ORIGIN=https://EXACT-DEPLOYMENT.vercel.app \
UNIMATE_VERCEL_CLI_PATH=/Users/ryanpalumbo/.npm/_npx/f56f1f0dfbede539/node_modules/vercel/dist/vc.js \
PLAYWRIGHT_MODULE_PATH=/Users/ryanpalumbo/ClaudeVideos/huang_v1/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/Users/ryanpalumbo/Library/Caches/ms-playwright \
node scripts/test-hosted-study-workspace.mjs
```

The runner signs into the website and extension with that marked account. It saves a fictional assignment on the website and resumes it in Companion, updates progress in Companion and reloads it on the website, saves a website note and reads it through the installed extension’s authenticated worker, saves a Companion link and checks the website Bulletin, and creates a second standalone assignment in Companion for website resume. The note read uses the actual extension message handler; Companion does not currently provide a separate in-panel Notes list.

Only explicit reviewed UI saves are used for writes. No AI request, screen capture, Stripe endpoint, course mutation, deletion, or entitlement mutation is allowed. Website billing reads are transported with `reconcile=false` so the check uses persisted entitlement without provider reconciliation. The response is not mocked. Fresh test records are tagged with the run UUID and retained for review. Existing test-account data is not deleted; its active browser-chat preference moves to the newly created test chat.

Artifacts are private and ignored beneath `.stripe-sandbox.local/workspace-<run UUID>/`. `result.json` is emitted only after all assertions pass. Screenshots contain fictional coursework after sign-in; credentials and OIDC are never logged, screenshot, or written to source. Temporary Chromium authentication remains in this private isolated profile until separately removed.

Offline guards are covered by `npm run workspace:test`. A passing offline policy check is **not** evidence that hosted save/resume passed.

November 12 status: the verified backup/restore and migration `20261112201345`
are complete. The protected Preview
<https://unimate-r11nbzj7i-resumejuice-s-projects.vercel.app> is `READY` at application
source `d5f1751f1076b195ec8ecb0e088621d613e71083`, deployment
`dpl_GbGLtrh6Ejv8Jjg37XYoAzWoB3gw` (Preview target, no aliases). CI run
`43308680054` and protected HTTP smoke checks passed. After explicit owner approval
of temporary Pro access, the installed cross-app test **passed all seven checks**
with zero AI, Stripe, or policy-blocked requests. Its private result is
`.stripe-sandbox.local/workspace-4dc3f77a-20fa-4c25-9f79-b3c142d88f11/result.json`.
The operator wrapper restored and verified the marked account's Free access;
the private restoration journal is
`workspace-entitlement-6aa3beed-c82e-4a1d-aae3-ef38a1617476.json`. Synthetic saved
records are retained for review, and existing test data was not deleted.
All three disposable Chromium profiles from this rollout were removed afterward;
their synthetic screenshots, results, and restoration journals were retained.

The successful run includes two fixture corrections: use the exact textbox role
for hydrated textarea reads, and clear the localhost source link when creating
the standalone fixture assignment. A selector regression covers the first fix.
These are test-only changes; the deployed application remains `d5f1751`. Vercel
authentication is still required. Public signup, live Stripe, and Store
publication are unchanged. Separately, email Site URL and the exact `/dashboard`,
`/upgrade`, and `/reset-password` redirects were saved and read back on this Preview,
with old entries removed and no wildcards. SMTP/provider, confirmation, and signup
settings were unchanged; email delivery was not retested. See [LAUNCH.md](../LAUNCH.md)
for the settings evidence. This run proves hosted save/resume with synthetic
coursework, not billing/purchase or real-model quality.
