import { resolve } from "node:path";
import { scanBuildOutputs } from "./secret-scanner.js";

const root = resolve(import.meta.dirname, "..");
const result = scanBuildOutputs(root);

if (result.findings.length > 0) {
  console.error(
    `Build secret scan failed (${result.findings.length} finding(s) in ${result.scanned} files):\n` +
      result.findings
        .map((finding) => `  - ${finding.file}:${finding.line} ${finding.rule} ${finding.preview}`)
        .join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(`Build secret scan passed (${result.scanned} generated text files inspected).`);
}
