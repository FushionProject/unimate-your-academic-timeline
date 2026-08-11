export const SEMESTER_END_DATE_METADATA_KEY = "semester_end_date";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeSemesterEndDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysUntilSemesterEnd(value: unknown, today = new Date()): number | null {
  const normalized = normalizeSemesterEndDate(value);
  if (!normalized) return null;

  const [year, month, day] = normalized.split("-").map(Number);
  const endUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((endUtc - todayUtc) / (24 * 60 * 60 * 1000));
}

export function formatSemesterEndDate(value: unknown): string | null {
  const normalized = normalizeSemesterEndDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
