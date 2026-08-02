# UniMate Browser Companion V1 — Delivery Report

## Completed

- Chrome Manifest V3 extension under `browser-companion/`.
- Floating yellow UniMate mascot injected at `document_start` on supported web
  pages and reattached if a site replaces the document root.
- Cream (`#FAF7F2`) and yellow (`#F5C518`) chat panel isolated in a closed
  Shadow DOM so host-page styles do not leak into it.
- Existing UniMate Supabase accounts only: email/password sign-in creates no
  new account, tokens refresh in the background worker, `/auth/v1/user`
  validates the session, and `profiles.is_pro` is checked before reading or
  sending chat.
- Highlighted text is included passively as highest-priority context, followed
  by nearby headings and structured rendered/accessibility text. No
  highlight-triggered explain workflow exists.
- Screenshot capture and the existing `/api/analyze-screenshot` route are used
  after Send when text is empty, short, prompt-mismatched, frame-restricted, or
  visually dependent, or when the manual screen-analysis button is clicked.
- Normal text requests use the existing Groq-backed `/api/dashboard-ai`
  endpoint. The extension contains no Groq key and adds no AI API.
- User and assistant messages are inserted into `companion_chats`; provided SQL
  creates the exact requested fields, ownership index, grants, and RLS policies.
- The `companion_chats` migration was applied to the connected UniMate Supabase
  project and verified with RLS plus owner-only SELECT/INSERT policies enabled.
- Development configuration script, unpacked-extension instructions,
  architecture notes, exclusions, V2 list, and risk documentation.

## Explicitly excluded

Stripe, billing UI, flashcards, Canvas functionality, and highlight-to-explain
are not included.

## Remaining before production

- Configure the deployed API origin and reload the unpacked extension.
- Exercise authentication and both AI paths against a real Pro test user.
- Add packaged PNG icon sizes, store listing/privacy copy, automated browser
  tests, and complete Chrome Web Store review.
- Consider a website-to-extension session handoff in V2 so users do not need to
  enter the same UniMate credentials once in the extension.

## Technical risks

- Chrome does not permit content scripts on `chrome://` pages, the Chrome Web
  Store, and certain browser-owned documents.
- DOM cannot literally persist across a full navigation. `document_start`
  reinjection minimizes the transition but cannot eliminate Chrome's
  document-replacement boundary.
- `<all_urls>` is powerful and may slow store review. Visible page text can be
  sensitive even though the extension never reads password/form values.
- Pro is checked against `profiles.is_pro` before every extension chat, but the
  reused dashboard AI route remains callable by any authenticated UniMate user
  because it also serves the main dashboard. Endpoint-level Pro enforcement
  would require a dedicated or changed backend contract in V2.
- Screenshot fallback captures the visible viewport and should remain clearly
  disclosed.
- The requested table shape has no conversation/page identifier, so recent
  history is global across sites in V1.
- Direct Supabase Data API access depends on the migration, authenticated
  grants, and RLS remaining deployed and correct.
