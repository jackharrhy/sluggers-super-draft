ALTER TABLE "league_teams" ADD COLUMN "conference_id" uuid;--> statement-breakpoint
ALTER TABLE "league_teams" ADD COLUMN "manager_person_id" uuid;--> statement-breakpoint
ALTER TABLE "league_teams" ADD COLUMN "abbreviation" text;--> statement-breakpoint
ALTER TABLE "league_teams" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_conference_fk" FOREIGN KEY ("league_id","conference_id") REFERENCES "public"."conferences"("league_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_manager_fk" FOREIGN KEY ("league_id","manager_person_id") REFERENCES "public"."league_memberships"("league_id","person_id") ON DELETE set null ON UPDATE no action;