# AI entitlement rollout

Status: installed and verified on UniMate (`gtqfaxsokdlrdxipcyqo`) on
2026-10-13 UTC. Root `SUPABASE_USAGE_MIGRATION.sql` is step 1 and
`supabase/ai_usage_entitlements.sql` is step 2. Both durable flags are enabled in
the private local development configuration and the protected Vercel Preview.
The current protected Preview passed smoke checks and the owner-authenticated
Companion screenshot/AI/save/reload flow, with usage accounting advancing once.
This is not a public launch, and the final production origin still needs
verification. No Stripe state changed.

Current-source clarification, October 13 local / October 14 UTC: later billing,
onboarding, recovery and Companion session-expiry edits are not deployed in the
historical snapshots below. This pass did not change quota migrations, limits,
provider spending settings, or public-production access. Hosted re-verification
of the eventual frozen release remains required.

## Deployment evidence

- Full PostgreSQL custom-format backup plus roles without passwords saved in
  the private, Git-ignored `.private-backups/2026-10-13T04-30-17-041Z-51GHDS/`.
  File permissions and SHA-256 hashes are recorded in its manifest.
- Restore-tested the auth, public, storage, realtime, and migration schemas in
  an isolated PostgreSQL 17 instance with no TCP listener. Counts matched:
  18 accounts/profiles, 14 courses, 46 assignments, 8 chat messages, 13
  conversations, and 8 preferences. The backup predates the local and hosted
  live tests, which subsequently saved four synthetic question/answer pairs
  (eight messages in total, including two new messages in the latest `lxccy367v` check).
- The archive includes database schema/data, but not Storage object binaries,
  platform settings, or role passwords. The source had zero Storage objects
  and zero Vault secrets. Local restore validation does not validate Supabase
  platform extensions, production ownership, or ACL restoration.
- `npm run capacity:test:postgres` executes both migrations twice, Free/Pro
  limits, duplicate rejection, daily/monthly/global caps, concurrent requests,
  completion idempotency, provider circuit recovery, and rollback against
  synthetic data. Mutation checks detected both original ambiguous-column
  faults and the original completion/reservation deadlock.
- Installed migrations: `20261013043319_unimate_durable_ai_capacity` and
  `20261013043331_unimate_product_ai_entitlements`.
- Live function assertions passed inside a transaction that was rolled back;
  all eight usage tables were then confirmed empty before the real test.
  All tables have RLS with no client access; all five functions have an empty
  search path and grant execution only to the server role (besides owners).
- After restarting the local preview with the flags enabled, the signed-in
  companion completed screenshot → real AI answer → chat save/readback →
  history after reload. The durable ledger recorded one successful request,
  with exactly one daily and one monthly screenshot use.
- Current verified protected Preview:
  `https://unimate-lxccy367v-resumejuice-s-projects.vercel.app`
  (`dpl_8Q2ZiuJJSGP21wywWFsoZH7zL1cP`, `READY`, target `null`,
  `vercel_authentication`). Source audit:
  `.vercel/upload-audits/source-Wja4Tr/manifest.json` (137 files, 9,091,915 bytes).
  Manifest bytes were asserted unchanged before deployment. The upload used the
  local dirty source atop `9011f8c`, not a committed release.
  Health 200 (`status:ready`, `ai:ready`), signup 200 (`enabled:false`), unsigned
  valid Companion request 401 (`AUTH_REQUIRED`), and anonymous root 302 to
  Vercel SSO passed.
  Post-deploy metadata confirmed `ssoProtection:all_except_custom_domains`,
  `autoAssignCustomDomains:false`, zero bypass credentials, zero Production
  variables, and 11 Preview variables; protected-access checks and secret scan pass.
- On that same Preview, mandatory isolated-profile reload confirmed the current
  worker capabilities before transient access. The authenticated Pro owner
  had consent verified and completed screenshot POST 200 with a correct real-provider
  mitochondria answer, chat POST 201, GET 200 readback, and history after reload.
  One paid question added two synthetic messages; the isolated browser was closed.
  Read-only aggregate checks showed successful `browser_companion` ledger,
  screenshot monthly/daily counts, and global request count increasing from
  three to four, with provider errors still zero. No public launch, domain
  connection, or Stripe change occurred.
- An earlier protected smoke-tested Preview is
  `https://unimate-clbphi1j3-resumejuice-s-projects.vercel.app`
  (`dpl_8ZUtaDTxBK2K6jqkokV3Di8Jn2MG`, READY, Preview), containing the older
  discount-only correction, not the current candidate. Its source audit is
  `.vercel/upload-audits/source-yE9qcB/manifest.json` (137 files, 9,093,866 bytes).
  Recorded smoke checks passed: exact project/team and READY Preview validated;
  health 200 (`status:ready`, `ai:ready`), signup status 200 (`enabled:false`),
  valid unsigned Companion request 401 (`AUTH_REQUIRED`), and unauthenticated
  visitor 302 to Vercel SSO. These checks made no AI calls or database writes.
  At that check, protection was enabled, with zero
  bypass credentials, zero Production variables, 11 Preview variables, and no
  automatic custom-domain assignment. This did not add paid AI calls or usage.
