# UniMate Browser Companion — Chrome Web Store readiness

Readiness updated: October 16, 2026, from checkpoint `8e56762` plus the reviewed
privacy-link changes on `codex/unimate-premium-revival`. The current protected
Preview runs application commit `72a0e29`. Sandbox purchase → same-panel Pro
unlock → period-end revocation passed on the earlier `5694bdb` deployment;
that proof does not automatically certify the new deployment or extension.
Screenshot/AI/save/reload evidence belongs to the historical deployments below,
not automatically to the current Preview. Full evidence: [LAUNCH.md](../LAUNCH.md)
and [Stripe sandbox manual tests](../STRIPE_SANDBOX_MANUAL_TESTS.md).
No custom domain was assigned and nothing was submitted to or published in the
Chrome Web Store.

October 16 local follow-up: full Companion verification and five runtime repeats
pass, followed by 28 installed Chromium scenarios and ten simulated AI calls.
The installed runtime exactly matched the reviewed privacy-link source; no real
credentials or provider/database/payment calls were used. Artifacts:
`unimate-companion-browser-xN92Is` in the host temporary directory. The before/after
three-file source diff SHA-256 was
`5328bf5c199fb698584e3260c9311222f7c61881e1d1baeb7b9eb76cec339e1f` atop `8e56762`.
Privacy-origin validation and safe link rendering are covered by executed
production-declaration fixtures; the installed harness covers consent behavior,
not navigation to a publicly hosted policy. No Store package was published.

## Release decision

**Not ready to submit yet.** The Chrome 106+ extension package now has the required manifest
icons and an in-product, affirmative privacy-consent gate. Historical protected
tests passed; these public-release gates remain:

1. Verify the production domain serves the Privacy Policy, Terms, and Support
   pages already implemented at `/privacy`, `/terms`, and `/support`.
2. Confirm the legal entity/developer name, support mailbox delivery, data-retention periods,
   subprocessors, deletion process, and the AI provider's launch-environment data
   terms with the product owner or counsel.
3. Configure and verify a production HTTPS `UNIMATE_API_URL`. The example config
   defaults to `http://localhost:8080`, which is blocked from Store packaging.
   No private configuration was read or production ZIP generated in this audit.
   URL syntax validation cannot establish public reachability or remove Preview
   protection. The consent screen now derives `/privacy` from the validated
   configured origin. The owner bought `askunimate.com`, but its public website
   and legal-page reachability remain launch gates.
4. Create current 1280x800 store screenshots from the production-configured
   extension and provide a 440x280 promotional tile.
5. Supply the approved listing URL as `VITE_COMPANION_STORE_URL`. The implemented
   `/companion-setup` flow already checks Pro access and displays the installation
   action only for an active Pro account and a syntactically valid Store detail
   URL. URL validation does not verify that a listing is published.
6. Confirm ownership and release rights for `assets/mascot.png` and the logo used
   for extension icons. Keep written provenance with the release record.
7. Complete a manual installed-extension test against production auth, Pro
   entitlement, HTTPS backend, restricted pages, account sign-out, and spoken
   screen-reader behavior. Automated accessibility-tree checks do not replace it.
8. Carry both durable quota flags into the hosted backend and re-verify the
   approved AI spending cap there. The database migrations and local preview
   enforcement are now verified (see `../AI_ENTITLEMENT_ROLLOUT.md`). Both flags
   and successful usage accounting are also verified in the protected Preview;
   the final public-production environment remains unverified. Budget approval
   alone is not enforcement, and the provider spending cap was not exhausted in testing.
9. Verify the production billing lifecycle, including purchase, renewal,
   cancellation, and entitlement removal. An existing Pro account's successful
   study request does not establish these behaviors. The October 14 core hosted
   sandbox flow now passes, but uses a signed local relay, not a direct production
   webhook. Local renewal/refund/dispute evidence remains separate.

## Protected hosted-test progress

- **Current protected Preview — October 15:**
  `https://unimate-2qsdme7qj-resumejuice-s-projects.vercel.app/`, deployment
  `dpl_E4Wf1fi7mKEYFd7pwPFMpRWVMt3A`, application source `72a0e29`, `READY`,
  Preview (`target:null`), no aliases. Signed-out health, signup-disabled,
  Companion denial and public-page HTML smoke checks passed, as did a browser
  landing-page check. Authentication protection remained enabled; persistent
  bypass count and Production environment-variable count remained zero. This
  does not replace the authenticated study/billing journey or Store-package test.
