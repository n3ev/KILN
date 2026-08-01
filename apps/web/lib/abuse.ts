import { rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "./session";

const DateIso = z.union([z.date(), z.string(), z.number()]).transform((value) => new Date(value).toISOString());
const ReviewRow = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  venture_name: z.string(),
  category: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "cleared", "blocked"]),
  evidence: z.unknown(),
  decision_note: z.string().nullable(),
  created_at: DateIso,
  decided_at: z.union([z.date(), z.string(), z.number()]).nullable(),
});
export type AbuseReview = z.infer<typeof ReviewRow>;

export async function listAbuseReviews(): Promise<AbuseReview[]> {
  return withSessionAccount(async (tx, session) => rowsOf<unknown>(await tx.execute(sql`
    SELECT review.id, review.venture_id, venture.name AS venture_name, review.category,
      review.reason, review.status::text AS status, review.evidence, review.decision_note,
      review.created_at, review.decided_at
    FROM abuse_reviews review
    JOIN ventures venture ON venture.id = review.venture_id
    WHERE review.account_id = ${session.accountId}
    ORDER BY CASE review.status WHEN 'pending' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
      review.created_at DESC
  `)).map((row) => ReviewRow.parse(row)));
}

export async function decideAbuseReview(
  reviewId: string,
  decision: { status: "cleared" | "blocked"; note: string },
): Promise<boolean> {
  if (!z.string().uuid().safeParse(reviewId).success) return false;
  return withSessionAccount(async (tx, session) => {
    const updated = rowsOf<{ id: string }>(await tx.execute(sql`
      UPDATE abuse_reviews SET status = ${decision.status}, decision_note = ${decision.note},
        reviewed_by_user_id = ${session.userId}, decided_at = now()
      WHERE id = ${reviewId} AND account_id = ${session.accountId} AND status = 'pending'
      RETURNING id
    `))[0];
    if (!updated) return false;
    await tx.execute(sql`
      INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
      VALUES (${session.accountId}, ${`user:${session.userId}`}, 'abuse.review_decided',
        'abuse_review', ${reviewId}, ${JSON.stringify(decision)}::jsonb)
    `);
    return true;
  });
}
