import { z } from "zod";

/** Branded id helper — keeps a VentureId from being passed where a RunId goes. */
const id = <B extends string>(brand: B) => z.string().uuid().brand<B>();

export const AccountId = id("AccountId");
export const UserId = id("UserId");
export const VentureId = id("VentureId");
export const RunId = id("RunId");
export const PhaseId = id("PhaseId");
export const TaskId = id("TaskId");
export const ArtifactId = id("ArtifactId");
export const CheckpointId = id("CheckpointId");
export const DirectiveId = id("DirectiveId");
export const AssetId = id("AssetId");
export const ToolCallId = id("ToolCallId");
export const AuthorisationId = id("AuthorisationId");

export type AccountId = z.infer<typeof AccountId>;
export type UserId = z.infer<typeof UserId>;
export type VentureId = z.infer<typeof VentureId>;
export type RunId = z.infer<typeof RunId>;
export type PhaseId = z.infer<typeof PhaseId>;
export type TaskId = z.infer<typeof TaskId>;
export type ArtifactId = z.infer<typeof ArtifactId>;
export type CheckpointId = z.infer<typeof CheckpointId>;
export type DirectiveId = z.infer<typeof DirectiveId>;
export type AssetId = z.infer<typeof AssetId>;
export type ToolCallId = z.infer<typeof ToolCallId>;
export type AuthorisationId = z.infer<typeof AuthorisationId>;

/**
 * All money is integer micros — millionths of one currency unit.
 * 1 USD = 1_000_000 micros. Never a float, never a string, never "cents"
 * except at the Stripe boundary where the API demands them.
 */
export const Micros = z.number().int().finite();
export type Micros = z.infer<typeof Micros>;

export const Cents = z.number().int().finite();
export type Cents = z.infer<typeof Cents>;

export const Currency = z.enum(["USD", "GBP", "EUR", "CAD", "AUD"]);
export type Currency = z.infer<typeof Currency>;

export const Money = z.object({
  micros: Micros,
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

export const centsToMicros = (cents: number): number => Math.round(cents) * 10_000;
export const microsToCents = (micros: number): number => Math.round(micros / 10_000);

/** ISO-8601 instant. Stored as text in JSON contracts, timestamptz in Postgres. */
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase kebab-case");
export type Slug = z.infer<typeof Slug>;

export const Archetype = z.enum(["physical", "digital", "service"]);
export type Archetype = z.infer<typeof Archetype>;

export const Autonomy = z.enum(["supervised", "guided", "autonomous"]);
export type Autonomy = z.infer<typeof Autonomy>;

export const OwnershipMode = z.enum(["managed", "delegated", "transferred"]);
export type OwnershipMode = z.infer<typeof OwnershipMode>;

/** A 0–1 confidence. Used anywhere a model asserts something it cannot prove. */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

export const Percent = z.number().min(0).max(100);
export type Percent = z.infer<typeof Percent>;

/** ISO-3166-1 alpha-2, used for jurisdiction routing in compliance. */
export const CountryCode = z.string().length(2).regex(/^[A-Z]{2}$/);
export type CountryCode = z.infer<typeof CountryCode>;

export const LocaleCode = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export type LocaleCode = z.infer<typeof LocaleCode>;
