import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "../components/legal-page";

export const Route = createFileRoute("/terms")({ component: Terms });

function Terms() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="UniMate Terms of Service"
      summary="These terms govern access to UniMate's website, subscription, AI tools, and Browser Companion. By using UniMate, you agree to them."
    >
      <LegalSection title="Using UniMate">
        <p>
          You must provide accurate account information, keep your credentials secure, and use the
          service lawfully. You are responsible for the material you upload and for confirming that
          you have permission to process it.
        </p>
      </LegalSection>

      <LegalSection title="Academic use and AI limitations">
        <p>
          UniMate is a study and organization aid, not a substitute for your professor, institution,
          or independent judgment. AI responses and syllabus extraction can be incomplete or wrong.
          Review dates, calculations, citations, and answers before relying on them. You must follow
          your school's academic-integrity rules and may not use UniMate to cheat or misrepresent
          work as your own.
        </p>
      </LegalSection>

      <LegalSection title="Free and Pro access">
        <p>
          Free access includes the features and limits shown on the current Pricing page. UniMate
          Pro is a recurring subscription billed through Stripe. Prices, taxes, renewal timing, and
          included usage are shown before purchase. Usage is subject to documented fair-use and
          capacity limits; UniMate does not promise unlimited AI access.
        </p>
      </LegalSection>

      <LegalSection title="Renewal, cancellation, and refunds">
        <p>
          Pro renews automatically until canceled. You may manage or cancel through Stripe's hosted
          Customer Portal. A cancellation scheduled for period end normally keeps access through the
          paid period. Refund requests are reviewed according to applicable law and the facts of the
          purchase; canceling does not automatically create a refund.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Do not abuse rate limits, automate unauthorized requests, probe or bypass security,
          interfere with other users, upload malware, violate intellectual-property or privacy
          rights, share paid access outside your account, or use UniMate for unlawful activity. We
          may suspend access to protect users, providers, and the service.
        </p>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          Features may be changed, limited, interrupted, or discontinued. Provider outages and
          browser restrictions can affect AI and extension availability while non-AI features remain
          accessible. We may update these terms and will post the revised effective date.
        </p>
      </LegalSection>

      <LegalSection title="Ownership">
        <p>
          UniMate and its product materials are protected by applicable intellectual-property law.
          You retain rights in content you provide and grant UniMate the limited permission needed
          to process it for the service you request.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and responsibility">
        <p>
          UniMate is provided on an “as is” and “as available” basis to the extent permitted by law.
          We do not guarantee grades, academic outcomes, uninterrupted availability, or error-free
          AI responses. Nothing in these terms excludes rights or liability that cannot legally be
          excluded.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions, billing concerns, or notices can be sent to{" "}
          <a className="underline underline-offset-4" href="mailto:support@unimate.site">
            support@unimate.site
          </a>
          . These terms should receive owner and legal review before public launch.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
