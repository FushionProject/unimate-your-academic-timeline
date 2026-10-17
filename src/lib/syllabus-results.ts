export const SYLLABUS_RESULT_STORAGE_PREFIX = "unimateSyllabusResult:";

// Do not adopt legacy ownerless drafts: another account can use this same tab.
// Existing unowned entries stay untouched for explicit recovery, never import.
export function syllabusResultStorageKey(
  userId: string | undefined,
  resultId: string | undefined,
): string | null {
  if (!userId?.trim() || !resultId?.trim()) return null;
  return `${SYLLABUS_RESULT_STORAGE_PREFIX}v2:${encodeURIComponent(userId)}:${encodeURIComponent(resultId)}`;
}

export function createSyllabusResultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
