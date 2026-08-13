import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "../components/legal-page";

export const Route = createFileRoute("/support")({ component: Support });

function Support() {
  return (
    <LegalPage
      eyebrow="Support"
      title="How can we help?"
      summary="Start with the relevant steps below. If the problem continues, email UniMate with the page and a short description—never send passwords, payment details, or private course content."
    >
      <LegalSection title="Account access">
        <p>
          Confirm your email before signing in. Use the password-reset link on the Sign In page if
          needed. Signing out of UniMate also signals the Browser Companion to clear its session.
        </p>
      </LegalSection>

      <LegalSection title="Browser Companion">
        <p>
          Companion AI requires Pro. Open Settings or Browser Companion Setup, install from the
          verified Chrome Web Store listing, and sign in with the same UniMate account. Chrome
          blocks extensions on internal pages, the Chrome Web Store, and some embedded documents.
        </p>
        <Link to="/companion-setup" className="inline-block underline underline-offset-4">
          Open Browser Companion setup
        </Link>
      </LegalSection>

      <LegalSection title="Screen and page context">
        <p>
          UniMate captures the visible tab only after you press Send and consent. Highlighting text
          can improve context. If Chrome prevents capture, move to a normal webpage and try again.
          Never submit sensitive pages you do not want analyzed.
        </p>
      </LegalSection>

      <LegalSection title="Billing">
        <p>
          Checkout and subscription management are hosted by Stripe. Use Manage Billing from the Pro
          page to update payment information or cancel. If access does not update after payment,
          return to UniMate and refresh once before contacting support.
        </p>
      </LegalSection>

      <LegalSection title="Chats and data">
        <p>
          Ask UniMate lets you create, select, and delete chats. “Use in browser” selects the chat
          shown in the installed Companion; it does not install the extension. Contact support to
          request account or data deletion.
        </p>
      </LegalSection>

      <LegalSection title="Contact support">
        <p>
          Email{" "}
          <a className="underline underline-offset-4" href="mailto:support@unimate.site">
            support@unimate.site
          </a>
          . Include your browser, the UniMate page, when the problem occurred, and the visible error
          wording. Do not include passwords, authentication tokens, full payment details, or private
          student content.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
