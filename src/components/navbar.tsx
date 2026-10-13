import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sun, Moon, Menu, X, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./theme-provider";
import { useAuth } from "../lib/auth-context";
import { LogoMark } from "./logo-mark";
import { clearCanvasData } from "../lib/canvas";
import { useJourneyExperience } from "../lib/journey-experience";

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
  const { classic } = useJourneyExperience();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const isAuthPage =
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutFailed(false);
    clearCanvasData();
    try {
      const result = await signOut();
      if (result.error) {
        setSignOutFailed(true);
        return;
      }
      navigate({ to: "/" });
    } catch {
      setSignOutFailed(true);
    } finally {
      setIsSigningOut(false);
    }
  };

  const navLinkClass =
    "rounded-md px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
  const activeNavProps = {
    className: "text-foreground underline decoration-primary decoration-2 underline-offset-8",
  };

  const navItems = classic
    ? [
        { to: "/" as const, label: "Home" },
        { to: "/planner" as const, label: "Upload Syllabus" },
        { to: "/dashboard" as const, label: "Dashboard" },
        { to: "/notes" as const, label: "Notes" },
        { to: "/ask" as const, label: "Ask UniMate" },
        { to: "/pricing" as const, label: "Pricing" },
      ]
    : user
      ? [
          { to: "/dashboard" as const, label: "Today" },
          { to: "/planner" as const, label: "My semester" },
          { to: "/ask" as const, label: "Ask UniMate" },
          { to: "/companion-setup" as const, label: "Browser Companion" },
        ]
      : [
          { to: "/" as const, label: "Meet UniMate" },
          { to: "/ask" as const, label: "Study with Uni" },
          { to: "/pricing" as const, label: "Plans & Companion" },
        ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-4 sm:px-6 lg:px-10">
        <Link
          to={user && !classic ? "/dashboard" : "/"}
          aria-label="UniMate home"
          className="inline-flex min-h-11 shrink-0 items-center rounded-md"
        >
          <Logo />
        </Link>
        {!isAuthPage && (
          <nav aria-label="Main navigation" className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={navLinkClass}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={activeNavProps}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!isAuthPage &&
            (user ? (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="hidden min-h-10 items-center rounded-full border border-border px-4 text-xs font-medium disabled:opacity-60 sm:inline-flex"
                title={
                  signOutFailed
                    ? "Sign out didn't finish. Check your connection and try again."
                    : (user.email ?? undefined)
                }
              >
                {isSigningOut ? "Signing out…" : signOutFailed ? "Retry sign out" : "Sign out"}
              </button>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="hidden min-h-10 items-center px-3 text-sm font-medium sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground sm:text-sm"
                >
                  Start free <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
                </Link>
              </>
            ))}
          {!isAuthPage && (
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              className="grid h-11 w-11 place-items-center rounded-xl border border-border lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>
      {!isAuthPage && menuOpen && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="grid gap-1 border-t border-border/60 px-4 py-3 lg:hidden"
        >
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted"
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-primary/15 text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <>
              <Link
                to="/notes"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground"
              >
                My notes
              </Link>
              <Link
                to="/bulletin"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground"
              >
                Bulletin board
              </Link>
              <Link
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground"
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="rounded-xl px-4 py-3 text-left text-sm font-medium text-muted-foreground"
              >
                {isSigningOut ? "Signing out…" : signOutFailed ? "Retry sign out" : "Sign out"}
              </button>
            </>
          ) : (
            <Link
              to="/signin"
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground"
            >
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
