import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Home, ChevronLeft, ChevronRight, Brain, Calendar, LayoutGrid, FileText, Flame, LayoutDashboard } from "lucide-react";
import { useStudyStreak } from "../hooks/use-study-streak";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { streak, bestStreak } = useStudyStreak();

  const menuItems = [
    { icon: Home, label: "Home", to: "/" },
    { icon: LayoutDashboard, label: "Dashboard", to: "/dashboard" },
    { icon: Brain, label: "Ask UniMate", to: "/ask" },
    { icon: Calendar, label: "Course Planner", to: "/planner" },
    { icon: LayoutGrid, label: "Bulletin Board", to: "/bulletin" },
    { icon: FileText, label: "Notes", to: "/notes" },
  ];

  return (
    <div
      className={`fixed left-0 top-0 h-full bg-black text-white transition-all duration-300 ease-in-out z-[60] ${
        isExpanded ? "w-64" : "w-16"
      }`}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute -right-3 top-6 h-6 w-6 rounded-full bg-black border-2 border-white flex items-center justify-center hover:bg-gray-800 transition-colors"
      >
        {isExpanded ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Menu Items */}
      <nav className="flex flex-col gap-2 p-4 mt-16 flex-1">
        {menuItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors group"
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {isExpanded && (
              <span className="text-sm font-medium whitespace-nowrap">
                {item.label}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Study Streak Indicator */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2">
          <Flame className="h-5 w-5 text-orange-500 flex-shrink-0" />
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
