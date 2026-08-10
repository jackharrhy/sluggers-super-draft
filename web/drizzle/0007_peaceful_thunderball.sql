ALTER TABLE "match_attempts" ADD COLUMN "correlation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "issued_at" timestamp with time zone;