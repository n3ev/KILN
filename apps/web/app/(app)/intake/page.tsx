import { IntakeWizard } from "./intake-wizard";

export const dynamic = "force-dynamic";

export default function IntakePage() {
  return (
    <>
      <h1 className="k-page-title">Describe the business</h1>
      <p className="k-page-lede">A short interrogation that turns a sentence into a complete, contradiction-visible build brief.</p>
      <IntakeWizard />
    </>
  );
}
