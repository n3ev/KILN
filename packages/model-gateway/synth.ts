import { SyntheticResponseFailure } from "@kiln/contracts";
import { z } from "zod";
import { createRng, type Rng } from "./rng.js";
import { synthNumber, synthString, type FieldHint } from "./templates.js";

/**
 * Schema-driven response synthesis.
 *
 * On a fixture miss the mock provider must still return something *schema-valid
 * and coherent*, so an unseen input produces a run you can look at rather than
 * a stack trace. This walks the Zod type and builds a value that satisfies it.
 *
 * The contract is strict, and deliberately so (CLAUDE.md §7): if synthesis
 * cannot satisfy the schema — a recursive type, an impossible refinement, an
 * unresolvable union — it throws `SyntheticResponseFailure` carrying the schema
 * path that defeated it. It must never return partially-valid data, because
 * partially-valid data fails three layers downstream where nobody can tell why.
 */

const MAX_DEPTH = 12;
const SYNTHETIC_X25519_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VuAyEAn1FuCta3tgc6Ho+NDPiErhtYV4x5ofDIv7QiFxWdY3I=",
  "-----END PUBLIC KEY-----",
].join("\n");

interface Ctx {
  readonly seed: string;
  readonly path: string[];
  readonly depth: number;
  readonly rng: Rng;
}

const def = (schema: z.ZodTypeAny): { typeName: string; [k: string]: unknown } =>
  (schema as unknown as { _def: { typeName: string } })._def as { typeName: string };

const pathOf = (ctx: Ctx): string => (ctx.path.length === 0 ? "(root)" : ctx.path.join("."));

function fail(ctx: Ctx, reason: string): never {
  throw new SyntheticResponseFailure(pathOf(ctx), reason, { seed: ctx.seed });
}

function child(ctx: Ctx, key: string): Ctx {
  return {
    seed: ctx.seed,
    path: [...ctx.path, key],
    depth: ctx.depth + 1,
    rng: createRng(`${ctx.seed}::${[...ctx.path, key].join(".")}`),
  };
}

interface StringChecks {
  min?: number;
  max?: number;
  length?: number;
  kind?: "email" | "url" | "uuid" | "datetime" | "regex" | "startsWith" | "endsWith";
  regex?: RegExp;
  startsWith?: string;
}

function readStringChecks(schema: z.ZodTypeAny): StringChecks {
  const checks = (def(schema)["checks"] as { kind: string; value?: unknown; regex?: RegExp }[]) ?? [];
  const out: StringChecks = {};
  for (const c of checks) {
    if (c.kind === "min") out.min = c.value as number;
    else if (c.kind === "max") out.max = c.value as number;
    else if (c.kind === "length") out.length = c.value as number;
    else if (c.kind === "regex") {
      out.kind = "regex";
      out.regex = c.regex;
    } else if (c.kind === "startsWith") {
      out.kind = "startsWith";
      out.startsWith = c.value as string;
    } else if (["email", "url", "uuid", "datetime"].includes(c.kind)) {
      out.kind = c.kind as StringChecks["kind"];
    }
  }
  return out;
}

function uuidFrom(rng: Rng): string {
  const hex = (n: number): string =>
    Array.from({ length: n }, () => "0123456789abcdef"[rng.int(0, 15)] ?? "0").join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[rng.int(0, 3)] ?? "8"}${hex(3)}-${hex(12)}`;
}

function synthesizeString(schema: z.ZodTypeAny, ctx: Ctx): string {
  const checks = readStringChecks(schema);
  const key = ctx.path[ctx.path.length - 1] ?? "value";
  if (key === "publicKeyPem" || key === "ephemeralPublicKeyPem") return SYNTHETIC_X25519_PUBLIC_KEY;

  switch (checks.kind) {
    case "uuid":
      return uuidFrom(ctx.rng);
    case "datetime":
      return new Date(Date.UTC(2026, 6, 1 + ctx.rng.int(0, 27), ctx.rng.int(0, 23))).toISOString();
    case "email":
      return `hello@${ctx.rng.pick(["kilnworks", "emberstudio", "quarrygoods"])}.co`;
    case "url":
      return `https://${ctx.rng.pick(["example-supplier", "trade-directory"])}.co/${ctx.rng.int(100, 999)}`;
    case "startsWith": {
      const prefix = checks.startsWith ?? "/";
      return `${prefix}${ctx.rng.pick(["shop", "about", "contact", "faq"])}`;
    }
    case "regex":
      return satisfyRegex(checks.regex, ctx);
    default:
      break;
  }

  if (checks.length !== undefined) {
    // Fixed-length strings are hashes and country codes, not prose.
    if (checks.length === 2) return ctx.rng.pick(["GB", "US", "PT", "DE", "IE"]);
    return Array.from({ length: checks.length }, () => "0123456789abcdef"[ctx.rng.int(0, 15)] ?? "0").join("");
  }

  const hint: FieldHint = {
    key,
    path: ctx.path,
    rng: ctx.rng,
    ...(checks.min !== undefined ? { minLength: checks.min } : {}),
    ...(checks.max !== undefined ? { maxLength: checks.max } : {}),
  };
  return synthString(hint);
}

