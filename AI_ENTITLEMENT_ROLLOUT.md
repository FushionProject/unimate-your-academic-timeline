# AI entitlement rollout

Status: code review only. Root `SUPABASE_USAGE_MIGRATION.sql` is step 1 and
`supabase/ai_usage_entitlements.sql` is step 2. Both must pass staging review and
be applied in that order before enforcement is enabled. No Supabase project or
Stripe state changed.

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

Rollback step 2 with `supabase/ai_usage_entitlements_rollback.sql` only after AI
is paused and `AI_DURABLE_ENTITLEMENTS_ENABLED=false`. The rollback destroys
product allowance history, so export counts first if they are needed for support.

`SIGNUPS_ENABLED=false` pauses the website signup UI only. For a true emergency
pause, disable new registrations in Supabase Auth as well; otherwise the public
Auth endpoint remains directly callable.
