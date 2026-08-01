ALTER TABLE "job_queue" ALTER COLUMN "attempts" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "attempts" SET DATA TYPE integer USING attempts::integer;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "attempts" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "max_attempts" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "max_attempts" SET DATA TYPE integer USING max_attempts::integer;--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "max_attempts" SET DEFAULT 3;--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_idempotency_idx" ON "job_queue" USING btree ("name","idempotency_key");