/**
 * Handles the handful of regex shapes KILN's own contracts actually use
 * (kebab-case slugs, country codes, locales). A general regex solver is not
 * worth building; an unrecognised pattern fails loudly instead of silently
 * emitting a value that will be rejected two layers up.
 */
function satisfyRegex(regex: RegExp | undefined, ctx: Ctx): string {
  if (!regex) fail(ctx, "regex check present with no pattern");
  const candidates = [
    "stoneware-holder",
    "brass-stand",
    "GB",
    "en",
    "en-GB",
    "small-batch-ceramics",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ];
  const match = candidates.find((c) => regex.test(c));
  if (match !== undefined) return match;
  fail(ctx, `cannot synthesise a string matching ${regex.source}`);
}

function synthesizeNumber(schema: z.ZodTypeAny, ctx: Ctx): number {
  const checks = (def(schema)["checks"] as { kind: string; value?: number; inclusive?: boolean }[]) ?? [];
  const key = ctx.path[ctx.path.length - 1] ?? "value";
  let value = synthNumber(key, ctx.rng);

  let min: number | undefined;
  let max: number | undefined;
  let isInt = false;
  for (const c of checks) {
    if (c.kind === "min") min = c.value;
    else if (c.kind === "max") max = c.value;
    else if (c.kind === "int") isInt = true;
  }

  // Critic rubric scores are integer 0–5 values. Generic `score` fields are
  // otherwise treated like confidence values (0–1), which made every
  // synthetic CritiqueVerdict fail by construction and meant an offline run
  // could never get past its first reviewed artifact.
  if (key === "score" && isInt && max === 5) {
    value = ctx.rng.int(Math.max(4, Math.ceil(min ?? 0)), 5);
  }

  if (min !== undefined && max !== undefined && min > max) {
    fail(ctx, `impossible numeric bounds: min ${min} > max ${max}`);
  }
  if (min !== undefined) value = Math.max(value, min);
  if (max !== undefined) value = Math.min(value, max);
  if (isInt) value = Math.round(value);
  if (min !== undefined && value < min) value = isInt ? Math.ceil(min) : min;
  if (max !== undefined && value > max) value = isInt ? Math.floor(max) : max;
  return value;
}

function enumValue(values: readonly string[], ctx: Ctx): string {
  const key = ctx.path[ctx.path.length - 1] ?? "";

  if (key === "status" && values.includes("clear")) return "clear";

  if (key === "kind" && ctx.path.includes("policies")) {
    const index = Number(ctx.path[ctx.path.length - 2] ?? 0);
    const required = ["privacy", "terms", "refunds"];
    const selected = required[index];
    if (selected && values.includes(selected)) return selected;
  }

  if (key === "role" && ctx.path.includes("images")) {
    const index = Number(ctx.path[ctx.path.length - 2] ?? 0);
    const roles = ["hero", "detail", "in-scene", "on-model", "scale", "packaging"];
    const selected = roles[index];
    if (selected && values.includes(selected)) return selected;
  }

  return ctx.rng.pick(values);
}

