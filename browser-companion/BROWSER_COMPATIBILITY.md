# UniMate Companion — browser compatibility plan

Audit: October 16, 2026, source checkpoint `89f0635` plus concurrent private
readiness work. This is an implementation/test plan, **not a support claim**.
Brave was installed with owner approval; Edge installation failed for lack of
disk space. No store package was uploaded or service made public. The owner then
stopped further cross-browser testing. The website working in a browser does not
prove its extension works there.

## What is known

| Desktop browser   | Evidence / present status                                                                                                                                                                                                 | Distribution after owner approval                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome / Chromium | Installed Chromium evidence exists: 30 synthetic scenarios at `b89154f`, plus separately recorded private hosted checks. This is not an all-OS or minimum-version certification.                                          | Chrome Web Store listing is still gated; unpacked private testing continues.                                                                   |
| Edge              | **Not tested.** Owner-approved installation failed because the Mac ran out of disk space; no installed app was found afterward.                                                                                           | Existing CWS listing can serve Edge; native Edge Add-ons listing is a separate optional submission.                                            |
| Brave             | **Not a passing target.** The installed run passed 12 scenarios, then failed the small-window coursework-scroll isolation assertion. Further browser testing stopped at the owner's request.                              | Same CWS listing; do not advertise verified support or weaken default privacy/security settings.                                               |
| Opera GX          | **30 installed synthetic scenarios passed** on macOS, Opera GX 136.0 / Chromium 152.0.7977.120. Hosted billing/AI and Store installation remain unverified in this browser. Ordinary Opera is a separate untested target. | Same CWS listing initially; native Opera Add-ons is separate. Use current “Add to Opera” instructions, not an old helper-extension workaround. |
| Firefox           | **Not currently supported by this package.** Its service-worker-only background cannot start as configured; loader, storage isolation, and capture compatibility need a dedicated port.                                   | Mozilla signing required for normal release/beta installation; AMO listing or signed self-distribution.                                        |
| Safari            | **Not tested or packaged.** A Safari-specific build and security/behavior review are needed; the Chromium ZIP alone is not a Safari release.                                                                              | Apple packaging/signing/review track, via the Xcode converter or the Safari Web Extension Packager in App Store Connect.                       |

