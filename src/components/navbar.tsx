import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sun, Moon } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./theme-provider";
import { useAuth } from "../lib/auth-context";
import { LogoMark } from "./logo-mark";
import { clearCanvasData } from "../lib/canvas";

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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isAuthPage =
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    clearCanvasData();
    await signOut();
    navigate({ to: "/" });
    setIsSigningOut(false);
  };

  const navLinkClass =
    "rounded-md px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
  const activeNavProps = {
    className: "text-foreground underline decoration-primary decoration-2 underline-offset-8",
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-[10px] bg-background/80 border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 gap-4 sm:px-6 md:justify-center md:gap-8">
        <Link
          to="/"
          aria-label="UniMate home"
          className="inline-flex min-h-11 items-center rounded-md sm:min-h-9"
        >
          <Logo />
        </Link>
        {!isAuthPage && (
          <nav aria-label="Main navigation" className="hidden items-center gap-4 md:flex">
            <Link
              to="/"
              className={navLinkClass}
              activeOptions={{ exact: true }}
              activeProps={activeNavProps}
            >
              Home
            </Link>
            <Link to="/planner" className={navLinkClass} activeProps={activeNavProps}>
              Upload Syllabus
            </Link>
            <Link to="/dashboard" className={navLinkClass} activeProps={activeNavProps}>
              Dashboard
            </Link>
            <Link to="/bulletin" className={navLinkClass} activeProps={activeNavProps}>
              Bulletin Board
            </Link>
            <Link to="/notes" className={navLinkClass} activeProps={activeNavProps}>
              Notes
            </Link>
            <Link to="/ask" className={navLinkClass} activeProps={activeNavProps}>
              Ask UniMate
            </Link>
            <Link to="/pricing" className={navLinkClass} activeProps={activeNavProps}>
              Pricing
            </Link>
            <Link to="/settings" className={navLinkClass} activeProps={activeNavProps}>
              Settings
            </Link>
          </nav>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition hover:text-foreground hover:bg-card sm:h-9 sm:w-9"
          >
            {theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!isAuthPage &&
            (user ? (
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="inline-flex h-11 items-center rounded-full border border-border bg-card/60 px-3 text-sm font-medium text-foreground transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-60 sm:h-9 sm:px-4"
                title={user.email ?? undefined}
              >
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            ) : (
              <Link
                to="/signin"
                className="inline-flex h-11 items-center rounded-full border border-border bg-card/60 px-3 text-sm font-medium text-foreground transition hover:bg-card sm:h-9 sm:px-4"
              >
                Sign in
              </Link>
            ))}
        </div>
      </div>
      {!isAuthPage && (
        <nav
          aria-label="Mobile navigation"
          className="scrollbar-hidden flex gap-2 overflow-x-auto border-t border-border/40 px-3 py-1 text-sm md:hidden"
        >
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Home
          </Link>
          <Link
            to="/planner"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Upload
          </Link>
          <Link
            to="/ask"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Ask UniMate
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Dashboard
          </Link>
          <Link
            to="/notes"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Notes
          </Link>
          <Link
            to="/bulletin"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Bulletin
          </Link>
          <Link
            to="/pricing"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Pricing
          </Link>
          <Link
            to="/settings"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-muted-foreground hover:text-foreground"
            activeProps={activeNavProps}
          >
            Settings
          </Link>
        </nav>
      )}
    </header>
  );
}
