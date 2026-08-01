ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "break_glass_key_algorithm" text;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "break_glass_key_fingerprint_sha256" text;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "break_glass_key_registered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD COLUMN IF NOT EXISTS "artifact_id" uuid REFERENCES "artifacts"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD COLUMN IF NOT EXISTS "recipient_key_fingerprint_sha256" text;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD COLUMN IF NOT EXISTS "envelope" jsonb;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'assembled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "break_glass_packets" ALTER COLUMN "algorithm" SET DEFAULT 'x25519-hkdf-sha256+a256gcm';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_artifact_idx" ON "break_glass_packets" ("artifact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_fingerprint_idx" ON "break_glass_packets" ("recipient_key_fingerprint_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "break_glass_venture_idempotency_idx" ON "break_glass_packets" ("venture_id", "idempotency_key");