Platform references: [Edge porting](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension),
[Edge installation](https://support.microsoft.com/en-us/edge/add-turn-off-or-remove-extensions-in-microsoft-edge),
[Brave installation](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave),
[Opera extension platform](https://help.opera.com/en/extensions/),
[Opera installation FAQ](https://help.opera.com/en/faq/),
[Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/),
[Apple packaging options](https://developer.apple.com/safari/extensions/).

Existing proof is recorded in [Chrome readiness](CHROME_WEB_STORE_READINESS.md)
and [launch evidence](../LAUNCH.md). Chrome and Safari application bundles were
found at their standard `/Applications` paths. `/Applications/Opera GX.app`
was also found (bundle version 136.0, executable `Contents/MacOS/Opera`).
Brave was subsequently installed at `/Applications/Brave Browser.app`; Edge,
standard Opera, and Firefox were not found at the standard names checked. That
does not rule out other locations. Presence alone is not a successful test. Mobile browsers,
incognito, managed school devices, and older versions have no support claim yet.

## Concrete implementation gates

1. **Background startup.** `manifest.json` has only
   `background.service_worker`; `background.js` immediately calls
   `importScripts("config.local.js")`. Firefox requires a background script/page
   instead. Generate a separate Firefox manifest and load configuration before
   its background entry; merely adding `background.scripts` leaves the
   worker-only loader broken. Safari supports both background models, but its
   chosen lifecycle must be tested. Do not change the existing Chromium target
   into a mixed manifest without testing older supported Chromium versions.
   [Background compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

2. **Token isolation must remain real.** The worker stores session tokens in
   `storage.local`, requests `TRUSTED_CONTEXTS` through optional
   `setAccessLevel`, and currently ignores rejection. Unsupported is not
   equivalent to protected. Mozilla's compatibility data reports no Firefox
   implementation and Safari support only for `storage.session`. A port needs
   an equivalent background-only credential store or a deliberate capability
   gate before sign-in. Content-script access is the concern; this does not
   mean arbitrary webpages can directly read extension storage.
   [Storage compatibility data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/storage.json),
   [Chrome storage access](https://developer.chrome.com/docs/extensions/reference/api/storage).
   Chrome's own method reference says 102+, while Mozilla's data has differing
   storage-area version history. Verify the actual local-area restriction in
   each target browser; do not infer a new minimum version from that discrepancy.
   [Chrome method reference](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea).

3. **Keep browser-owned document identity.** Capture requires a top-frame
   `sender.documentId`, a matching `executeScript` result, and document-targeted
   messages, plus active-tab/window checks. Current compatibility data records
   these document-ID APIs at Chromium 106, Firefox 153, and Safari 18.4. These
   are documented API availability, not tested UniMate version guarantees.
   Older/missing capabilities must continue to fail closed; a URL-only fallback
   would weaken same-URL reload/navigation protection. Safari does support
   `captureVisibleTab`; do not mislabel that API as absent.
   [Message sender](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/runtime.json),
   [script results](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/scripting.json),
   [tab APIs](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/tabs.json).

4. **Resource URLs and worker recovery.** `use_dynamic_url` is not supported by
   Firefox; Safari already uses a dynamic extension base URL. Generate
   browser-specific manifests and verify `runtime.getURL` mascot/sign-in URLs.
   Missing `storage.session` currently skips the request journal rather than
   preventing startup: test save/retry/worker-restoration behavior and quota,
   not just the initial response. Do not add permissions to solve a copy issue.
   [Resource compatibility](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/manifest/web_accessible_resources.json),
   [session storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session).

5. **Installation language and destination validation.**
   `src/routes/companion-setup.tsx` still says “Install the Chrome extension” and
   “Add to Chrome.” Use browser-neutral or browser-specific instructions only
   for the verified support set, and a clear unsupported-browser state for
   other engines. `src/lib/companion-store.ts` intentionally permits only CWS
   listing URLs; that can serve phase-one Chromium browsers. Native Edge,
   Firefox, or Apple listings need explicit additional provider allowlists,
   not unrestricted external URLs. Keep Pro checks unchanged. A separate
   concurrent change is addressing restricted-page wording; wording tests do
   not certify any browser.

## Installed Opera GX evidence — October 16, 2026

The full isolated suite passed 30 scenarios with ten synthetic AI responses.
It exercised the actual installed extension: consent, secure sign-in, Free/Pro
transitions, revocation and reactivation, screenshot capture, saved history,
worker termination, auth 429/503 recovery, keyboard/zoom, and restricted pages.
All services were local fakes; this is not a real Stripe or AI-provider result.
The browser and fixture server exited successfully. The normal Opera profile
was not used. The answer screenshot was visually checked.

Runtime: Opera GX 136.0, CDP `Chrome/152.0.7977.120`, JavaScript `15.2.124.27`,
headless macOS. Artifact directory: `unimate-companion-browser-qS5r3D` in the
host temporary directory. Twelve shipped source/asset files, excluding generated
synthetic configuration, were byte-compared with the working tree and matched;
their ordered file/hash digest is
`0fab44f000d5854ec5140b51d8f92ac710d428d897452be2b4a02afc76936d48`.
This is not all-platform, minimum-version, Store-installation, normal-profile,
or managed-school-device certification.

## Brave attempt and owner stop — October 16, 2026

The owner approved installing Edge and Brave without importing personal data,
signing into browser accounts, or making either the default. Homebrew installed
Brave; Edge extraction failed with `No space left on device` and left no Edge
application at its intended path. No personal files were deleted. About 700 MiB
remained free, so the hosted billing recovery continuation was also held before
payment to avoid starting a multi-process test with unreliable write capacity.
Subsequent owner-approved cleanup reclaimed 6.8 GiB from only npm's regenerable
`_cacache` download cache, leaving 7.9 GiB free and clearing that storage hold.
Projects, personal files, installed apps, browser profiles, `_npx`, and Playwright
were preserved. This does not change the owner's stop on additional browser
testing or certify hosted billing recovery; see [the current billing outcome](../LAUNCH.md).

Brave bundle version `155.1.97.56` / build `197.56` passed macOS Gatekeeper
(`Notarized Developer ID`) and ordinary recursive code-signature verification,
signed by Brave Software, Inc. Strict verification separately rejected existing
Finder metadata in embedded resources; no quarantine or attributes were removed.
The browser launched normally without a security override in a fresh temporary
profile. Runtime: `Chrome/155.0.8059.40`, JavaScript `15.5.35.20`.

Artifact: `unimate-companion-browser-y5Npf2` in the host temporary directory.
Twelve synthetic scenarios passed, including Free/Pro transitions, revocation,
capture/reply, keyboard access, history and unsaved-answer retention. The next
small-window check failed: coursework `scrollY` changed from 0 to 237 while
testing Companion scrolling. `failure.png` preserves the observed state. This
does not yet distinguish a product scroll-isolation defect from test positioning
or layout timing; do not suppress the assertion or report a full pass. The run
exited, using no real payments, AI, personal accounts or browsing profiles.

The owner then explicitly requested no further browser testing. Edge retry,
Brave reproduction and additional browser targets are deferred; no new browser
installation or test is planned without renewed direction.

## Recommended next steps

The synthetic runner accepts only `COMPANION_TEST_BROWSER=chromium` (default),
`opera-gx`, `edge`, or `brave`, pinning the reviewed installed executable paths;
it does not download a browser. All choices create fresh temporary profiles, use synthetic local service settings, and
retain the existing local-origin request guard. Arbitrary executable/profile
overrides and command-line arguments are rejected. Screenshots keep their
existing filenames; `browser.json` and the run result record the selected
browser plus its actual CDP product/version and user-agent string. The offline
policy checks are separate from the completed installed Opera GX run above.

For the operator's approved installed run, use
`COMPANION_TEST_BROWSER=opera-gx npm run companion:test:browser`, with the
existing installed Playwright module/runtime selection if needed. Playwright
warns that alternate executables are not guaranteed compatible; a launch failure
is evidence to investigate, not permission to reuse a personal profile, install
a browser, or weaken capture isolation.
[Playwright persistent launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

**Phase 1: current stable desktop Chromium browsers.** Reuse one package and
finish Opera GX hosted/install checks, then test Edge and Brave in disposable profiles. Record browser
version, OS, installed package/source hash, artifact paths, and results for each:

- Consent before collection; visible Send-triggered capture only; restricted
  pages/file access fail with helpful guidance and no extra permissions.
- Secure sign-in, content-script token isolation, same-account history, logout,
  and cross-account separation.
- Free denied → sandbox purchase unlocks the same panel → period-end cancel
  keeps access until expiry → expiry/immediate cancellation revokes as intended.
- Screenshot/selection/context on fictional coursework; navigation, same-URL
  reload, tab/window switch, and capture failure cannot share a different page.
- Helpful grounded response, readable source links, save/readback/reload,
  worker suspension, auth 429/503 recovery, and safe explicit retry.
- Default browser privacy settings, zoom/keyboard behavior, and installation
  instructions. Use mocked services first; hosted tests remain private and
  sandbox-only under the existing approvals.

**Phase 2: Firefox and Safari ports.** Resolve gates above, add target-specific
packaging checks and installed end-to-end coverage, then separately approve
distribution. Do not promise a port date or list these as supported beforehand.

These are deferred engineering checks, not an active testing plan after the
owner's stop request. Later owner decisions include which actually verified
browsers/OS versions to advertise; whether native secondary-store
listings are worth maintaining; and separate approval for account registration,
terms, fees, uploads, or release. No such action is authorized by this document.
Next cross-browser checks are the Opera GX hosted/install flow and installed
Edge/Brave flows; repeating the Chromium-only package test does not prove those.
