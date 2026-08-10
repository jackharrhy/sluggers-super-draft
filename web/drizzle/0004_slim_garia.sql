CREATE TYPE "public"."revision_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "lineup_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"roster_revision_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "revision_status" DEFAULT 'draft' NOT NULL,
	"lineup" jsonb NOT NULL,
	"based_on_revision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "lineup_revisions_league_team_id_unique" UNIQUE("league_id","team_id","id")
);
--> statement-breakpoint
CREATE TABLE "match_lineup_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"base_lineup_revision_id" uuid NOT NULL,
	"effective_lineup" jsonb NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "revision_status" DEFAULT 'draft' NOT NULL,
	"roster_character_ids" jsonb NOT NULL,
	"based_on_revision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "roster_revisions_league_team_id_unique" UNIQUE("league_id","team_id","id")
);
--> statement-breakpoint
CREATE TABLE "ruleset_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "revision_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"based_on_revision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "ruleset_revisions_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "rulesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rulesets_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "stat_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "revision_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"definitions" jsonb NOT NULL,
	"character_values" jsonb NOT NULL,
	"based_on_revision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "stat_profile_revisions_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "stat_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stat_profiles_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
ALTER TABLE "lineup_revisions" ADD CONSTRAINT "lineup_revisions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_revisions" ADD CONSTRAINT "lineup_revisions_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_revisions" ADD CONSTRAINT "lineup_revisions_roster_fk" FOREIGN KEY ("league_id","team_id","roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","team_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_revisions" ADD CONSTRAINT "lineup_revisions_based_on_fk" FOREIGN KEY ("league_id","team_id","based_on_revision_id") REFERENCES "public"."lineup_revisions"("league_id","team_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineup_overrides" ADD CONSTRAINT "match_lineup_overrides_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_lineup_overrides" ADD CONSTRAINT "match_lineup_overrides_lineup_fk" FOREIGN KEY ("league_id","team_id","base_lineup_revision_id") REFERENCES "public"."lineup_revisions"("league_id","team_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_based_on_fk" FOREIGN KEY ("league_id","team_id","based_on_revision_id") REFERENCES "public"."roster_revisions"("league_id","team_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_revisions" ADD CONSTRAINT "ruleset_revisions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_revisions" ADD CONSTRAINT "ruleset_revisions_ruleset_fk" FOREIGN KEY ("league_id","ruleset_id") REFERENCES "public"."rulesets"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_revisions" ADD CONSTRAINT "ruleset_revisions_based_on_fk" FOREIGN KEY ("league_id","based_on_revision_id") REFERENCES "public"."ruleset_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulesets" ADD CONSTRAINT "rulesets_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_profile_revisions" ADD CONSTRAINT "stat_profile_revisions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_profile_revisions" ADD CONSTRAINT "stat_profile_revisions_profile_fk" FOREIGN KEY ("league_id","profile_id") REFERENCES "public"."stat_profiles"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_profile_revisions" ADD CONSTRAINT "stat_profile_revisions_based_on_fk" FOREIGN KEY ("league_id","based_on_revision_id") REFERENCES "public"."stat_profile_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_profiles" ADD CONSTRAINT "stat_profiles_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_revisions_team_number_unique" ON "lineup_revisions" USING btree ("league_id","team_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "match_lineup_overrides_match_team_unique" ON "match_lineup_overrides" USING btree ("league_id","match_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_revisions_team_number_unique" ON "roster_revisions" USING btree ("league_id","team_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ruleset_revisions_ruleset_number_unique" ON "ruleset_revisions" USING btree ("league_id","ruleset_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rulesets_league_id_slug_unique" ON "rulesets" USING btree ("league_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "stat_profile_revisions_profile_number_unique" ON "stat_profile_revisions" USING btree ("league_id","profile_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stat_profiles_league_id_slug_unique" ON "stat_profiles" USING btree ("league_id","slug");
--> statement-breakpoint
CREATE FUNCTION prevent_published_revision_mutation() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'published' THEN
		RAISE EXCEPTION 'published revisions are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stat_profile_revisions_immutable
	BEFORE UPDATE OR DELETE ON "stat_profile_revisions"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_revision_mutation();
--> statement-breakpoint
CREATE TRIGGER ruleset_revisions_immutable
	BEFORE UPDATE OR DELETE ON "ruleset_revisions"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_revision_mutation();
--> statement-breakpoint
CREATE TRIGGER roster_revisions_immutable
	BEFORE UPDATE OR DELETE ON "roster_revisions"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_revision_mutation();
--> statement-breakpoint
CREATE TRIGGER lineup_revisions_immutable
	BEFORE UPDATE OR DELETE ON "lineup_revisions"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_revision_mutation();
