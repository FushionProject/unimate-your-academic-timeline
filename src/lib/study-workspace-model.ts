import { z } from "zod";

export const studyIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const studyKindSchema = z.enum(["assignment", "note", "link"]);
export function safeStudyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      hostname.includes(".") &&
      !/^[\d.]+$/.test(hostname) &&
      !hostname.includes(":") &&
      !/\.(?:localhost|local|internal|test|invalid)$/.test(hostname) &&
      hostname !== "localhost"
    );
  } catch {
    return false;
  }
}
const sourceUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(safeStudyUrl, "Choose a public http or https link.")
  .transform((value) => new URL(value).href)
  .nullable();
export const studyFieldsSchema = z
  .object({
    kind: studyKindSchema,
    title: z.string().trim().min(1).max(160),
    content: z.string().max(12000).default(""),
    sourceUrl: sourceUrlSchema.default(null),
    sourceTitle: z.string().trim().max(200).default(""),
    nextStep: z.string().max(2000).default(""),
    progress: z.string().max(4000).default(""),
    status: z.enum(["active", "done"]).default("active"),
    courseId: studyIdSchema.nullable().default(null),
    conversationId: studyIdSchema.nullable().default(null),
  })
  .strict();
export const studyInputSchema = studyFieldsSchema.extend({ id: studyIdSchema }).strict();
// Defaults belong to creation only: applying them to a partial update would
// erase unrelated notes and links when a student changes one field.
const fields = studyFieldsSchema.shape;
export const studyPatchSchema = z
  .object({
    title: fields.title.optional(),
    content: fields.content.removeDefault().optional(),
    sourceUrl: fields.sourceUrl.removeDefault().optional(),
    sourceTitle: fields.sourceTitle.removeDefault().optional(),
    nextStep: fields.nextStep.removeDefault().optional(),
    progress: fields.progress.removeDefault().optional(),
    status: fields.status.removeDefault().optional(),
    courseId: fields.courseId.removeDefault().optional(),
    conversationId: fields.conversationId.removeDefault().optional(),
  })
  .strict();
export const studyItemSchema = studyInputSchema.extend({
  userId: studyIdSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const studyCourseSchema = z.object({
  id: studyIdSchema,
  name: z.string(),
  course_code: z.string(),
});
export type StudyItem = z.output<typeof studyItemSchema>;
export type StudyItemInput = z.input<typeof studyInputSchema>;
export type StudyItemPatch = z.input<typeof studyPatchSchema>;
export type StudyKind = z.output<typeof studyKindSchema>;
export type StudyCourse = z.output<typeof studyCourseSchema>;