- **Historical protected Preview — October 14:**
  `https://unimate-fwcn4d8vz-resumejuice-s-projects.vercel.app/`, deployment
  `dpl_8FeZgD36ucSFKxW2CAMRrvrh7pjp`, application source `5694bdb`, `READY`,
  Preview (`target:null`) with no aliases. Protection remains enabled, bypass
  credentials and Production environment variables remain zero; unauthenticated
  root access redirects to Vercel. Sandbox billing configuration is Preview-only
  and live mode is false.
- **Same continuously open panel/session:** genuine sandbox purchase and signed
  hosted-handler events produced persisted Pro revision 46 before app return;
  the installed Companion displayed its composer. Real Portal cancellation
  preserved Pro until the exact synthetic clock reached period end. The deletion
  event returned 200, persisted Free revision 51 before return, and the same panel
  displayed the upgrade gate with no composer. The existing return-to-page focus
  handler was exercised; this is not passive push. Final post-return state was
  Free revision 52, no active subscriptions or open Checkouts, all four synthetic
  subscriptions canceled. Test browsers and relay exited cleanly.
- The hosted billing test made **zero AI requests, captures or page extractions**.
  It does not certify study-answer quality, draft preservation, public signup,
  direct production webhook delivery, or the broader lifecycle matrix. The
  deployment was not changed by the subsequent verification-tooling commits.

- **October 14 local sandbox billing follow-up:** actual test Checkout, successful
  and failed renewals, recovery, native duplicate/stale event redelivery,
  partial/full refunds and dispute creation/closure reconciled correctly.
  The installed Companion showed Pro using real persisted entitlement, then
  reused the same synthetic session after terminal cancellation and showed its
  upgrade gate (persisted Free revision 42). Zero AI requests, captures or page
  extractions occurred in these entitlement snapshots. All three synthetic
  subscriptions ended canceled; no owner purchase or live charge occurred.
  These finite reopened-panel snapshots do not establish a continuously open
  panel transition. See [the full sandbox record](../STRIPE_SANDBOX_MANUAL_TESTS.md).

- The approved database backup, local restore verification, and durable quota
  migrations are complete; see `../AI_ENTITLEMENT_ROLLOUT.md` for evidence and scope.
- The separate private Vercel test project is `prj_5XZ4ulni13tNLCvNzdL1gUPvashI`
  in team `resumejuice-s-projects`. Source uploads only; no custom-domain change,
  public launch, or Chrome Web Store publication is included in this test.
- Hosting is opt-in and reversible: `vite.vercel.config.ts` builds the existing
  API/SSR entry through Nitro for Vercel. The default `vite.config.ts`, Cloudflare
  build, and Wrangler preview remain intact.
- The first protected **Production** target was a bootstrap, not a release. It
  had no database or AI credentials, with signup, AI, and billing disabled. Any
  credentialed follow-up must target **Preview only**, with deployment protection
  retained; do not promote or alias it to the live domain.
- **Historical owner-flow-verified screenshot snapshot (not the current Preview):**
  https://unimate-fh8w9fay6-resumejuice-s-projects.vercel.app
  (`dpl_4crMFUU1bWRky7zx63cTUdG5azrZ`, `READY`, target `null`). Exact upload audit:
  `.vercel/upload-audits/source-zauKij/manifest.json` (137 files, 9,113,923 bytes),
  matched before and after upload; dirty source above `9011f8c`, not a release commit.
  Health/AI readiness, signup disabled, signed-out Companion denial, and Vercel
  authentication smoke checks passed. After isolated-profile reload, owner Pro
  access and consent passed; one fictional screenshot question received a correct
  real-provider answer (200), saved/read its two synthetic messages (201/200),
  and restored history after reload. The browser was closed cleanly. Post-deploy
  metadata confirms no aliases, zero bypass credentials, zero Production variables,
  11 Preview variables, no Stripe secret, and automatic custom-domain assignment
  disabled. Recorded installed synthetic coverage is 26 scenarios/10 simulated AI
  requests, including refresh failure and account revocation during a pending
  answer (`unimate-companion-browser-PpqmuG`). The screenshot-restore timeout fix
  separately passed its deterministic regression and 20 consecutive runtime runs.
