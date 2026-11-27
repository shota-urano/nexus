import { z } from "zod";

// 共有の型層 M10（DD-01 1.1、ADR-019）。ホームの表示の応答の形（`docs/api/openapi.yaml` の `Home`。
// DD-04 `getHome`、DD-02 FN-020）。

const URL_PATTERN = /^https?:\/\//;

const id = z.number().int().min(1);
const count = z.number().int().min(0);

// ホームのカードに出す知らせ（BD-09 1.1。MSG-015〜MSG-017）。
export const homeNoticeSchema = z.enum(["MSG-015", "MSG-016", "MSG-017"]);

export const homeSchema = z.object({
  newCount: count,
  unreadCount: count,
  learning: z
    .object({
      contentId: id,
      learningTheme: z.string(),
      isCompleted: z.boolean(),
    })
    .nullable(),
  ai: z.object({
    writingCount: count,
    hasFailure: z.boolean(),
  }),
  picks: z
    .array(
      z.object({
        contentId: id,
        title: z.string(),
        theme: z.string(),
        imageUrl: z.string().regex(URL_PATTERN).max(2048).nullable(),
      }),
    )
    .max(3),
  notices: z.array(homeNoticeSchema),
  // Research のカードに出す値（DD-02 FN-020。CR-020）。週報の未着は出さない。
  research: z.object({
    unreadCount: count,
  }),
});

export type HomeNotice = z.infer<typeof homeNoticeSchema>;
export type Home = z.infer<typeof homeSchema>;
export type HomePick = Home["picks"][number];
