# UniMate launch incident runbook

Reviewed: August 12, 2026

Use this during launch when authentication, billing, AI, data, or the Browser
Companion behaves unexpectedly. Never paste student prompts, screenshots, page
text, passwords, tokens, or payment data into logs, tickets, or this document.

## First five minutes

1. Record the time, affected surface, categorical error, and release commit.
2. Protect student data and credentials before restoring convenience.
3. Stop unbounded AI spend or duplicate billing before investigating secondary
   symptoms.
4. Keep non-AI features available when possible.
5. Post a short factual update through the launch status/support channel.

## Severity

- **SEV-1:** data exposure, credential leak, incorrect charges, broad auth outage,
  irreversible data loss, or uncontrolled provider spend. Pause promotion and
  affected functionality immediately.
- **SEV-2:** major feature unavailable to many users, repeated payment/entitlement
  mismatch, or sustained elevated 5xx/429 rate. Pause promotion and mitigate.
- **SEV-3:** isolated errors with a workaround and no security, billing, or data
  impact. Track, communicate when needed, and repair normally.

## Safe containment

### AI or provider incident

- Set `AI_SYSTEM_MODE=degraded` to disable optional screenshot/search paths first.
- Set `AI_SYSTEM_MODE=off` if cost, provider instability, or data handling is
  uncertain. Dashboard, timeline, notes, and authentication must remain usable.
- Disable screenshot and search independently with their feature switches when
  only one path is affected.
- Do not repeatedly retry a failing provider or raise quotas during an incident.

### Billing or entitlement incident

- Keep Stripe live-mode activation disabled unless it was explicitly approved.
- Do not manually mark arbitrary users Pro as a substitute for webhook recovery.
- Preserve Stripe event IDs and categorical state; never copy card data.
- If duplicate or incorrect charges are possible, stop new checkout, keep account
  access conservative, and reconcile signed events before issuing a refund.

### Authentication incident

- Pause public promotion. If signup abuse or a signup defect is involved, disable
  signup in both UniMate and Supabase Auth; the website switch alone is not a
  complete boundary.
- Do not clear sessions globally unless account compromise requires it.
- Verify Supabase status, redirect origins, email delivery, and server clock before
  changing auth code.

### Database or migration incident

- Stop the affected write path. Do not rerun a partially applied migration blindly.
- Preserve the ordered migration history and database logs without student data.
- Use the reviewed rollback only after confirming it will not delete newer data.
- Restore into a non-production project first when recovery is uncertain.

### Browser Companion incident

- Remove or pause the Store listing/update if the packaged extension exposes data,
  points to the wrong origin, or fails entitlement checks.
- Keep the web app available. Ask affected users to disable the extension only when
  necessary; do not request screenshots containing private coursework.
- Record the extension version, Chrome version, URL category, and categorical error.

## Communication template

> We are investigating an issue affecting [surface]. [Unaffected surfaces] remain
> available. We paused [promotion/AI/checkout] while we verify the fix. Next update:
> [time]. Do not send passwords, payment details, or private coursework to support.

## Recovery and closure

1. Reproduce with synthetic/test data.
2. Verify the mitigation using the relevant automated suite and a manual smoke test.
3. Restore traffic gradually; do not launch every promotion channel simultaneously.
4. Confirm alerts, spend, error rate, billing state, and data integrity remain normal.
5. Record the root cause, affected interval, user impact, corrective action, and
   prevention item without including private student content.
6. Only the launch owner may close a SEV-1 or resume live billing.

## Required external preparation

This file does not create monitoring or a public status channel. Before launch,
assign an incident owner and backup, verify the support mailbox, configure alert
destinations, confirm provider support paths, and test the status message workflow.