export function synthesizeValue(schema: z.ZodTypeAny, ctx: Ctx): unknown {
  if (ctx.depth > MAX_DEPTH) {
    fail(ctx, `exceeded depth ${MAX_DEPTH}; the schema is probably recursive`);
  }

  const d = def(schema);

  switch (d.typeName) {
    case "ZodString":
      return synthesizeString(schema, ctx);
    case "ZodNumber":
      return synthesizeNumber(schema, ctx);
    case "ZodBigInt":
      return BigInt(ctx.rng.int(1, 10_000));
    case "ZodBoolean": {
      const key = ctx.path[ctx.path.length - 1] ?? "";
      if (["passed", "footerLinked", "satisfied", "testModeVerified", "complete"].includes(key)) {
        return true;
      }
      return ctx.rng.bool(0.7);
    }
    case "ZodDate":
      return new Date(Date.UTC(2026, 6, 1 + ctx.rng.int(0, 27)));
    case "ZodLiteral":
      return d["value"];
    case "ZodEnum":
      return enumValue(d["values"] as string[], ctx);
    case "ZodNativeEnum": {
      const values = Object.values(d["values"] as Record<string, string | number>);
      return ctx.rng.pick(values);
    }
    case "ZodNull":
      return null;
    case "ZodUndefined":
    case "ZodVoid":
      return undefined;
    case "ZodAny":
    case "ZodUnknown":
      return synthString({ key: ctx.path[ctx.path.length - 1] ?? "value", path: ctx.path, rng: ctx.rng });
    case "ZodNever":
      fail(ctx, "z.never() can never be satisfied");
      break;

    case "ZodOptional": {
      // Populate optionals in normal structures so mock artifacts remain rich,
      // but terminate optional recursive branches. NavigationItem is recursive
      // through an optional children array; eagerly filling that branch forever
      // made StorefrontBuild impossible to synthesise.
      const inner = d["innerType"] as z.ZodTypeAny;
      if (ctx.depth >= 8 || def(inner).typeName === "ZodLazy") return undefined;
      return synthesizeValue(inner, ctx);
    }
    case "ZodNullable":
      return synthesizeValue(d["innerType"] as z.ZodTypeAny, ctx);
    case "ZodDefault":
      return synthesizeValue(d["innerType"] as z.ZodTypeAny, ctx);
    case "ZodCatch":
      return synthesizeValue(d["innerType"] as z.ZodTypeAny, ctx);
    case "ZodBranded":
      return synthesizeValue(d["type"] as z.ZodTypeAny, ctx);
    case "ZodReadonly":
      // Zod 3.25 calls this innerType; older releases used type.
      return synthesizeValue((d["innerType"] ?? d["type"]) as z.ZodTypeAny, ctx);
    case "ZodLazy":
      return synthesizeValue((d["getter"] as () => z.ZodTypeAny)(), { ...ctx, depth: ctx.depth + 3 });
    case "ZodPipeline":
      return synthesizeValue(d["in"] as z.ZodTypeAny, ctx);

    case "ZodEffects":
      // Refinements are validated by the caller's safeParse loop; transforms
      // are applied by parse() itself, so synthesising the input is correct.
      return synthesizeValue(d["schema"] as z.ZodTypeAny, ctx);

    case "ZodArray": {
      const inner = d["type"] as z.ZodTypeAny;
      const exact = d["exactLength"] as { value: number } | null;
      const minLen = (d["minLength"] as { value: number } | null)?.value ?? 0;
      const maxLen = (d["maxLength"] as { value: number } | null)?.value ?? Infinity;
      const key = ctx.path[ctx.path.length - 1] ?? "";
      const preferred = key === "policies" || key === "images" ? 3 : ctx.rng.int(2, 3);
      const target = exact?.value ?? Math.min(Math.max(minLen, preferred), maxLen === Infinity ? 3 : maxLen);
      return Array.from({ length: Math.max(0, target) }, (_, i) => synthesizeValue(inner, child(ctx, String(i))));
    }

    case "ZodTuple": {
      const items = d["items"] as z.ZodTypeAny[];
      return items.map((item, i) => synthesizeValue(item, child(ctx, String(i))));
    }

    case "ZodObject": {
      const shape = (d["shape"] as () => Record<string, z.ZodTypeAny>)();
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(shape)) {
        const generated = synthesizeValue(value, child(ctx, key));
        if (generated !== undefined) out[key] = generated;
      }
      return out;
    }

    case "ZodRecord": {
      const valueSchema = d["valueType"] as z.ZodTypeAny;
      const keys = ["primary", "secondary"];
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = synthesizeValue(valueSchema, child(ctx, k));
      return out;
    }

    case "ZodUnion": {
      const options = d["options"] as z.ZodTypeAny[];
      // Try each option rather than picking one, so a union containing a
      // ZodNever or an unsatisfiable branch still resolves.
      for (const option of options) {
        try {
          return synthesizeValue(option, ctx);
        } catch {
          continue;
        }
      }
      fail(ctx, `no branch of the union could be satisfied (${options.length} options)`);
      break;
    }

    case "ZodDiscriminatedUnion": {
      const options = d["options"] as z.ZodTypeAny[];
      const chosen = options[ctx.rng.int(0, options.length - 1)] ?? options[0];
      if (!chosen) fail(ctx, "discriminated union has no options");
      return synthesizeValue(chosen, ctx);
    }

    case "ZodIntersection": {
      const left = synthesizeValue(d["left"] as z.ZodTypeAny, ctx);
      const right = synthesizeValue(d["right"] as z.ZodTypeAny, ctx);
      if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
        return { ...left, ...right };
      }
      fail(ctx, "cannot intersect non-object types");
      break;
    }

    default:
      fail(ctx, `unsupported schema node ${d.typeName}`);
  }
}

/**
 * Generates a value and validates it against the schema, retrying with a
 * jittered seed when a refinement rejects the first attempt. Throws rather than
 * returning something invalid.
 */
export function synthesize<T extends z.ZodTypeAny>(schema: T, seed: string, attempts = 6): z.infer<T> {
  let lastIssue = "unknown";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctx: Ctx = {
      seed: `${seed}#${attempt}`,
      path: [],
      depth: 0,
      rng: createRng(`${seed}#${attempt}`),
    };
    const candidate = synthesizeValue(schema, ctx);
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data as z.infer<T>;

    const issue = parsed.error.issues[0];
    lastIssue = issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "unknown";
  }

  throw new SyntheticResponseFailure(
    lastIssue.split(":")[0] ?? "(root)",
    `no synthesised value satisfied the schema after ${attempts} attempts (last issue — ${lastIssue})`,
    { seed },
  );
}
