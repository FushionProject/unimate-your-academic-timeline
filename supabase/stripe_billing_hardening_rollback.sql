-- REVIEW ONLY. Removes the Stripe customer uniqueness constraint.
drop index if exists public.profiles_stripe_customer_id_unique;
