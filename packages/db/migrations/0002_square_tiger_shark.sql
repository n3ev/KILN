CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"last_error" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "stripe_events_status_idx" ON "stripe_events" USING btree ("status","created_at");