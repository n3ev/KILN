import { Panel, PanelHeader } from "@kiln/ui";
import { listAbuseReviews } from "../../../../lib/abuse";
import { ReviewQueue } from "./review-queue";

export const dynamic = "force-dynamic";

export default async function Page() {
  const reviews = await listAbuseReviews();
  return <><h1 className="k-page-title">Abuse review</h1><p className="k-page-lede">Restricted categories must be cleared before any live publish tool can run.</p><Panel style={{ marginTop: "var(--k-space-5)" }}><PanelHeader title="Manual review queue" meta={`${reviews.filter((review) => review.status === "pending").length} pending`} /><div className="k-panel-body"><ReviewQueue initial={reviews} /></div></Panel></>;
}