- **Historical owner-flow-verified protected snapshot (predates current edits):**
  https://unimate-lxccy367v-resumejuice-s-projects.vercel.app
  (`dpl_8Q2ZiuJJSGP21wywWFsoZH7zL1cP`, `READY`, target `null`,
  `vercel_authentication`). Source audit:
  `.vercel/upload-audits/source-Wja4Tr/manifest.json` (137 files, 9,091,915 bytes),
  asserted unchanged before deployment. The uploaded source is the local dirty
  tree atop `9011f8c`, not a committed release.
- That snapshot's smoke checks passed: health 200 (`status:ready`, `ai:ready`), signup
  200 (`enabled:false`), unsigned valid Companion request 401 (`AUTH_REQUIRED`),
  and anonymous root 302 to Vercel SSO. After mandatory isolated-profile reload,
  worker capabilities, authenticated Pro access, and consent passed. One owner
  screenshot question received a correct real-provider mitochondria answer
  (POST 200), saved two synthetic messages (POST 201), read them back (GET 200),
  and restored history after reload. The isolated browser was closed.
- Post-deploy metadata confirmed `ssoProtection:all_except_custom_domains`,
  `autoAssignCustomDomains:false`, zero bypass credentials, zero Production
  variables, and 11 Preview variables. Protected-access checks and secret scan pass.
- Read-only aggregate checks showed successful `browser_companion` ledger,
  screenshot monthly/daily counts, and global request count advancing from
  three to four, with zero provider errors. Four synthetic pairs/eight messages
  had been saved at that historical checkpoint. This does not
  test live quota exhaustion or the provider spending ceiling.
- **Historical protected smoke-tested Preview, not the current candidate:**
  https://unimate-clbphi1j3-resumejuice-s-projects.vercel.app
  (`dpl_8ZUtaDTxBK2K6jqkokV3Di8Jn2MG`, Preview, state `READY`).
  Includes the former narrow backend discount-guard correction. Source audit:
  `.vercel/upload-audits/source-yE9qcB/manifest.json` (137 files, 9,093,866 bytes).
  Recorded smoke checks passed: exact project/team and READY Preview validated;
  health 200 (`status:ready`, `ai:ready`), signup status 200 (`enabled:false`),
  valid unsigned Companion request 401 (`AUTH_REQUIRED`), and unauthenticated
  visitor 302 to Vercel SSO. No AI calls or database writes were made.
  Login protection is confirmed;
  pre-deploy metadata showed zero bypass credentials, zero Production variables,
  11 Preview variables, and `autoAssignCustomDomains:false`.
- **Distinct historical owner-verified screenshot/save Preview:**
  https://unimate-7blad7yjh-resumejuice-s-projects.vercel.app
  (`dpl_BRyCm6MqEEwpP3oToz6XmmSXFLwi`, Preview, state `READY`).
  Source audit: `.vercel/upload-audits/source-TI3kgK/manifest.json`
  (137 files, 9,091,919 bytes). Its earlier owner flow passed screenshot/real
  biology answer, save/readback, and history reload, with aggregate usage then
  three and zero provider errors. Neither historical deployment contains the
  current working tree; the later historical snapshot's separate proof is recorded above.
- Latest recorded synthetic installed-browser evidence: 28 scenarios and ten fake AI
  calls, artifact `unimate-companion-browser-VmhfWZ` in the host temporary directory.
  Coverage includes transport recovery, private
  sign-in, Free/Pro gates, capture/save recovery, clipped/shadow/frame privacy,
  accessibility-tree and reduced-motion checks, scroll/disclosure preservation,
  worker death during capture, compatible duplicate injection, and temporary
  versus rejected session refresh while an answer is pending. Same-URL
  document-mutation guards remain deterministic offline checks, not claimed as
  installed-browser scenarios.
- Full application tests, protected-preview tests, typecheck, build, Vercel build
  verification, secret scan, and lint pass, with eight preexisting lint warnings.
  These synthetic/local checks are distinct from the exact hosted proofs above.
