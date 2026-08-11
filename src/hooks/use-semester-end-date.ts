import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { supabase } from "../lib/supabase";
import { normalizeSemesterEndDate, SEMESTER_END_DATE_METADATA_KEY } from "../lib/semester-date";

const SEMESTER_END_DATE_CHANGED_EVENT = "unimate-semester-end-date-changed";

export function useSemesterEndDate() {
  const { user } = useAuth();
  const metadataDate = normalizeSemesterEndDate(
    user?.user_metadata?.[SEMESTER_END_DATE_METADATA_KEY],
  );
  const [semesterEndDate, setSemesterEndDate] = useState<string | null>(metadataDate);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setSemesterEndDate(metadataDate), [metadataDate, user?.id]);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const nextValue = (event as CustomEvent<string | null>).detail;
      setSemesterEndDate(normalizeSemesterEndDate(nextValue));
    };
    window.addEventListener(SEMESTER_END_DATE_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(SEMESTER_END_DATE_CHANGED_EVENT, handleChange);
  }, []);

  const saveSemesterEndDate = useCallback(async (value: string | null) => {
    if (!supabase) throw new Error("Your account settings are temporarily unavailable.");
    const normalized = value === null ? null : normalizeSemesterEndDate(value);
    if (value !== null && !normalized) throw new Error("Choose a valid semester end date.");

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { [SEMESTER_END_DATE_METADATA_KEY]: normalized },
      });
      if (error) throw error;
      setSemesterEndDate(normalized);
      window.dispatchEvent(
        new CustomEvent(SEMESTER_END_DATE_CHANGED_EVENT, { detail: normalized }),
      );
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { semesterEndDate, isSaving, saveSemesterEndDate };
}
