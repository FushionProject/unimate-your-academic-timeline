import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { ThemeProvider } from "../components/theme-provider";
import { AuthProvider } from "../lib/auth-context";
import { Sidebar } from "../components/sidebar";
import { Navbar } from "../components/navbar";
import { DateWidget } from "../components/date-widget";
// import { ScreenAssistant } from "../components/screen-assistant"; // Hidden for now — future rollout

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "UniMate — Your all-in-one student assistant." },
      {
        name: "description",
        content:
          "Keep classes, deadlines, notes, and AI study help together with UniMate, your all-in-one student assistant.",
      },
      { name: "author", content: "UniMate" },
      { property: "og:title", content: "UniMate — Your all-in-one student assistant." },
      {
        property: "og:description",
        content: "Keep classes, deadlines, notes, and AI study help together in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Runs before first paint so the stored theme applies without a flash. The
// class it adds isn't in the server HTML, so <html> needs
// suppressHydrationWarning to avoid a React hydration mismatch.
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme")==="dark"?"dark":"light";document.documentElement.classList.add(t);}catch(e){}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isPublicPage =
    pathname === "/" ||
    pathname === "/pricing" ||
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";
  const isAuthPage =
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <div className="min-h-screen flex flex-col">
            <a
              href="#main-content"
              className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform focus:translate-y-0"
            >
              Skip to content
            </a>
            <Navbar />
            <div className="flex min-w-0 flex-1">
              <Sidebar />
              <div
                id="main-content"
                className={`min-w-0 flex-1 md:ml-16 ${isPublicPage ? "" : "p-4 sm:p-6"}`}
              >
                {!isAuthPage &&
                  (isPublicPage ? (
                    <div className="px-4 pt-4 sm:px-6 sm:pt-6">
                      <DateWidget />
                    </div>
                  ) : (
                    <DateWidget />
                  ))}
                <Outlet />
              </div>
            </div>
            {/* <ScreenAssistant /> — Hidden for now, future rollout */}
          </div>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
