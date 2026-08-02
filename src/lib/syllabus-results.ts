export const SYLLABUS_RESULT_STORAGE_PREFIX = "unimateSyllabusResult:";

export function createSyllabusResultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
