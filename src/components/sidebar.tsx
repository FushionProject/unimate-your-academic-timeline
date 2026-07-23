import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconHome,
  IconSyllabus,
  IconDashboard,
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
    { icon: IconNotes, label: "Notes", to: "/notes" },
    { icon: IconAsk, label: "Ask UniMate", to: "/ask" },
  ];

  return (
    <div
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
      <nav className="flex flex-col gap-2 p-4 mt-16 flex-1">
        {menuItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-label={item.label}
            title={!isExpanded ? item.label : undefined}
            className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors group"
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
    </div>
  );
}
