import { Link, useNavigate } from "@tanstack/react-router";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";
import { useAuth } from "../lib/auth-context";
import { LogoMark } from "./logo-mark";

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <LogoMark className="h-9 w-9" />
      <span className="font-serif-display text-2xl tracking-tight text-foreground">UniMate</span>
    </div>
  );
}

export function Navbar() {
  const { theme, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-[10px] bg-background/80 border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-center px-6 py-4 gap-8">
        <Link to="/">
          <Logo />
        </Link>
        <nav className="hidden md:flex items-center gap-4">
          <Link
            to="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Home
          </Link>
          <Link
            to="/planner"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Syllabus
          </Link>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
          <Link
            to="/notes"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Notes
          </Link>
          <Link
            to="/ask"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Ask UniMate
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition hover:text-foreground hover:bg-card"
          >
            {theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {user ? (
            <button
              onClick={handleSignOut}
              className="hidden sm:inline-flex h-9 items-center rounded-full border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition hover:bg-card"
              title={user.email ?? undefined}
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/signin"
              className="hidden sm:inline-flex h-9 items-center rounded-full border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition hover:bg-card"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
