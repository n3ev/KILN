DO $$ BEGIN
  CREATE TYPE "public"."kyc_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."abuse_review_status" AS ENUM('pending', 'cleared', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "kyc_status" "kyc_status" DEFAULT 'unverified' NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "kyc_verified_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "abuse_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE cascade,
  "venture_id" uuid NOT NULL REFERENCES "ventures"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "reason" text NOT NULL,
  "status" "abuse_review_status" DEFAULT 'pending' NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "decision_note" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abuse_reviews_run_category_idx" ON "abuse_reviews" ("run_id", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reviews_account_status_idx" ON "abuse_reviews" ("account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reviews_created_idx" ON "abuse_reviews" ("created_at");
