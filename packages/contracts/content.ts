import { z } from "zod";
import { Slug, Timestamp } from "./primitives.js";
import { SourceRef } from "./sources.js";

/**
 * Content Studio output.
 *
 * Every piece carries its slop-lint result. Copy cannot become an artifact
 * without a passing lint (CLAUDE.md §3.1), and storing the result alongside the
 * text means the Run Theatre can show *why* a draft was rejected rather than
 * silently swapping in a better one.
 */

export const SlopSeverity = z.enum(["block", "warn"]);

export const SlopFinding = z.object({
  rule: z.string().min(1),
  severity: SlopSeverity,
  message: z.string().min(1),
  /** Character offsets into the linted text, so the UI can highlight in place. */
  span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  excerpt: z.string(),
  /** Concrete instruction handed back to the generating agent. */
  rewriteInstruction: z.string().min(1),
});
export type SlopFinding = z.infer<typeof SlopFinding>;

export const LintResult = z.object({
  passed: z.boolean(),
  findings: z.array(SlopFinding).default([]),
  /** How many repair cycles this text needed. Three is the ceiling. */
  repairCycles: z.number().int().min(0).max(3).default(0),
  wordCount: z.number().int().nonnegative(),
  lintedAt: Timestamp,
});
export type LintResult = z.infer<typeof LintResult>;

export const CopyBlock = z.object({
  key: z.string().min(1),
  role: z.enum([
    "headline",
    "subhead",
    "body",
    "cta",
    "product-description",
    "meta",
    "microcopy",
    "email-subject",
    "email-body",
    "social-post",
  ]),
  text: z.string().min(1),
  lint: LintResult,
  /** Claims inside this block that needed evidence. */
  sources: z.array(SourceRef).default([]),
});
export type CopyBlock = z.infer<typeof CopyBlock>;

export const PageCopy = z.object({
  pageHandle: Slug,
  blocks: z.array(CopyBlock).min(1),
});

export const EmailMessage = z.object({
  key: z.string().min(1),
  subject: CopyBlock,
  preheader: z.string().min(1).max(140),
  body: CopyBlock,
  /** Days after the trigger. 0 = immediate. */
  delayDays: z.number().int().nonnegative(),
  trigger: z.enum(["signup", "purchase", "abandoned-cart", "post-delivery", "inactivity", "manual"]),
  goal: z.string().min(1),
});

export const EmailSequence = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  messages: z.array(EmailMessage).min(1),
});

export const SocialPost = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "linkedin", "pinterest", "facebook", "threads"]),
  copy: CopyBlock,
  /** Brief, not a generated asset — imagery is produced by the design tools. */
  imageBrief: z.string().optional(),
  scheduledFor: Timestamp.optional(),
});

export const ContentSet = z.object({
  pages: z.array(PageCopy).min(1),
  productDescriptions: z.array(z.object({ handle: Slug, copy: CopyBlock })).default([]),
  emailSequences: z.array(EmailSequence).default([]),
  launchPosts: z.array(SocialPost).default([]),
  /** Imagery instructions handed to the design tools, brand-constrained. */
  imageBriefs: z
    .array(
      z.object({
        key: z.string().min(1),
        brief: z.string().min(1),
        aspectRatio: z.string().min(1),
        negativePrompts: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** Aggregate lint state across everything above. False blocks the artifact. */
  allPassedLint: z.boolean(),
  generatedAt: Timestamp,
});
export type ContentSet = z.infer<typeof ContentSet>;
