import { describe, it } from "vitest";
import { expectAgentModule } from "../../__tests__/module-contract.js";
import { agent } from "../agent.js";
import { buildPrompt } from "../prompt.js";
import { rubric, rubricId, usesCritic } from "../rubric.js";
import { inputSchema, outputSchema } from "../schemas.js";

describe("product architect agent module", () => {
  it("exposes the registered declaration and its typed collaborators", () => {
    expectAgentModule("product-architect", { agent, buildPrompt, inputSchema, outputSchema, rubric, rubricId, usesCritic });
  });
});
