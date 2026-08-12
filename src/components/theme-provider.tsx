import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyTheme(theme: Theme) {
  // Only "light" and "dark" are supported; "minimal" is removed so we also
  // strip it here to clear any value left in localStorage from before.
  document.documentElement.classList.remove("light", "dark", "minimal");
  document.documentElement.classList.add(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    const themeToApply: Theme = stored === "dark" ? "dark" : "light";
    setTheme(themeToApply);
    applyTheme(themeToApply);
  }, []);

  const updateTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", nextTheme);
      applyTheme(nextTheme);
    }
  };

  const toggle = () => updateTheme(theme === "light" ? "dark" : "light");

  return (
    <ThemeContext.Provider value={{ theme, setTheme: updateTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
