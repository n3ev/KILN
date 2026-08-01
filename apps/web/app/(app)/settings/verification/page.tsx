import { Badge, Panel, PanelHeader } from "@kiln/ui";
import { rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const VerificationView = z.object({
  account_name: z.string(),
  kyc_status: z.enum(["unverified", "pending", "verified", "rejected"]),
  kyc_verified_at: z.union([z.date(), z.string(), z.number()]).nullable(),
  pending_reviews: z.coerce.number().int().nonnegative(),
  blocked_reviews: z.coerce.number().int().nonnegative(),
});

async function verificationView() {
  return withSessionAccount(async (tx, session) => {
    const row = rowsOf<unknown>(await tx.execute(sql`
      SELECT account.name AS account_name, account.kyc_status::text AS kyc_status,
        account.kyc_verified_at,
        count(review.id) FILTER (WHERE review.status = 'pending') AS pending_reviews,
        count(review.id) FILTER (WHERE review.status = 'blocked') AS blocked_reviews
      FROM accounts account
      LEFT JOIN abuse_reviews review ON review.account_id = account.id
      WHERE account.id = ${session.accountId}
      GROUP BY account.id
    `))[0];
    return VerificationView.parse(row);
  });
}

const statusTone = {
  unverified: "warning",
  pending: "warning",
  verified: "positive",
  rejected: "critical",
} as const;

export default async function Page() {
  const view = await verificationView();
  const publishReady = view.kyc_status === "verified" && view.pending_reviews === 0 && view.blocked_reviews === 0;

  return (
    <>
      <h1 className="k-page-title">Account verification</h1>
      <p className="k-page-lede">
        KILN checks the paying account and restricted-business review queue before any tool can publish live.
        Sandbox generation remains available while review is pending.
      </p>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader
          title={view.account_name}
          meta="The worker re-checks this state immediately before every non-sandbox publish mutation."
          action={<Badge tone={publishReady ? "positive" : "warning"}>{publishReady ? "publish ready" : "publish paused"}</Badge>}
        />
        <div className="k-panel-body" style={{ display: "grid", gap: "var(--k-space-4)" }}>
          <div className="k-row" style={{ padding: 0 }}>
            <span>Paying-account verification</span>
            <Badge tone={statusTone[view.kyc_status]}>{view.kyc_status}</Badge>
          </div>
          <div className="k-row" style={{ padding: 0 }}>
            <span>Restricted-business reviews</span>
            <Badge tone={view.pending_reviews > 0 || view.blocked_reviews > 0 ? "warning" : "positive"}>
              {view.pending_reviews} pending · {view.blocked_reviews} blocked
            </Badge>
          </div>
          {view.kyc_verified_at ? (
            <p className="k-panel-meta">Verified {new Date(view.kyc_verified_at).toLocaleString()}.</p>
          ) : (
            <div className="k-banner k-banner-warning">
              Hosted identity-provider enrolment is intentionally deferred to the live-integration prompt. The
              enforcement boundary is active now and fails closed; an operator must complete verification before live publish.
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
