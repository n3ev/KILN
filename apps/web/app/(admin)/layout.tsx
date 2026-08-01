import Link from "next/link";
import type { ReactNode } from "react";
import { requireOperatorSession } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireOperatorSession();
  return (
    <div className="k-shell k-shell-console">
      <aside className="k-sidebar">
        <Link href="/" className="k-brand k-link">
          <span className="k-brand-mark">KILN</span>
          <span className="k-brand-sub">console</span>
        </Link>
        <nav className="k-nav" aria-label="Operator console">
          <div className="k-nav-group">Operate</div>
          <Link className="k-nav-link" href="/console">Overview</Link>
          <Link className="k-nav-link" href="/console/design">Design gallery</Link>
          <Link className="k-nav-link" href="/console/abuse">Abuse review</Link>
          <div className="k-nav-group">Customer view</div>
          <Link className="k-nav-link" href="/runs">Runs</Link>
          <Link className="k-nav-link" href="/ventures">Ventures</Link>
        </nav>
        <div className="k-session">
          <span>{session.name}</span>
          <span className="k-session-meta">local operator</span>
        </div>
      </aside>
      <main className="k-main k-main-wide">{children}</main>
    </div>
  );
}
