import { useState, useEffect } from "react";
import { Calendar, Clock, Quote } from "lucide-react";

const STUDY_QUOTES = [
  "The secret of getting ahead is getting started.",
  "Focus on being productive instead of busy.",
  "Small steps every day lead to big results.",
  "Your future is created by what you do today.",
  "Success is the sum of small efforts repeated daily.",
  "The only way to do great work is to love what you do.",
  "Discipline is choosing between what you want now and what you want most.",
  "Progress, not perfection.",
  "Start where you are. Use what you have. Do what you can.",
  "Believe you can and you're halfway there.",
];

const SEMESTER_END = new Date("December 15, 2026");
const QUOTE_STORAGE_KEY = "daily-quote-index";
const QUOTE_DATE_KEY = "daily-quote-date";

export function DateWidget() {
  const [quote, setQuote] = useState("");
  const [daysUntilEnd, setDaysUntilEnd] = useState(0);

  useEffect(() => {
    const today = new Date();
    const todayString = today.toDateString();
    const storedQuoteDate = localStorage.getItem(QUOTE_DATE_KEY);
    const storedQuoteIndex = localStorage.getItem(QUOTE_STORAGE_KEY);

    let quoteIndex: number;

    if (storedQuoteDate === todayString && storedQuoteIndex !== null) {
      // Use stored quote for today
      quoteIndex = parseInt(storedQuoteIndex, 10);
    } else {
      // Pick new quote for today
      const dayOfYear = Math.floor(
        (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24),
      );
      quoteIndex = dayOfYear % STUDY_QUOTES.length;
      localStorage.setItem(QUOTE_DATE_KEY, todayString);
      localStorage.setItem(QUOTE_STORAGE_KEY, quoteIndex.toString());
    }

    setQuote(STUDY_QUOTES[quoteIndex]);

    // Calculate days until semester end
    const diffTime = SEMESTER_END.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setDaysUntilEnd(diffDays);
  }, []);

  const today = new Date();
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
  };
  const formattedDate = today.toLocaleDateString("en-US", dateOptions);

  return (
    <div className="w-full bg-card/60 border-l-4 border-l-[#F5C518] border-y border-r border-border/60 p-4 mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        {/* Date - Left */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{formattedDate}</span>
        </div>

        {/* Countdown - Center */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {daysUntilEnd > 0 ? `${daysUntilEnd} days until semester ends` : "Semester has ended"}
          </span>
        </div>

        {/* Quote - Right */}
        <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
          <Quote className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="min-w-0 text-sm text-muted-foreground italic sm:text-right">
            {quote}
          </span>
        </div>
      </div>
    </div>
  );
}
