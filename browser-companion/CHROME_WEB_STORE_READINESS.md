# UniMate Browser Companion — Chrome Web Store readiness

Status reviewed: August 1, 2026. This is a local readiness package only. Nothing
was uploaded, submitted, purchased, or published.

## Release decision

**Not ready to submit yet.** The extension package now has the required manifest
icons and an in-product, affirmative privacy-consent gate. The remaining blockers
are operational/legal items that cannot be truthfully completed in source code:

1. Publish a public Privacy Policy URL and Terms URL owned by UniMate.
2. Confirm the legal entity/developer name, support email, data-retention periods,
   subprocessors, deletion process, and the AI provider's launch-environment data
   terms with the product owner or counsel.
3. Configure a production HTTPS `UNIMATE_API_URL`; the local generated config
   currently points to `http://localhost:8080` and must never be packaged for the
   store.
4. Create current 1280x800 store screenshots from the production-configured
   extension and provide a 440x280 promotional tile.
5. Provide a real install URL and a clear Pro post-purchase installation flow.
   The current Pro page advertises the extension but has no installation action.
6. Confirm ownership and release rights for `assets/mascot.png` and the logo used
   for extension icons. Keep written provenance with the release record.
7. Complete a manual installed-extension test against production auth, Pro
   entitlement, HTTPS backend, restricted pages, and account sign-out.

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
| Financial information                            | No extension collection     | The extension contains no checkout or billing flow.                                                                                                                                                                                            |
| Health information                               | Not intentionally collected | It could be visible on a submitted page; the public disclosure should tell users not to submit sensitive pages they do not want analyzed.                                                                                                      |
| Location, history, contacts, files               | No dedicated access         | No corresponding Chrome permissions are requested.                                                                                                                                                                                             |

## In-product disclosure and consent

Before authentication or any page extraction, the panel now shows the exact data
categories used. Only **Allow and continue** stores consent. **Not now** closes
the panel and transmits nothing. Consent is versioned so a future material data
practice change can require a new decision.

The backend also rejects `SEND_CHAT` unless the current consent version is stored,
which prevents a stale or modified content-script flow from bypassing the gate.

Before launch, add a working Privacy Policy link to this consent screen once the
public URL exists. Do not insert a placeholder or dead link in the release build.

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

An active UniMate Pro profile is required. Chrome restricts extensions on
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

## Terms and support requirements

Before submission, publish Terms that cover service availability, acceptable
academic use, AI limitations, account eligibility, subscription relationship,
intellectual property, termination, warranty/limitation language, governing law,
and contact details. Legal review is required.

Provide a dedicated HTTPS support URL and monitored support email. The support
page should include installation, sign-in, Pro verification, restricted-page,
capture, rate-limit, privacy, chat-deletion, and uninstall guidance. Do not use a
personal inbox or an unmonitored placeholder.

## Asset and audio review

Only the mascot and packaged icon PNGs are part of the extension. The study audio
files and `public/audio/ATTRIBUTION.md` belong to the web app and should not be
included in the extension ZIP. Preserve the audio attribution file with the web
release and verify that every attribution and source URL matches the exact binary
shipped.

The extension icon files are mechanically derived from UniMate's current logo and
are declared at 16, 32, 48, and 128 pixels. Confirm brand ownership before store
submission.

## Packaging checklist

- [ ] Run `npm run companion:configure` with the production HTTPS UniMate origin.
- [ ] Confirm `COMPANION_DEBUG` is `false` without printing keys or tokens.
- [ ] Confirm no `localhost`, placeholder project, test credential, service-role
      key, report, fixture, source screenshot, `.DS_Store`, or unrelated asset is
      in the ZIP.
- [ ] Include only `manifest.json`, `background.js`, `content.js`,
      `context-extractor.js`, generated `config.local.js`, `assets/mascot.png`,
      and `assets/icons/*.png`.
- [ ] Run `npm run companion:check`, `npm run companion:test`, and the repeated
      runtime suite before creating the archive.
- [ ] Load the exact unpacked staging directory that will be zipped and complete
      the manual launch tests.
- [ ] Verify the manifest version is higher than any package already uploaded.
- [ ] Inspect the final archive file list and scan it for secrets before upload.
- [ ] Upload privately/unlisted first if that matches the launch plan; do not
      publish until privacy, support, listing, and smoke-test blockers are closed.

## Current official references

- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [User Data FAQ and Limited Use](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)
- [Create a quality listing](https://developer.chrome.com/docs/webstore/best-listing)
- [Complete listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Prepare an extension package](https://developer.chrome.com/docs/webstore/prepare)
