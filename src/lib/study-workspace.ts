import { z } from "zod";
import { getAuthHeaders } from "./auth-fetch";
import { studyItemSchema, studyCourseSchema } from "./study-workspace-model";
import type { StudyItemInput, StudyItemPatch, StudyKind } from "./study-workspace-model";
export type {
  StudyItem,
  StudyItemInput,
  StudyItemPatch,
  StudyKind,
  StudyCourse,
} from "./study-workspace-model";
export type StudyAccess = { expectedUserId: string; signal?: AbortSignal };
export class StudyWorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StudyWorkspaceError";
  }
}
async function requestWorkspace(method: string, data: unknown, access: StudyAccess, query = "") {
  const headers = await getAuthHeaders({
    expectedUserId: access?.expectedUserId,
    signal: access?.signal,
  });
  access.signal?.throwIfAborted();
  const response = await fetch(`/api/study-workspace${query}`, {
    method,
    signal: access.signal,
    headers: { "Content-Type": "application/json", ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json().catch(() => null);
  access.signal?.throwIfAborted();
  if (!response.ok)
    throw new StudyWorkspaceError(
      typeof result?.error === "string"
        ? result.error
        : "Your saved work could not be loaded. Try again.",
      typeof result?.code === "string" ? result.code : "WORKSPACE_UNAVAILABLE",
      response.status,
    );
  return result;
}
export async function listStudyWorkspace(
  filters: { kind?: StudyKind; conversationId?: string; id?: string; offset?: number } = {},
  access: StudyAccess,
) {
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const data = z
    .object({
      items: z.array(studyItemSchema),
      courses: z.array(studyCourseSchema),
      hasMore: z.boolean().optional(),
      nextOffset: z.number().int().nonnegative().nullable().optional(),
    })
    .parse(await requestWorkspace("GET", undefined, access, query.size ? `?${query}` : ""));
  if (data.items.some((item) => item.userId !== access.expectedUserId))
    throw new StudyWorkspaceError(
      "Your account changed. Reopen your saved work.",
      "AUTH_SESSION_CHANGED",
      409,
    );
  return data;
}
function ownedItem(data: unknown, access: StudyAccess) {
  const { item } = z.object({ item: studyItemSchema }).parse(data);
  if (item.userId !== access.expectedUserId)
    throw new StudyWorkspaceError(
      "Your account changed. Reopen your saved work.",
      "AUTH_SESSION_CHANGED",
      409,
    );
  return item;
}
export async function createStudyItem(item: StudyItemInput, access: StudyAccess) {
  return ownedItem(await requestWorkspace("POST", { item }, access), access);
}
export async function updateStudyItem(
  id: string,
  expectedVersion: number,
  patch: StudyItemPatch,
  access: StudyAccess,
) {
  return ownedItem(await requestWorkspace("PATCH", { id, expectedVersion, patch }, access), access);
}
export async function deleteStudyItem(
  id: string,
  expectedVersion: number,
  access: StudyAccess,
): Promise<void> {
  await requestWorkspace("DELETE", { id, expectedVersion }, access);
}
