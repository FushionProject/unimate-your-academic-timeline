import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";

export function useIsPro(options?: { refetchInterval?: number | false }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    refetchInterval: options?.refetchInterval ?? false,
    queryFn: async (): Promise<boolean> => {
      if (!supabase) return false;
      const { data, error } = await supabase.from("profiles").select("is_pro").single();
      if (error) throw error;
      return data?.is_pro === true;
    },
  });
}
