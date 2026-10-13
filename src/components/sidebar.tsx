import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { useJourneyExperience } from "../lib/journey-experience";
import {
  IconHome,
  IconSyllabus,
  IconDashboard,
  IconBulletin,
  IconNotes,
  IconAsk,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
} from "./icons";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { classic } = useJourneyExperience();

  const menuItems = [
    { icon: IconDashboard, label: classic ? "Dashboard" : "Today", to: "/dashboard" },
    { icon: IconSyllabus, label: classic ? "Upload Syllabus" : "Add a syllabus", to: "/planner" },
    { icon: IconAsk, label: "Ask UniMate", to: "/ask" },
    { icon: IconHome, label: "Home", to: "/" },
    { icon: IconBulletin, label: "Bulletin Board", to: "/bulletin" },
    { icon: IconNotes, label: "Notes", to: "/notes" },
    { icon: PanelRight, label: "Browser Companion", to: "/companion-setup" },
    { icon: IconSettings, label: "Settings", to: "/settings" },
  ];

  return (
    <aside
      aria-label="Application sidebar"
      className={`fixed left-0 top-0 hidden h-full border-r border-border/70 bg-card text-foreground transition-all duration-300 ease-in-out z-[60] md:block ${
        isExpanded ? "w-64" : "w-16"
      }`}
    >
      <Link to="/dashboard" aria-label="UniMate Today" className="absolute left-4 top-5">
        <LogoMark className="h-8 w-8" />
      </Link>
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={isExpanded}
        className="absolute -right-3 top-7 h-6 w-6 rounded-full border border-border bg-card flex items-center justify-center hover:bg-primary transition-colors"
      >
        {isExpanded ? (
          <IconChevronLeft className="h-3 w-3" />
        ) : (
          <IconChevronRight className="h-3 w-3" />
        )}
      </button>

      {/* Menu Items */}
      <nav aria-label="Workspace navigation" className="mt-20 flex flex-1 flex-col gap-2 p-2">
        {menuItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={item.to === "/" ? { exact: true } : undefined}
            aria-label={item.label}
            title={!isExpanded ? item.label : undefined}
            activeProps={{
              className: "bg-[#F5C518] text-black hover:bg-[#F5C518]",
              "aria-current": "page",
            }}
            className="group flex min-h-12 items-center gap-4 rounded-xl px-3 py-3 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2"
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {isExpanded && (
              <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
            )}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