- The distinct historical owner-verified screenshot/save Preview at
  `https://unimate-7blad7yjh-resumejuice-s-projects.vercel.app`
  (`dpl_BRyCm6MqEEwpP3oToz6XmmSXFLwi`, READY, Preview) repeated the owner-account
  flow successfully: screenshot/real mitochondria answer 200, save 201,
  readback GET 200, and history after reload. The ledger, product daily count,
  screenshot daily count, and global request count were each three, with zero
  provider errors. No duplicate usage was recorded. Source-upload audit:
  `.vercel/upload-audits/source-TI3kgK/manifest.json` (137 files, 9,091,919 bytes).
  These historical Preview records are distinct from the current `lxccy367v`
  deployment and its owner verification above.
  Live quota exhaustion and the provider spending cap were not exercised.
  Preview credentials are scoped only to Preview; the locked bootstrap
  Production build has no database or AI credentials. No Stripe state changed.

## Current candidate verification boundaries

These candidate changes do not alter the allowance contract below or the installed
database migrations:

- Current-source installed-browser evidence: 24 synthetic scenarios, nine fake AI calls,
  artifact `unimate-companion-browser-PYVpwx` in the host temporary directory.
  Transport recovery passes in that browser run. Same-URL mutation and new
  session-expiry guards pass separate deterministic offline tests. These are not paid AI
  calls or live usage rows. Full tests, protected-preview tests, typecheck,
  builds, secret scan, and lint pass, with eight preexisting lint warnings.
- The new grounding policy distinguishes authored academic teaching from
  source/page claims. It permits worked math, hints, academic facts, and labeled
  practice while retaining evidence checks for quotations, empirical statistics,
  page/course facts, unseen sources, and claimed answer keys. It replaces the
  arithmetic whitelist; it is not a universal correctness verifier.
- Actual text and vision provider helpers reject truncated completions with a
  retryable error, no partial success, and no hidden provider retry. Questions
  remain recoverable. Full 4,000-character prompts reach analysis; transformed
  or zoomed iframe ancestry causes conservative omission of supplemental text.
- Public-config generation rejects privileged/secret keys before writing;
  existing project credentials were not changed. The preview runner always
  reloads a resumed isolated profile before attaching transient access.
- The historical eleven-case live tutor evaluation remains **10/11**, under an
  aggregate 4,000-completion-token ceiling. Its correct discount answer failed
  the former numeric guard and now passes offline under the new policy. There
  has been no eleven-case live rerun of the new policy. The latest single biology
  screenshot is separate; evaluator cases are not additional owner Companion
  chat pairs in the counts above.

Manual spoken screen-reader verification, public-package and business/legal
review, billing lifecycle verification, public-production configuration, domain
connection, and Store publication remain separate gates. See `browser-companion/README.md` and
`browser-companion/CHROME_WEB_STORE_READINESS.md` for the release checklist.

Existing advisor notices remain separate from this rollout: client EXECUTE
grants on the signup-only `handle_new_user` trigger and disabled leaked-password
protection. The trigger creates profiles with `is_pro=false`; client-controlled
metadata cannot grant Pro. The new usage tables intentionally have no client
RLS policies and therefore generate informational advisor notices.

## Release contract

| Feature                      | Free          | Pro                          |
| ---------------------------- | ------------- | ---------------------------- |
| AI syllabus parse            | 2 lifetime    | 30/month fair-use ceiling    |
| Ask UniMate text             | Not available | 750/month                    |
| Browser Companion text       | Not available | Shared 750/month text bucket |
| Browser Companion screenshot | Not available | 25/day and 300/month         |

All decisions must be server-side. `profiles.is_pro` is the canonical plan
record; client state and user-editable Auth metadata must never authorize Pro.

## Required server wiring before launch

1. Validate the access token and bind reservations to that validated user.
2. Generate one UUID request ID per logical request and use the canonical
   `reserve_ai_usage` flow before contacting an AI provider.
3. Map syllabus to `syllabus`, Ask/Companion text to `text`, and screenshot
   analysis to `screenshot`.
4. Return `403 PRO_REQUIRED` or `429 QUOTA_EXCEEDED` as appropriate.
5. Fail closed during entitlement/RPC outages; do not call the AI provider.

## Safe deployment order

1. Test both SQL steps on a development branch, including parallel and
   duplicate requests.
2. Run Supabase security/performance advisors and resolve findings.
3. Apply step 1, then step 2, while server enforcement remains disabled.
4. Deploy server wiring, verify endpoint mappings, then enable both durable flags.
5. Monitor denials, provider spend, and RPC errors; do not advertise unlimited.

To reproduce the backup procedure, supply the existing database password only
in private `.env.backup.local` (or `.env.local`) as
`UNIMATE_BACKUP_DB_PASSWORD`. Download the public CA certificate from Supabase
Database Settings, then run `node scripts/backup-unimate-db.mjs --ca-file
<absolute-certificate-path>`. It is fixed to UniMate and requires certificate
and hostname verification. Run `node scripts/verify-unimate-db-backup.mjs
<private-backup-directory>` for the explicitly scoped local restore check.
Neither utility changes the source database. Protect the unencrypted backup;
an off-device recovery copy has not been made.

Rollback step 2 with `supabase/ai_usage_entitlements_rollback.sql` only after AI
is paused and `AI_DURABLE_ENTITLEMENTS_ENABLED=false`. The rollback destroys
product allowance history, so export counts first if they are needed for support.

`SIGNUPS_ENABLED=false` pauses the website signup UI only. For a true emergency
pause, disable new registrations in Supabase Auth as well; otherwise the public
Auth endpoint remains directly callable.
