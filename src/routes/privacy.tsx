import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "../components/legal-page";

export const Route = createFileRoute("/privacy")({ component: Privacy });

function Privacy() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="UniMate Privacy Policy"
      summary="This policy explains what UniMate handles when you use the website and Browser Companion, why it is needed, and the choices available to you."
    >
      <LegalSection title="Information you provide">
        <p>
          UniMate handles account information such as your email address and user ID, syllabi and
          course information you upload, notes and deadlines you save, prompts you submit, and chat
          messages generated in response.
        </p>
      </LegalSection>

      <LegalSection title="Browser Companion context">
        <p>
          After you give consent and press Send, the Companion may submit a one-time screenshot of
          the visible tab, highlighted text, a short visible-text sample, the page title and URL,
          and your prompt. It does not continuously record your screen. Visible forms or sensitive
          information may appear in a screenshot, so do not submit pages you do not want analyzed.
        </p>
      </LegalSection>

      <LegalSection title="How information is used">
        <p>
          We use information to authenticate you, verify plan access, provide the requested study
          tools and AI responses, synchronize conversation history, protect the service, enforce
          usage limits, diagnose failures, and provide support. UniMate does not sell student data
          or use submitted academic content for personalized advertising.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>
          UniMate uses service providers for authentication and data storage, hosting, payments, and
          AI processing. Stripe hosts payment collection, so UniMate does not receive your full card
          details. Information is shared only as needed to operate the requested feature, secure the
          service, or comply with law.
        </p>
      </LegalSection>

      <LegalSection title="Storage and retention">
        <p>
          Saved courses, notes, deadlines, and chat messages remain associated with your account
          until you delete them or request account deletion, subject to backups, fraud prevention,
          legal obligations, and provider retention settings. The extension does not store visible
          screenshots as files in Chrome. Operational logs are designed not to contain prompts,
          screenshots, authentication tokens, or page text.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can decline Companion screen access, delete individual chats, uninstall the extension,
          cancel Pro through Stripe's hosted billing portal, or request access, correction, or
          deletion of your account data. Browser permissions can also be managed in Chrome.
        </p>
      </LegalSection>

      <LegalSection title="Security, eligibility, and changes">
        <p>
          UniMate uses access controls and encrypted network transport, but no online service can
          guarantee absolute security. UniMate is intended for college students and is not directed
          to children under 13. We may update this policy as the product or legal requirements
          change and will update the effective date when we do.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Privacy and account-data requests can be sent to{" "}
          <a className="underline underline-offset-4" href="mailto:support@unimate.site">
            support@unimate.site
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
