import { z } from "zod";

/**
 * Every environment variable KILN reads, in one place.
 *
 * The governing rule: an entirely empty environment must produce a valid
 * config. Anything that would require a key has a defined offline behaviour
 * rather than a default that fails at first use. If you add a variable here
 * and cannot describe its zero-value behaviour, it does not belong here.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "" || /^(?:0|1|true|false)$/i.test(v), {
      message: "expected one of: 0, 1, true, false",
    })
    .transform((v) => (v === undefined || v === "" ? fallback : v === "1" || v.toLowerCase() === "true"));

/** Optional boolean text whose unset state is significant to precedence. */
const optionalBoolText = z
  .string()
  .optional()
  .refine((v) => v === undefined || v === "" || /^(?:0|1|true|false)$/i.test(v), {
    message: "expected one of: 0, 1, true, false",
  });

const csv = (fallback: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ""
        ? [...fallback]
        : v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );

/** Parses a JSON env var, falling back rather than throwing on malformed input. */
const jsonRecord = <T>(schema: z.ZodType<T>, fallback: T) =>
  z
    .string()
    .optional()
    .transform((v, ctx): T => {
      if (v === undefined || v.trim() === "") return fallback;
      try {
        const parsed = schema.safeParse(JSON.parse(v));
        if (parsed.success) return parsed.data;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "malformed JSON env var; using fallback" });
        return fallback;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unparseable JSON env var; using fallback" });
        return fallback;
      }
    });

export const ProviderId = z.enum(["kimi", "deepseek", "mock"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ModelTier = z.enum(["deep", "fast", "cheap"]);
export type ModelTier = z.infer<typeof ModelTier>;

/**
 * Provider id -> tier -> concrete model id.
 *
 * Keyed loosely on purpose. Moonshot and DeepSeek both rename and retire model
 * ids on their own schedule, so an operator must be able to point a tier at
 * whatever is current without a code change, and an unknown key here should
 * warn rather than refuse to boot.
 */
const TierEntry = z.object({
  deep: z.string().optional(),
  fast: z.string().optional(),
  cheap: z.string().optional(),
});
const TierMap = z.record(z.string(), TierEntry).default({});

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ENCRYPTION_MASTER_KEY: z.string().optional(),

  /** Unset => embedded PGlite. See docs/adr/0005-sandbox-first-architecture.md. */
  DATABASE_URL: z.string().optional(),
  KILN_PGDATA: z.string().optional(),
  PGPOOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  MODEL_PROVIDER: ProviderId.default("mock"),
  MODEL_FALLBACK_ORDER: csv(["mock"]).pipe(z.array(ProviderId).min(1)),
  MODEL_TIER_MAP: jsonRecord(TierMap, {}),
  MODEL_RECORD: bool(false),
  MOCK_STREAM_JITTER_MS: z.coerce.number().int().min(0).max(100).optional(),
  KILN_MODEL_FIXTURES: z.string().optional(),
  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  KIMI_DEFAULT_MODEL: z.string().optional(),
  KIMI_MODEL_DEEP: z.string().optional(),
  KIMI_MODEL_FAST: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/v1"),
  DEEPSEEK_DEFAULT_MODEL: z.string().optional(),
  DEEPSEEK_MODEL_DEEP: z.string().optional(),
  DEEPSEEK_MODEL_FAST: z.string().optional(),

  /** Forces every tool through simulate(). Defaults on outside production. */
  KILN_SANDBOX: optionalBoolText,
  SANDBOX_MODE: optionalBoolText,
  DEMO_MODE: bool(true),
  ENABLE_MCP_SERVER: bool(true),
  MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  EGRESS_ALLOWLIST: csv([]),

  KEY_PROVIDER: z.enum(["local", "kms"]).default("local"),
  KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().optional(),
  KILN_KEYFILE: z.string().optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("kiln@localhost"),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  SHOPIFY_PARTNER_TOKEN: z.string().optional(),
  SHOPIFY_APP_KEY: z.string().optional(),
  SHOPIFY_APP_SECRET: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  NAMECHEAP_API_KEY: z.string().optional(),
  PRINTFUL_API_KEY: z.string().optional(),
  PRINTIFY_API_KEY: z.string().optional(),
  GELATO_API_KEY: z.string().optional(),
  CALCOM_API_KEY: z.string().optional(),
  SEARCH_API_KEY: z.string().optional(),
  IMAGE_API_KEY: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Concrete tier map: provider id -> tier -> model id. */
export type TierMapValue = Record<string, { deep?: string; fast?: string; cheap?: string }>;

/**
 * `MODEL_TIER_MAP` is narrowed here because Zod marks a key optional when its
 * *input* is optional, even though the transform always produces a value. The
 * override keeps every call site free of a `?? {}` that would never fire.
 */
export interface KilnConfig extends Omit<Env, "MODEL_TIER_MAP"> {
  readonly MODEL_TIER_MAP: TierMapValue;
  /** True when no DATABASE_URL was supplied and we are on embedded Postgres. */
  readonly embeddedDatabase: boolean;
  /** Resolved sandbox decision: explicit env wins, else on unless production. */
  readonly sandbox: boolean;
  /** Providers that actually have a usable credential, in fallback order. */
  readonly availableProviders: readonly ProviderId[];
}

let cached: KilnConfig | undefined;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): KilnConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // A malformed environment is a developer error, and the message needs to
    // say which variable — a bare ZodError here costs an hour of confusion.
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${detail}`);
  }
  const env = parsed.data;

  const hasKey: Record<ProviderId, boolean> = {
    kimi: Boolean(env.KIMI_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
    mock: true,
  };

  const requested = [
    ...new Set([env.MODEL_PROVIDER, ...env.MODEL_FALLBACK_ORDER.filter((p) => p !== env.MODEL_PROVIDER)]),
  ];
  const available = requested.filter((p) => hasKey[p]);
  // The chain always terminates at mock so a run degrades instead of dying.
  const availableProviders: ProviderId[] = available.includes("mock") ? available : [...available, "mock"];

  return {
    ...env,
    MODEL_TIER_MAP: env.MODEL_TIER_MAP ?? {},
    embeddedDatabase: !env.DATABASE_URL,
    sandbox: (() => {
      const raw = env.KILN_SANDBOX ?? env.SANDBOX_MODE;
      return raw === undefined || raw === ""
        ? env.NODE_ENV !== "production"
        : raw === "1" || raw.toLowerCase() === "true";
    })(),
    availableProviders,
  };
}

export function config(): KilnConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test seam — resets the memoised config. */
export function resetConfigCache(): void {
  cached = undefined;
}
