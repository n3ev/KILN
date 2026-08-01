import Link from "next/link";

/**
 * The marketing page.
 *
 * Deliberately not a centred hero with a floating dashboard mockup on a
 * gradient (CLAUDE.md §3.4 bans exactly that). Editorial column, one claim,
 * concrete numbers, and an honest statement of what the thing does not do.
 */
export default function MarketingPage() {
  return (
    <main style={{ maxWidth: "68ch", margin: "0 auto", padding: "var(--k-space-9) var(--k-space-5)" }}>
      <div className="k-brand" style={{ marginBottom: "var(--k-space-8)" }}>
        <span className="k-brand-mark">KILN</span>
      </div>

      <h1 style={{ fontSize: "var(--k-text-4xl)", fontWeight: 620, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
        You describe the business.
        <br />
        KILN builds and runs it.
      </h1>

      <p style={{ marginTop: "var(--k-space-5)", fontSize: "var(--k-text-lg)", color: "var(--k-text-muted)" }}>
        Sourcing, storefront, brand, copy, compliance, launch. Then the part nobody
        else does: it keeps operating the thing on Monday morning.
      </p>

      <div style={{ display: "flex", gap: "var(--k-space-3)", marginTop: "var(--k-space-6)" }}>
        <Link href="/intake" className="k-btn k-btn-primary" style={{ height: 38, padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--k-radius)", textDecoration: "none", border: "1px solid var(--k-accent)" }}>
          Start a build
        </Link>
        <Link href="/ventures" className="k-btn k-btn-secondary" style={{ height: 38, padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--k-radius)", textDecoration: "none", border: "1px solid var(--k-border-strong)" }}>
          See a finished one
        </Link>
      </div>

      <section style={{ marginTop: "var(--k-space-9)" }}>
        <h2 style={{ fontSize: "var(--k-text-xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>
          What actually happens
        </h2>
        <ol style={{ marginTop: "var(--k-space-4)", display: "grid", gap: "var(--k-space-4)" }}>
          {[
            ["Interrogation", "Twelve questions that decide whether a business works. It will not move on from a blank one."],
            ["Validation", "Real demand signals, named competitors, mined complaints, unit economics. It is allowed to tell you no."],
            ["Positioning and brand", "A name with the domain already checked, a voice charter, and a design system generated for this business rather than recoloured from a template."],
            ["Build", "A real storefront with real SKUs, real supplier quotes, real margins, real policy pages."],
            ["Launch", "Domain, DNS, email authentication, analytics, a test purchase placed and refunded."],
            ["Operating", "A daily loop that reads yesterday's numbers, says what changed in three sentences, and proposes one thing to do about it."],
          ].map(([title, body]) => (
            <li key={title} style={{ borderLeft: "2px solid var(--k-border)", paddingLeft: "var(--k-space-4)" }}>
              <strong style={{ fontWeight: 570 }}>{title}</strong>
              <p style={{ color: "var(--k-text-muted)", marginTop: 2 }}>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: "var(--k-space-8)" }}>
        <h2 style={{ fontSize: "var(--k-text-xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>
          What it will not do
        </h2>
        <p style={{ marginTop: "var(--k-space-3)", color: "var(--k-text-muted)" }}>
          It cannot register your company, file your taxes, or give you legal advice, and it
          will say so rather than pretending. It will not sell restricted goods. It will not
          publish anything without asking, unless you have explicitly told it to.
        </p>
        <p style={{ marginTop: "var(--k-space-3)", color: "var(--k-text-muted)" }}>
          KILN holds the accounts it creates on your behalf. You can take all of them, at any
          time, from a link that is always visible. That is a five-working-day process and it is
          not gated behind a conversation.
        </p>
      </section>
    </main>
  );
}
