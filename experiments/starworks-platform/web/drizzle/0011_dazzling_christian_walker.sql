CREATE TYPE "public"."telemetry_correction_entity" AS ENUM('team', 'character');--> statement-breakpoint
CREATE TYPE "public"."telemetry_derivation_status" AS ENUM('ready', 'review');--> statement-breakpoint
CREATE TYPE "public"."telemetry_observation_source" AS ENUM('bridge-hook', 'memory-observation', 'synthetic');--> statement-breakpoint
CREATE TABLE "telemetry_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_attempt_id" uuid NOT NULL,
	"entity_type" "telemetry_correction_entity" NOT NULL,
	"entity_id" text NOT NULL,
	"stat_path" text NOT NULL,
	"before_value" integer NOT NULL,
	"after_value" integer NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_corrections_reason_check" CHECK (length(trim("telemetry_corrections"."reason")) >= 3),
	CONSTRAINT "telemetry_corrections_path_check" CHECK ("telemetry_corrections"."stat_path" ~ '^[a-z][a-zA-Z0-9.]{1,99}$')
);
--> statement-breakpoint
CREATE TABLE "telemetry_derivations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"match_attempt_id" uuid NOT NULL,
	"derivation_version" integer NOT NULL,
	"input_digest" text NOT NULL,
	"status" "telemetry_derivation_status" NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"box_score" jsonb NOT NULL,
	"source_first_sequence" integer NOT NULL,
	"source_last_sequence" integer NOT NULL,
	"event_count" integer NOT NULL,
	"correction_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_derivations_version_check" CHECK ("telemetry_derivations"."derivation_version" > 0),
	CONSTRAINT "telemetry_derivations_digest_check" CHECK ("telemetry_derivations"."input_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "telemetry_derivations_sequences_check" CHECK ("telemetry_derivations"."source_first_sequence" > 0 and "telemetry_derivations"."source_last_sequence" >= "telemetry_derivations"."source_first_sequence"),
	CONSTRAINT "telemetry_derivations_counts_check" CHECK ("telemetry_derivations"."event_count" > 0 and "telemetry_derivations"."correction_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"league_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"match_attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"frame" integer NOT NULL,
	"protocol_version" integer NOT NULL,
	"correlation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"observation_source" "telemetry_observation_source" NOT NULL,
	"payload" jsonb NOT NULL,
	"adapter_version" text NOT NULL,
	"game_build_sha256" text NOT NULL,
	"state_fingerprint" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_events_league_id_match_attempt_id_sequence_pk" PRIMARY KEY("league_id","match_attempt_id","sequence"),
	CONSTRAINT "telemetry_events_positive_sequence_check" CHECK ("telemetry_events"."sequence" > 0),
	CONSTRAINT "telemetry_events_nonnegative_frame_check" CHECK ("telemetry_events"."frame" >= 0),
	CONSTRAINT "telemetry_events_protocol_version_check" CHECK ("telemetry_events"."protocol_version" > 0),
	CONSTRAINT "telemetry_events_build_hash_check" CHECK ("telemetry_events"."game_build_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_attempts" ADD COLUMN "confirmed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_attempt_fk" FOREIGN KEY ("league_id","match_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_derivations" ADD CONSTRAINT "telemetry_derivations_match_fk" FOREIGN KEY ("league_id","match_id") REFERENCES "public"."matches"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_derivations" ADD CONSTRAINT "telemetry_derivations_attempt_fk" FOREIGN KEY ("league_id","match_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_match_fk" FOREIGN KEY ("league_id","match_id") REFERENCES "public"."matches"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_attempt_fk" FOREIGN KEY ("league_id","match_attempt_id") REFERENCES "public"."match_attempts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_corrections_attempt_created_index" ON "telemetry_corrections" USING btree ("league_id","match_attempt_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_derivations_input_unique" ON "telemetry_derivations" USING btree ("league_id","match_attempt_id","derivation_version","input_digest");--> statement-breakpoint
CREATE INDEX "telemetry_derivations_attempt_created_index" ON "telemetry_derivations" USING btree ("league_id","match_attempt_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_attempt_frame_index" ON "telemetry_events" USING btree ("league_id","match_attempt_id","frame");--> statement-breakpoint
ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_confirmed_by_person_id_people_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;