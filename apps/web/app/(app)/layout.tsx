import Link from "next/link";
import type { ReactNode } from "react";
import { listVentures } from "../../lib/queries";
import { requireSession } from "../../lib/session";

// Every customer surface is database-backed. Static prerendering would open
// the embedded Postgres during `next build`, bake demo data into HTML, and fail
// on a clean checkout before `db:push` has run.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [session, ventures] = await Promise.all([requireSession(), listVentures()]);

  return (
    <div className="k-shell">
      <aside className="k-sidebar">
        <Link href="/" className="k-brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="k-brand-mark">KILN</span>
          <span className="k-brand-sub">operator</span>
        </Link>

        <nav className="k-nav">
          <div className="k-nav-group">Build</div>
          <Link className="k-nav-link" href="/intake">New venture</Link>
          <Link className="k-nav-link" href="/runs">Runs</Link>
          <Link className="k-nav-link" href="/approvals">Approvals</Link>

          <div className="k-nav-group">Ventures</div>
          {ventures.length === 0 ? (
            <span className="k-nav-link" style={{ color: "var(--k-text-faint)" }}>None yet</span>
          ) : (
            ventures.map((v) => (
              <Link key={v.id} className="k-nav-link" href={`/ventures/${v.id}`}>{v.name}</Link>
            ))
          )}

          <div className="k-nav-group">Account</div>
          <Link className="k-nav-link" href="/artifacts">Artifacts</Link>
          <Link className="k-nav-link" href="/billing">Billing</Link>
          <Link className="k-nav-link" href="/settings/verification">Verification</Link>
          {session.role === "owner" ? <Link className="k-nav-link" href="/settings/data">Data &amp; privacy</Link> : null}
          <Link className="k-nav-link" href="/handover">Handover</Link>
          <Link className="k-nav-link" href="/console">Console</Link>
        </nav>
        <div className="k-session">
          <span>{session.name}</span>
          <span className="k-session-meta">{session.email} · offline</span>
        </div>
      </aside>

      <main className="k-main">{children}</main>
    </div>
  );
}