- The current tutor policy separates authored teaching from source reporting.
  Math, hints, academic facts, and labeled practice need not repeat only visible
  numbers; fabricated page/course claims, empirical statistics, quotations,
  unseen sources, and claimed answer keys remain guarded. Offline regressions
  cover both useful answers and attribution bypasses. This is not a general
  factual-correctness guarantee or independent screenshot OCR.
- The original eleven-case live evaluation met **10/11**, under an aggregate
  4,000-completion-token ceiling. A correct discount answer triggered the old
  numeric guard. The intermediate arithmetic whitelist has now been replaced;
  the exact answer passes offline under the new policy. That historical run was
  neither changed nor rerun. The latest single biology screenshot test is not
  an eleven-case rerun or a general answer-quality guarantee.
- Text and vision truncation now produce retryable errors, never partial
  success or a hidden provider retry. The question is retained. Separate
  prompt-fidelity regressions preserve all 4,000 composer characters through
  analysis, including final instructions.
- The public-config generator rejects privileged/secret keys before writing
  configuration. Only publishable or legacy `anon` client keys belong in the
  extension; the existing project key was not changed or rotated.
- A reused profile exposed a cached old MV3 worker despite updated same-version
  files. The owner-preview runner now always reloads/reopens a resumed profile
  before supplying its memory-only short-lived token, then checks worker
  capabilities. Capability checks alone miss smaller edits. Increment the
  manifest version for each public release.
- The isolated test browser was closed after verification. Its short-lived
  preview token was injected only into browser memory, never its profile. The
  separate ignored mode-0600 CLI token file was removed after that historical check.
  The persistent automation-bypass
  secret generated by `vercel curl` was revoked; zero bypass credentials remain,
  and login protection is unchanged. Future automation should use the verified
  project-scoped OIDC helper instead of regenerating a persistent bypass.
