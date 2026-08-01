import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: "48ch", margin: "0 auto", padding: "var(--k-space-9) var(--k-space-5)" }}>
      <h1 className="k-page-title">Not here</h1>
      <p className="k-page-lede">That page does not exist, or the record was removed.</p>
      <p style={{ marginTop: "var(--k-space-5)" }}>
        <Link href="/runs" className="k-link">Back to runs</Link>
      </p>
    </main>
  );
}
