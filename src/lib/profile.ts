import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth-context";

export type BillingState =
  | "free"
  | "active"
  | "trialing"
  | "past_due"
  | "canceling"
  | "canceled"
  | "unpaid"
  | "paused"
  | "incomplete"
  | "development_override"
  | "legacy"
  | "not_configured";

export interface BillingStatus {
  isPro: boolean;
  state: BillingState;
  canManage: boolean;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number | null;
  temporarilyUnavailable?: boolean;
}

export function useBillingStatus(options?: { refetchInterval?: number | false }) {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["billing-status", user?.id],
    enabled: Boolean(user && session?.access_token),
    refetchInterval: options?.refetchInterval ?? false,
    queryFn: async (): Promise<BillingStatus> => {
      const response = await fetch("/api/billing-status", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const data = (await response.json()) as BillingStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || "Billing status is temporarily unavailable.");
      return data;
    },
  });
}

export function useIsPro(options?: { refetchInterval?: number | false }) {
  const query = useBillingStatus(options);
  return { ...query, data: query.data?.isPro ?? false };
}
