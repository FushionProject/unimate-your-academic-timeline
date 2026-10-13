import { useEffect, useState } from "react";

const EXPERIENCE_KEY = "unimate-experience";

export function readJourneyExperience(
  search: string,
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
): "classic" | "premium" {
  const requested = new URLSearchParams(search).get("experience");
  const explicit = requested === "classic" || requested === "premium" ? requested : null;
  try {
    const storage = getStorage();
    if (explicit) storage.setItem(EXPERIENCE_KEY, explicit);
    return explicit ?? (storage.getItem(EXPERIENCE_KEY) === "classic" ? "classic" : "premium");
  } catch {
    return explicit ?? "premium";
  }
}

export function useJourneyExperience() {
  const [classic, setClassicState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setClassicState(
      readJourneyExperience(window.location.search, () => window.localStorage) === "classic",
    );
    setReady(true);
  }, []);

  const setClassic = (value: boolean) => {
    try {
      localStorage.setItem(EXPERIENCE_KEY, value ? "classic" : "premium");
    } catch {
      // The URL keeps the choice usable when browser storage is unavailable.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("experience", value ? "classic" : "premium");
    window.location.assign(url.toString());
  };

  return { classic, setClassic, ready };
}

export function askJourneyHref(prompt: string, course?: string) {
  const search = new URLSearchParams({ prompt });
  if (course) search.set("course", course);
  return `/ask?${search.toString()}`;
}
