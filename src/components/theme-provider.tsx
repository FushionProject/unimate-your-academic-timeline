import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "light" | "dark" | "minimal";

interface ThemeContextType {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("theme")) as Theme | null;
    const themeToApply = stored || "light";
    setTheme(themeToApply);
    
    // Remove all theme classes and add the current one
    document.documentElement.classList.remove("light", "dark", "minimal");
    document.documentElement.classList.add(themeToApply);
  }, []);

  const toggle = () => {
    const themes: Theme[] = ["light", "dark", "minimal"];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", nextTheme);
      // Remove all theme classes and add the new one
      document.documentElement.classList.remove("light", "dark", "minimal");
      document.documentElement.classList.add(nextTheme);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
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
