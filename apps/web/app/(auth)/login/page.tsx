import { Panel, PanelHeader } from "@kiln/ui";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: "42ch", margin: "0 auto", padding: "var(--k-space-9) var(--k-space-5)" }}>
      <div className="k-brand" style={{ marginBottom: "var(--k-space-6)" }}>
        <span className="k-brand-mark">KILN</span>
      </div>
      <Panel>
        <PanelHeader title="Sign in" meta="Email OTP and Google land with the Supabase Auth bridge." />
        <div className="k-panel-body" style={{ color: "var(--k-text-muted)", fontSize: "var(--k-text-sm)" }}>
          Running offline, so authentication is bypassed and the seeded demo account is used.
          Set NEXT_PUBLIC_SUPABASE_URL to enable real sign-in.
        </div>
      </Panel>
    </main>
  );
}
