ALTER TABLE "match_attempts" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "replaces_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "confirmation_source" text;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_replaces_attempt_fk" FOREIGN KEY ("league_id","replaces_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_retry_count_check" CHECK ("match_attempts"."retry_count" >= 0 and "match_attempts"."retry_count" <= 1);--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_confirmation_source_check" CHECK ("match_attempts"."confirmation_source" is null or "match_attempts"."confirmation_source" in ('manual', 'system'));