-- REVIEW ONLY. Apply manually after staging verification.
-- Prevent one Stripe customer from being bound to more than one UniMate user.
create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;
