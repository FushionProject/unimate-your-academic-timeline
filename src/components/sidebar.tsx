import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconHome,
  IconSyllabus,
  IconDashboard,
  IconBulletin,
  IconNotes,
  IconAsk,
  IconFlame,
  IconChevronLeft,
  IconChevronRight,
} from "./icons";
import { useStudyStreak } from "../hooks/use-study-streak";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { streak, bestStreak } = useStudyStreak();

  const menuItems = [
    { icon: IconHome, label: "Home", to: "/" },
    { icon: IconSyllabus, label: "Upload Syllabus", to: "/planner" },
    { icon: IconDashboard, label: "Dashboard", to: "/dashboard" },
    { icon: IconBulletin, label: "Bulletin Board", to: "/bulletin" },
    { icon: IconNotes, label: "Notes", to: "/notes" },
    { icon: IconAsk, label: "Ask UniMate", to: "/ask" },
  ];

  return (
    <aside
      aria-label="Application sidebar"
      className={`fixed left-0 top-0 hidden h-full bg-black text-white transition-all duration-300 ease-in-out z-[60] md:block ${
        isExpanded ? "w-64" : "w-16"
      }`}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        className="absolute -right-3 top-6 h-6 w-6 rounded-full bg-black border-2 border-white flex items-center justify-center hover:bg-gray-800 transition-colors"
      >
        {isExpanded ? (
          <IconChevronLeft className="h-3 w-3" />
        ) : (
          <IconChevronRight className="h-3 w-3" />
        )}
      </button>

      {/* Menu Items */}
      <nav aria-label="Workspace navigation" className="mt-16 flex flex-1 flex-col gap-2 p-4">
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
            className="group flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {isExpanded && (
              <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* Study Streak Indicator */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2">
          <IconFlame className="h-5 w-5 text-orange-500 flex-shrink-0" />
          {isExpanded && (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-orange-500">{streak} day streak</span>
              <span className="text-xs text-gray-400">Best: {bestStreak} days</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
