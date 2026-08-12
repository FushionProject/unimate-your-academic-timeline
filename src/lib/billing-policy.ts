export type StripeSubscriptionState = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
};

export function stripeStateEntitled(status: string, pastDueGrace = true): boolean {
  if (status === "active" || status === "trialing") return true;
  return status === "past_due" && pastDueGrace;
}

export function selectPreferredSubscription<T extends StripeSubscriptionState>(
  subscriptions: T[],
): T | null {
  const rank = ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"];
  return (
    [...subscriptions].sort((left, right) => {
      const leftRank = rank.indexOf(left.status);
      const rightRank = rank.indexOf(right.status);
      return (leftRank < 0 ? rank.length : leftRank) - (rightRank < 0 ? rank.length : rightRank);
    })[0] || null
  );
}
