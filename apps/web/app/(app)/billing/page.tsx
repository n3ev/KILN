import { migrateEntitlements } from "@kiln/contracts";
import { rowsOf } from "@kiln/db";
import { Badge, Panel, PanelHeader, Stat } from "@kiln/ui";
import { sql } from "drizzle-orm";
import { withSessionAccount } from "../../../lib/session";
import { BillingActions, PortalButton } from "./billing-actions";

export const dynamic = "force-dynamic";

interface PlanRow {
  id: string;
  name: string;
  price_weekly_cents: number;
  entitlements: unknown;
  current: boolean;
  subscription_status: string | null;
}

async function billingView(): Promise<{ plans: PlanRow[]; credits: number }> {
  return withSessionAccount(async (tx, session) => {
    const plans = rowsOf<PlanRow>(await tx.execute(sql`
      SELECT plan.id, plan.name, plan.price_weekly_cents, plan.entitlements,
             (account.plan_id = plan.id) AS current, subscription.status AS subscription_status
      FROM plans AS plan
      JOIN accounts AS account ON account.id = ${session.accountId}
      LEFT JOIN subscriptions AS subscription
        ON subscription.account_id = account.id AND subscription.plan_id = plan.id
      WHERE plan.active = true
      ORDER BY plan.price_weekly_cents ASC
    `));
    const credit = rowsOf<{ balance: number | string }>(await tx.execute(sql`
      SELECT COALESCE(sum(delta_micros), 0) AS balance FROM credit_ledger
      WHERE account_id = ${session.accountId}
    `))[0];
    return { plans, credits: Number(credit?.balance ?? 0) / 1_000 };
  });
}

export default async function Page() {
  const view = await billingView();
  const current = view.plans.find((plan) => plan.current);
  return (
    <>
      <div className="k-theatre-heading">
        <div>
          <h1 className="k-page-title">Billing</h1>
          <p className="k-page-lede">Weekly plans, transparent build credits, and no deferred surprise charges.</p>
        </div>
        <PortalButton />
      </div>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="Account position" meta="One build credit equals 1,000 micros of internal cost." />
        <div className="k-grid k-grid-3">
          <Stat label="Current plan" value={current?.name ?? "None"} />
          <Stat label="Subscription" value={current?.subscription_status ?? "Not started"} />
          <Stat label="Credit balance" value={`${Math.round(view.credits).toLocaleString()} cr`} />
        </div>
      </Panel>

      <div className="k-grid k-grid-3" style={{ marginTop: "var(--k-space-5)" }}>
        {view.plans.map((plan) => {
          const rights = migrateEntitlements(plan.entitlements);
          return (
            <Panel key={plan.id}>
              <PanelHeader
                title={plan.name}
                meta={`$${(Number(plan.price_weekly_cents) / 100).toLocaleString()}/week`}
                action={plan.current ? <Badge tone="positive">active</Badge> : undefined}
              />
              <div className="k-panel-body" style={{ display: "grid", gap: "var(--k-space-4)" }}>
                <ul style={{ display: "grid", gap: "var(--k-space-2)", color: "var(--k-text-muted)" }}>
                  <li>{rights["ventures.max"]} active venture{rights["ventures.max"] === 1 ? "" : "s"}</li>
                  <li>{rights["credits.weekly"].toLocaleString()} build credits each week</li>
                  <li>{rights["autonomy.max"]} autonomy ceiling</li>
                  <li>{rights["model.tier.max"]} model tier</li>
                  <li>{rights["handover.included"] ? "Handover included" : "Handover available separately"}</li>
                </ul>
                <BillingActions planId={plan.id} current={plan.current} />
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

