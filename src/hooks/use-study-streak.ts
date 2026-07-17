import { useState, useEffect } from "react";

const STORAGE_KEY = "study-streak";
const LAST_VISIT_KEY = "last-visit-date";
const BEST_STREAK_KEY = "best-streak";

export function useStudyStreak() {
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  useEffect(() => {
    const updateStreak = () => {
      const today = new Date().toDateString();
      const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
      const currentStreak = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
      const currentBest = parseInt(localStorage.getItem(BEST_STREAK_KEY) || "0", 10);

      if (!lastVisit) {
        // First visit
        localStorage.setItem(LAST_VISIT_KEY, today);
        localStorage.setItem(STORAGE_KEY, "1");
        localStorage.setItem(BEST_STREAK_KEY, "1");
        setStreak(1);
        setBestStreak(1);
        return;
      }

      const lastVisitDate = new Date(lastVisit);
      const todayDate = new Date(today);
      const diffTime = todayDate.getTime() - lastVisitDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        // Same day, no change
        setStreak(currentStreak);
        setBestStreak(currentBest);
      } else if (diffDays === 1) {
        // Consecutive day
        const newStreak = currentStreak + 1;
        localStorage.setItem(LAST_VISIT_KEY, today);
        localStorage.setItem(STORAGE_KEY, newStreak.toString());
        if (newStreak > currentBest) {
          localStorage.setItem(BEST_STREAK_KEY, newStreak.toString());
          setBestStreak(newStreak);
        }
        setStreak(newStreak);
      } else {
        // Streak broken
        localStorage.setItem(LAST_VISIT_KEY, today);
        localStorage.setItem(STORAGE_KEY, "1");
        setStreak(1);
        setBestStreak(currentBest);
      }
    };

    updateStreak();
  }, []);

  return { streak, bestStreak };
}
