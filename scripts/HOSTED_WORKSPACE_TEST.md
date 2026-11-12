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

Offline guards are covered by `npm run workspace:test`. A passing offline policy check is **not** evidence that hosted save/resume passed. As of preparation, the hosted check awaits the database migration and new private Preview.
