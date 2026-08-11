import { Calendar, Clock, Quote } from "lucide-react";
import { useSemesterEndDate } from "../hooks/use-semester-end-date";
import { getDailyQuote } from "../lib/daily-quotes";
import { daysUntilSemesterEnd } from "../lib/semester-date";

export function DateWidget() {
  const today = new Date();
  const quote = getDailyQuote(today);
  const { semesterEndDate } = useSemesterEndDate();
  const daysUntilEnd = daysUntilSemesterEnd(semesterEndDate, today);
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

        {daysUntilEnd !== null && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              {daysUntilEnd > 0
                ? `${daysUntilEnd} day${daysUntilEnd === 1 ? "" : "s"} until semester ends`
                : daysUntilEnd === 0
                  ? "Semester ends today"
                  : "Semester has ended"}
            </span>
          </div>
        )}

        {/* Quote - Right */}
        <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
          <Quote className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0 text-sm text-muted-foreground italic sm:text-right">
            “{quote.text}” — {quote.author}
          </span>
        </div>
      </div>
    </div>
  );
}
