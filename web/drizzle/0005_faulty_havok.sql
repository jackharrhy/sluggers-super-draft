CREATE TYPE "public"."attempt_lifecycle_event_type" AS ENUM('queued', 'claimed', 'renewed', 'started', 'completed', 'cancelled', 'failed', 'lease-expired', 'station-revoked');--> statement-breakpoint
CREATE TYPE "public"."match_attempt_status" AS ENUM('queued', 'leased', 'running', 'provisional', 'confirmed', 'cancelled', 'failed', 'review');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'in_progress', 'provisional', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."runner_failure_kind" AS ENUM('game-crash', 'runner-crash', 'bridge-failure', 'build-failure');--> statement-breakpoint
CREATE TYPE "public"."runner_lease_status" AS ENUM('active', 'released', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."runner_runtime_state" AS ENUM('idle', 'preparing', 'running', 'recovering', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."runner_station_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "attempt_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_attempt_id" uuid NOT NULL,
	"runner_station_id" uuid,
	"event_type" "attempt_lifecycle_event_type" NOT NULL,
	"failure_kind" "runner_failure_kind",
	"observed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "match_attempt_status" DEFAULT 'queued' NOT NULL,
	"attempt_nonce" text NOT NULL,
	"required_game_build_sha256" text NOT NULL,
	"home_roster_revision_id" uuid NOT NULL,
	"home_lineup_revision_id" uuid NOT NULL,
	"away_roster_revision_id" uuid NOT NULL,
	"away_lineup_revision_id" uuid NOT NULL,
	"dynamic_rule_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_kind" "runner_failure_kind",
	"created_by_person_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_attempts_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "runner_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_attempt_id" uuid NOT NULL,
	"runner_station_id" uuid NOT NULL,
	"status" "runner_lease_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_renewed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_leases_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "runner_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "runner_station_status" DEFAULT 'active' NOT NULL,
	"capabilities" jsonb,
	"runtime_state" "runner_runtime_state" DEFAULT 'idle' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_stations_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
ALTER TABLE "runner_credentials" ADD COLUMN "station_id" uuid;--> statement-breakpoint
ALTER TABLE "lineup_revisions" ADD CONSTRAINT "lineup_revisions_league_id_id_unique" UNIQUE("league_id","id");--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_league_id_id_unique" UNIQUE("league_id","id");--> statement-breakpoint
ALTER TABLE "attempt_lifecycle_events" ADD CONSTRAINT "attempt_lifecycle_events_attempt_fk" FOREIGN KEY ("league_id","match_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_lifecycle_events" ADD CONSTRAINT "attempt_lifecycle_events_station_fk" FOREIGN KEY ("league_id","runner_station_id") REFERENCES "public"."runner_stations"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_match_fk" FOREIGN KEY ("league_id","match_id") REFERENCES "public"."matches"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_home_roster_fk" FOREIGN KEY ("league_id","home_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_home_lineup_fk" FOREIGN KEY ("league_id","home_lineup_revision_id") REFERENCES "public"."lineup_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_away_roster_fk" FOREIGN KEY ("league_id","away_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_away_lineup_fk" FOREIGN KEY ("league_id","away_lineup_revision_id") REFERENCES "public"."lineup_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_fk" FOREIGN KEY ("league_id","home_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_fk" FOREIGN KEY ("league_id","away_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_leases" ADD CONSTRAINT "runner_leases_attempt_fk" FOREIGN KEY ("league_id","match_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_leases" ADD CONSTRAINT "runner_leases_station_fk" FOREIGN KEY ("league_id","runner_station_id") REFERENCES "public"."runner_stations"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_stations" ADD CONSTRAINT "runner_stations_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_lifecycle_events_attempt_recorded_index" ON "attempt_lifecycle_events" USING btree ("league_id","match_attempt_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_attempts_match_number_unique" ON "match_attempts" USING btree ("league_id","match_id","attempt_number");--> statement-breakpoint
CREATE INDEX "match_attempts_league_status_created_index" ON "match_attempts" USING btree ("league_id","status","created_at");--> statement-breakpoint
CREATE INDEX "matches_league_status_scheduled_index" ON "matches" USING btree ("league_id","status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_leases_attempt_unique" ON "runner_leases" USING btree ("league_id","match_attempt_id");--> statement-breakpoint
CREATE INDEX "runner_leases_station_status_index" ON "runner_leases" USING btree ("league_id","runner_station_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_stations_league_id_name_unique" ON "runner_stations" USING btree ("league_id","name");--> statement-breakpoint
ALTER TABLE "runner_credentials" ADD CONSTRAINT "runner_credentials_station_fk" FOREIGN KEY ("league_id","station_id") REFERENCES "public"."runner_stations"("league_id","id") ON DELETE no action ON UPDATE no action;