- Historical dependency exposure assessment, superseded by the verified cleanup below: `npm audit
--omit=dev` reports zero advisories; the full audit reports seven high findings
  from one [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  The installed chain is `@lovable.dev/vite-tanstack-config@1.7.0` →
  `lovable-tagger@1.2.0` → `tailwindcss@3.4.19` → glob/watch dependencies →
  `braces@3.0.3`. The advisory lists no patched braces release. The audit's
  suggested wrapper upgrade to `2.26.7` is a major-version change, not a
  compatible transitive patch; it has not been installed or verified.
  The installed wrapper activates the tagger only for development serving,
  not a production build. The generated Vercel function lists only `tslib` as
  an external dependency; inspection found no affected package names or imports
  in its function/static artifacts. No app request path to the affected parser
  was identified. This is a scoped exposure assessment, not proof the development
  dependency is safe: do not expose the development server or process untrusted
  source/glob configuration with that historical toolchain. At that point the
  finding required a separately verified migration; it is no longer an open
  source-candidate blocker after the cleanup below. Published
  wrapper `2.7.2` is the earliest identified stable version dropping the tagger,
  but it also changes the default hosting adapter to Nitro. That wrapper upgrade
  was not used; the completed cleanup composes the plugins explicitly.
- October 14 cleanup completed in candidate commit `5a6f3a4`: removed the
  wrapper/tagger/braces chain and obsolete Bun lockfile, preserving all retained
  dependency versions, the Cloudflare default and opt-in Vercel adapter. Fresh
  npm install, full/production audits (both zero vulnerabilities), offline tests,
  typecheck, lint and both built-artifact checks passed. The local browser also
  hydrated and navigated successfully. The earlier open advisory above is cleared
  for this source candidate and the current `5694bdb` application deployment,
  not retroactively for the older hosted screenshot snapshots.
  Tests now exercise actual sandbox configuration hooks to prevent unallowlisted
  environment-file loading. No public deployment or Store publication occurred.
- The subsequent lockfile repair `fbd059f` preserved exact bundled dependency
  metadata and passed fresh npm 10.9.2 / npm 11 installs and Linux CI; see
  [the current dependency evidence](../LAUNCH.md). No runtime upgrade was needed.

Minimal reproducible checks from the repository root:

```sh
npm test
npm run typecheck
npm run lint
npm run vercel:test
node browser-companion/tests/vercel-upload-preflight.test.mjs
node scripts/vercel-upload-preflight.mjs
```

Before each authorized source upload, verify the local project link matches the
project and team above, then compare the actual uploader's dry-run manifest with
the reviewed allowlist (Vercel CLI 63.1.2):

```sh
vercel deploy --target=preview --scope resumejuice-s-projects --dry --json |
  node scripts/vercel-upload-preflight.mjs --dry-json-stdin --record
```

This dry run does not deploy. The recorded audit stays under the ignored local
`.vercel/upload-audits/` directory. The allowlist excludes local credentials,
database backups, browser profiles, extension configuration, test artifacts, and
prebuilt output; a `--prebuilt` upload requires a separate artifact audit. Re-run
the comparison after source changes. All public-launch gates in the release
decision and packaging checklist remain in force, even if the protected preview
has passed.

## Single purpose

UniMate Browser Companion is an AI study companion that answers a student's
question using the browser tab they intentionally submit as context.

This purpose covers the persistent mascot, one-shot visible-tab capture, selected
text and compact rendered-text context, UniMate account authentication, Pro
entitlement validation, and synchronized UniMate chat history. It does not cover
advertising, browsing analytics, continuous recording, LMS automation, or payment
processing.

## Permission inventory and justification

| Permission               | Why it is required                                                                                                   | Scope assessment                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                | Stores the UniMate session and the versioned privacy-consent record in this Chrome installation.                     | Required; narrower replacement unavailable.                                                                                     |
| `scripting`              | Reinjects the two packaged content scripts into eligible tabs after install/update or service-worker recovery.       | Required for the current persistent-companion recovery behavior. No remote code is executed.                                    |
| `<all_urls>` host access | Shows the companion on ordinary web pages and permits a one-shot visible-tab capture after the student presses Send. | Broad and review-sensitive, but consistent with the advertised cross-site companion. The extension should not add unused hosts. |

The extension does not request cookies, history, identity, downloads,
notifications, webRequest, clipboard, microphone, camera, or tabCapture. Chrome
blocks content scripts on internal pages, the Chrome Web Store, and some
browser-owned viewers.

An `activeTab`-only design would reduce the install warning, but would also remove
the promised persistent companion and require a toolbar gesture on each page.
That would be a product behavior change, so it is deferred rather than silently
substituted during launch polish.

## Data map for the Privacy practices form

The developer dashboard answers must match the production behavior and public
Privacy Policy exactly.

| Data category                                    | Handled                     | Purpose / behavior                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication information                       | Yes                         | The user signs in to the existing UniMate account. Session tokens remain in `chrome.storage.local` and are sent only to UniMate/Supabase endpoints over the configured transport. Never disclose tokens publicly.                              |
| Personally identifiable information              | Yes                         | Account email and user ID are used for authentication, entitlement, and chat ownership.                                                                                                                                                        |
| Website content                                  | Yes                         | After Send, a one-time visible-tab screenshot, highlighted text, and a short rendered-text sample may be transmitted to answer the request.                                                                                                    |
| Web browsing activity                            | Yes, narrowly               | The current page title and URL/domain are sent only as context for the user-facing answer after Send. They must not be used for ads or unrelated analytics.                                                                                    |
| User-generated content / personal communications | Yes                         | Prompts and chat responses are stored in the user's UniMate chat history.                                                                                                                                                                      |
| Form data                                        | Potentially visible         | Visible form labels, options, or entered content may appear in the screenshot or compact page context. Password, email, and telephone input values are excluded from DOM extraction, but screenshots can still show visible sensitive content. |
| Financial information                            | No dedicated billing inputs | The extension contains no checkout/card form. Financial information could still appear in an intentionally submitted screenshot or selection; do not claim those pixels are filtered.                                                                                 |
| Health information                               | Not intentionally collected | It could be visible on a submitted page; the public disclosure should tell users not to submit sensitive pages they do not want analyzed.                                                                                                      |
| Location, history, contacts                      | No dedicated access         | No corresponding Chrome permissions are requested.                                                                                                                                                                                             |
| Local file content                              | Optional page context       | File-page matching is declared, but Chrome requires the user to allow file access. An eligible local page can then be intentionally submitted; no directory enumeration or arbitrary file-reading API is used.                                                                 |

## In-product disclosure and consent

Before authentication or any page extraction, the panel now shows the exact data
categories used. Only **Allow and continue** stores consent. **Not now** closes
the panel and transmits nothing. Consent is versioned so a future material data
practice change can require a new decision.

The extension background worker also rejects `SEND_CHAT` unless the current consent version is stored,
which prevents a stale or modified content-script flow from bypassing the gate.
Consent is checked again before capture and before transmission. Students can
review the disclosure and pause page sharing from the panel.

The consent screen links to `/privacy` on the worker-validated `UNIMATE_API_URL`
origin. It accepts canonical public HTTPS origins (or canonical localhost HTTP
for development), never page-provided URLs. Missing/invalid configuration shows
unavailable copy rather than an unsafe link. Confirm the final production origin
serves that policy before packaging or submission; a protected Preview is not a
public legal page.

## Store listing draft

### Title

UniMate Browser Companion

### Summary (manifest description)

Ask questions about the page in front of you with UniMate's screenshot-aware AI
study companion.

### Category

Education

### Detailed description

UniMate Browser Companion is a study partner that helps you work through what is
visible in your browser.

Ask a question and UniMate captures the visible tab once, reads any text you
highlighted, and uses a small amount of visible page text to respond with a direct
answer and a brief explanation. Your conversation stays synchronized with Ask
UniMate so you can continue studying on the web app.

Key features:

- Ask for an answer, solution, explanation, or summary without copying the page.
- Use the visible screen and optional highlighted text as context.
- Continue the same selected conversation in Ask UniMate.
- Sign in with your existing UniMate account; no separate extension account.
- Capture only after you press Send—never continuous screen recording.

An active paid UniMate Pro subscription is required; usage limits apply. Billing
is managed on the UniMate website. AI answers can be wrong: check important
details and follow your institution's academic-integrity rules. This is not an
LMS integration and does not complete or submit coursework on your behalf.

Chrome restricts extensions on
internal pages, the Chrome Web Store, and some browser-owned documents.

### Screenshot plan

Use 1280x800 full-bleed PNG or JPEG screenshots with real current UI and no
student-identifying or copyrighted course content.

1. An ordinary study page with the closed mascot and open Companion panel.
2. A legible practice problem with a concise answer-first response.
3. Highlighted notes with a short explanation.
4. The chat selected in Ask UniMate and the same conversation in the extension.
5. The first-run privacy notice showing explicit Send-only capture.

Do not show passwords, tokens, real grades, student names, private LMS data, or
claims such as “unlimited” unless production limits substantiate them.

## Public Privacy Policy draft inputs

The final policy must be reviewed and published by the owner. It should state:

- who operates UniMate and how to contact the operator;
- exactly which account, prompt, chat, screenshot, selected-text, compact page
  text, title, and URL data is handled;
- that context is collected only after the student presses Send and consents;
- the purposes: authenticate, verify Pro entitlement, answer the request, and
  synchronize chat history;
- every production subprocessor receiving each category (currently Supabase and
  the configured AI/backend providers must be verified before naming them);
- retention periods for chat rows, server logs, screenshots/request bodies, and
  provider-side data;
- how a student can access or delete chats and request account/data deletion;
- security practices and HTTPS transmission;
- that data is not sold, used for personalized advertising, or reviewed by a
  human except with specific consent or for the narrow policy exceptions the
  business actually follows;
- treatment of minors, jurisdiction, effective date, and change notification;
- Chrome Web Store Limited Use compliance in language counsel approves.

Do not state that screenshots are never retained until server logs, hosting,
observability, and the AI provider's retention settings have been verified. The
source code proves only that the extension itself does not persist the screenshot.

The DOM extractor's tested exclusions follow composed-tree and geometric
viewport/overflow/frame clipping. Supplemental iframe text is conservatively
omitted when frame ancestry is transformed or zoomed. These exclusions do not
establish arbitrary visual-occlusion detection or screenshot redaction. The
explicit screenshot still captures the visible viewport, and deliberately
selected text remains submitted context.

## Terms and support requirements

Before submission, publish Terms that cover service availability, acceptable
academic use, AI limitations, account eligibility, subscription relationship,
intellectual property, termination, warranty/limitation language, governing law,
and contact details. Legal review is required.

Provide a dedicated HTTPS support URL and monitored support email. The support
page should include installation, sign-in, Pro verification, restricted-page,
capture, rate-limit, privacy, chat-deletion, and uninstall guidance. Do not use a
personal inbox or an unmonitored placeholder.

The owner supplied the dedicated `unimatesupport@gmail.com` inbox on October 13,
2026. The contact-link update is included in the current Preview's source, but
public-domain availability and incoming/reply mail delivery still need confirmation.

## Asset and audio review

Only the mascot and packaged icon PNGs are part of the extension. The study audio
files and `public/audio/ATTRIBUTION.md` belong to the web app and should not be
included in the extension ZIP. Preserve the audio attribution file with the web
release and verify that every attribution and source URL matches the exact binary
shipped.

The extension icon files are mechanically derived from UniMate's current logo and
are declared at 16, 32, 48, and 128 pixels. Confirm brand ownership before store
submission.

| Packaged asset | Repository evidence | Owner approval still required |
| --- | --- | --- |
| `assets/mascot.png` | Tracked with the Companion; the other mascot variants are excluded from the ZIP. | Original creator/source, license or ownership, and permission to redistribute commercially. |
| `assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` | PNG dimensions are checked; the current logo source is `public/assets/unimate-logo-head.png`. | Rights to the source logo and derived icons; record any required attribution. |

Git history and successful PNG checks establish which files ship, not licensing
rights. No rights were inferred or new assets generated in this audit. Store
screenshots/tile are still pending and must use synthetic, authorized coursework.

### Owner privacy sign-off before upload

- [ ] Approve the publisher/operator identity and the listing's paid-Pro wording.
- [ ] Check the published policy against the data map above, including incidental
      sensitive screenshots, optional file pages, account data and saved chats.
- [ ] Record actual production subprocessors, retention/logging settings and the
      account/data-deletion response process; test the support inbox end to end.
- [ ] Complete the Store privacy disclosures and reviewer access instructions
      without including credentials in this repository or in public listing copy.
- [ ] Reconcile the listing, public policy and in-product consent before approval.

## Packaging checklist

- [ ] Run `npm run companion:configure` with the production HTTPS UniMate origin.
- [ ] Confirm `COMPANION_DEBUG` is `false` without printing keys or tokens.
- [ ] Confirm no `localhost`, placeholder project, test credential, service-role
      key, report, fixture, source screenshot, `.DS_Store`, or unrelated asset is
      in the ZIP.
- [ ] Include only `manifest.json`, `background.js`, `content.js`,
      `context-extractor.js`, `signin.html`, `signin.js`, `signin.css`, generated
      `config.local.js`, `assets/mascot.png`, and `assets/icons/*.png`.
- [ ] Run `npm run companion:package`. It runs the V2 verification suite and
      secret scan before creating the archive, rejects local/non-HTTPS origins,
      IP/internal/placeholder hosts, invalid Chrome versions, debug mode,
      secret-like configuration, symbolic-link inputs and forbidden archive entries.
      These are offline checks, not proof of DNS/TLS, public access, asset rights
      or live service readiness. Do not package the protected Preview for students.
- [ ] Extract the validated ZIP into a fresh local directory, load that exact
      directory unpacked and complete the manual launch tests. The packager's
      temporary staging directory is removed automatically.
- [ ] Verify the manifest version is higher than any package already uploaded.
- [ ] Inspect the final archive file list and scan it for secrets before upload.
- [ ] Confirm `manifest.json` is at the ZIP root, without a containing directory.
      The packager validates its allow-listed entries and preserves the previous
      release archive if a replacement fails validation. Automated packaging
      tests use synthetic public configuration, never real credentials.
- [ ] Upload privately/unlisted first if that matches the launch plan; do not
      publish until privacy, support, listing, and smoke-test blockers are closed.

## Current official references

Version, listing and disclosure guidance rechecked October 14, 2026. These links
support the requirements; a passing local test is not Store approval.

- [Chrome manifest version rules](https://developer.chrome.com/docs/extensions/reference/manifest/version)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [User Data FAQ and Limited Use](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)
- [Create a quality listing](https://developer.chrome.com/docs/webstore/best-listing)
- [Complete listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Prepare an extension package](https://developer.chrome.com/docs/webstore/prepare)
