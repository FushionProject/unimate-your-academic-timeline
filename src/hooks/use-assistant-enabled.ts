import { useCallback, useEffect, useState } from "react";

// Persists the floating Study Assistant's on/off preference to localStorage and
// keeps every consumer in sync live — flipping it in the dashboard section
// updates the floating dock (and vice versa) without a reload. The browser's
// native `storage` event only fires in OTHER tabs, so a same-tab custom event
// carries the change within this tab.
const STORAGE_KEY = "unimateAssistantEnabled";
const EVENT_NAME = "unimate-assistant-toggle";

function read(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function useAssistantEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(read());

    const sync = () => setEnabled(read());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setAssistantEnabled = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(new Event(EVENT_NAME));
    setEnabled(value);
  }, []);

  return { enabled, setAssistantEnabled };
}
