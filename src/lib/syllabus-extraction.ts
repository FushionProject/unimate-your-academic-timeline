export type SyllabusTimelineItem = {
  title: string;
  type: "exam" | "quiz" | "assignment" | "project" | "deadline";
  due_date: string;
};

const RELEVANT_LINE =
  /\b(?:week|session|schedule|exam|quiz|project|assignment|homework|deadline|due|withdraw|drop|refund|holiday|break|final)\b/i;
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const MONTH_DATE =
  /\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function linesFrom(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Reduce policy prose while retaining page markers, term context, and nearby schedule rows. */
export function buildSyllabusExtractionContext(text: string): string {
  const lines = linesFrom(text);
  const keep = new Set<number>();
  for (let index = 0; index < Math.min(lines.length, 24); index += 1) keep.add(index);

  lines.forEach((line, index) => {
    if (
      /^--- Page \d+/i.test(line) ||
      RELEVANT_LINE.test(line) ||
      NUMERIC_DATE.test(line) ||
      MONTH_DATE.test(line)
    ) {
      for (
        let nearby = Math.max(0, index - 1);
        nearby <= Math.min(lines.length - 1, index + 1);
        nearby += 1
      ) {
        keep.add(nearby);
      }
    }
  });

  return lines
    .filter((_, index) => keep.has(index))
    .join("\n")
    .slice(0, 40_000);
}

function termYear(text: string, now = new Date()): number {
  const explicit = text.match(/\b(?:Fall|Spring|Summer|Winter)\s+(20\d{2})\b/i);
  return explicit ? Number(explicit[1]) : now.getFullYear();
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateInLine(line: string, defaultYear: number): string | null {
  const numeric = line.match(NUMERIC_DATE);
  if (numeric) {
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    return isoDate(year, Number(numeric[1]), Number(numeric[2]));
  }
  const named = line.match(MONTH_DATE);
  if (!named) return null;
  return isoDate(Number(named[3] || defaultYear), MONTHS[named[1].toLowerCase()], Number(named[2]));
}

function inferType(title: string): SyllabusTimelineItem["type"] {
  if (/\bexam\b/i.test(title)) return "exam";
  if (/\bquiz\b/i.test(title)) return "quiz";
  if (/\bproject\b/i.test(title)) return "project";
  if (/\b(?:homework|assignment|chapter|session)\b/i.test(title)) return "assignment";
  return "deadline";
}

function cleanTitle(line: string): string {
  return line
    .replace(/\(?\bbegin(?:ning)?\s+\d{1,2}\/\d{1,2}\/\d{2,4}\)?/gi, "")
    .replace(MONTH_DATE, "")
    .replace(NUMERIC_DATE, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim();
}

/** A no-provider fallback for explicit dates and weekly schedule rows. */
export function extractDatedSyllabusItems(text: string): SyllabusTimelineItem[] {
  const lines = linesFrom(text);
  const defaultYear = termYear(text);
  const items: SyllabusTimelineItem[] = [];
  let currentWeekDate: string | null = null;

  const add = (title: string, dueDate: string | null) => {
    const cleaned = cleanTitle(title);
    if (!dueDate || cleaned.length < 3) return;
    const item = { title: cleaned.slice(0, 240), type: inferType(cleaned), due_date: dueDate };
    if (
      !items.some(
        (existing) => existing.title === item.title && existing.due_date === item.due_date,
      )
    ) {
      items.push(item);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isWeeklyRow = /^Week\s+(?:\d+|beginning)\b/i.test(line);
    const directDate = dateInLine(line, defaultYear);
    const lookaheadDate =
      isWeeklyRow && !/session\s*2\b/i.test(line)
        ? lines
            .slice(index + 1, index + 4)
            .filter((candidate) => !/^--- Page \d+/i.test(candidate))
            .map((candidate) => dateInLine(candidate, defaultYear))
            .find(Boolean) || null
        : null;

    if (isWeeklyRow && (directDate || lookaheadDate)) currentWeekDate = directDate || lookaheadDate;
    if (isWeeklyRow) {
      add(line, directDate || lookaheadDate || currentWeekDate);
      continue;
    }

    if (directDate && RELEVANT_LINE.test(line)) add(line, directDate);
  }

  return items;
}
