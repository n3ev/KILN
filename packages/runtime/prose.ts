import type { ArtifactType } from "@kiln/contracts";

export interface ProseSegment {
  readonly label: string;
  readonly text: string;
}

const segment = (label: string, value: unknown): ProseSegment | undefined =>
  typeof value === "string" && value.trim().length > 0 ? { label, text: value } : undefined;

const compact = (values: readonly (ProseSegment | undefined)[]): ProseSegment[] =>
  values.filter((value): value is ProseSegment => value !== undefined);

/** Customer-readable prose only; source quotations and machine fields stay out. */
export function proseSegments(type: ArtifactType, content: unknown): ProseSegment[] {
  const value = content as Record<string, unknown>;

  switch (type) {
    case "validation_report":
      return compact([segment("headline", value["headline"])]);

    case "strategy_memo": {
      const icp = value["icp"] as Record<string, unknown> | undefined;
      const differentiation = value["differentiation"] as Record<string, unknown> | undefined;
      return compact([
        segment("positioning statement", value["positioningStatement"]),
        segment("ICP portrait", icp?.["portrait"]),
        segment("differentiation", differentiation?.["statement"]),
        segment("accepted trade-off", differentiation?.["tradeoffAccepted"]),
      ]);
    }

    case "brand_system": {
      const voice = value["voice"] as Record<string, unknown> | undefined;
      const visual = value["visualDirection"] as Record<string, unknown> | undefined;
      const writes = Array.isArray(voice?.["writes"]) ? voice?.["writes"] : [];
      return compact([
        ...writes.map((text, index) => segment(`voice example ${index + 1}`, text)),
        segment("visual direction", visual?.["brief"]),
        segment("photography style", visual?.["photographyStyle"]),
      ]);
    }

    case "product_catalogue": {
      const products = (value["products"] as Record<string, unknown>[] | undefined) ?? [];
      const services = (value["services"] as Record<string, unknown>[] | undefined) ?? [];
      const deliverables = (value["digitalDeliverables"] as Record<string, unknown>[] | undefined) ?? [];
      return compact([
        ...products.flatMap((product, index) => [
          segment(`product ${index + 1} description`, product["description"]),
          segment(`product ${index + 1} short description`, product["shortDescription"]),
        ]),
        ...services.map((service, index) => segment(`service ${index + 1} description`, service["description"])),
        ...deliverables.flatMap((deliverable, index) =>
          ((deliverable["components"] as Record<string, unknown>[] | undefined) ?? []).map((component, componentIndex) =>
            segment(`deliverable ${index + 1}.${componentIndex + 1}`, component["description"]),
          ),
        ),
      ]);
    }

    case "supply_plan": {
      const tradeoff = value["tradeoff"] as Record<string, unknown> | undefined;
      const returns = value["returnsPolicy"] as Record<string, unknown> | undefined;
      return compact([
        segment("fulfilment reasoning", tradeoff?.["reasoning"]),
        segment("returns condition", returns?.["condition"]),
      ]);
    }

    case "fulfilment_tradeoff":
      return compact([segment("fulfilment reasoning", value["reasoning"]), segment("change condition", value["wouldChangeIf"])]);

    case "content_set": {
      const pages = (value["pages"] as Record<string, unknown>[] | undefined) ?? [];
      const products = (value["productDescriptions"] as Record<string, unknown>[] | undefined) ?? [];
      const sequences = (value["emailSequences"] as Record<string, unknown>[] | undefined) ?? [];
      const posts = (value["launchPosts"] as Record<string, unknown>[] | undefined) ?? [];
      const copyText = (copy: unknown): unknown => (copy as Record<string, unknown> | undefined)?.["text"];
      return compact([
        ...pages.flatMap((page, pageIndex) =>
          ((page["blocks"] as Record<string, unknown>[] | undefined) ?? []).map((block, blockIndex) =>
            segment(`page ${pageIndex + 1}.${blockIndex + 1}`, block["text"]),
          ),
        ),
        ...products.map((item, index) => segment(`product copy ${index + 1}`, copyText(item["copy"]))),
        ...sequences.flatMap((sequence, sequenceIndex) =>
          ((sequence["messages"] as Record<string, unknown>[] | undefined) ?? []).flatMap((message, messageIndex) => [
            segment(`email ${sequenceIndex + 1}.${messageIndex + 1} subject`, copyText(message["subject"])),
            segment(`email ${sequenceIndex + 1}.${messageIndex + 1} body`, copyText(message["body"])),
          ]),
        ),
        ...posts.map((post, index) => segment(`launch post ${index + 1}`, copyText(post["copy"]))),
      ]);
    }

    case "policy_set":
      return compact(
        ((value["policies"] as Record<string, unknown>[] | undefined) ?? []).map((policy, index) =>
          segment(`policy ${index + 1}`, policy["body"]),
        ),
      );

    case "operating_digest":
      return compact([segment("operator narrative", value["narrative"])]);

    default:
      return [];
  }
}
