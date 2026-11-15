ALTER TABLE "divisions" DROP CONSTRAINT "divisions_league_conference_fk";
--> statement-breakpoint
ALTER TABLE "league_teams" DROP CONSTRAINT "league_teams_league_conference_fk";
--> statement-breakpoint
ALTER TABLE "league_teams" DROP CONSTRAINT "league_teams_league_manager_fk";
--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_league_conference_fk" FOREIGN KEY ("league_id","conference_id") REFERENCES "public"."conferences"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_conference_fk" FOREIGN KEY ("league_id","conference_id") REFERENCES "public"."conferences"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_manager_fk" FOREIGN KEY ("league_id","manager_person_id") REFERENCES "public"."league_memberships"("league_id","person_id") ON DELETE no action ON UPDATE no action;