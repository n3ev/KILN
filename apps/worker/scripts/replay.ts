import { closeDb } from "@kiln/db";
import { formatReplayReport, replayExistingRun, replayExitCode } from "../replay.js";

async function main(): Promise<void> {
  const runId = process.argv.slice(2).find((argument) => argument !== "--");
  if (!runId) throw new Error("Usage: pnpm run:replay -- <run-id>");

  const result = await replayExistingRun(runId);
  console.log(formatReplayReport(result));
  process.exitCode = replayExitCode(result);
}

let failure: unknown;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await closeDb();
}
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
