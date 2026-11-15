ALTER TABLE "match_attempts" ADD COLUMN "execution_mode" text DEFAULT 'cpu-vs-cpu' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "game_stadium_id" text DEFAULT 'mario-stadium' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_fk" FOREIGN KEY ("league_id","venue_id") REFERENCES "public"."venues"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_execution_mode_check" CHECK ("match_attempts"."execution_mode" = 'cpu-vs-cpu');--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_game_stadium_check" CHECK ("match_attempts"."game_stadium_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$');