import { useJourneyExperience } from "../lib/journey-experience";

export function ExperienceSwitch() {
  const { classic, setClassic } = useJourneyExperience();
  return (
    <button
      type="button"
      onClick={() => setClassic(!classic)}
      className="rounded-lg px-3 py-2 text-xs text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-foreground"
    >
      {classic ? "Try the new UniMate" : "Switch to classic view"}
    </button>
  );
}
