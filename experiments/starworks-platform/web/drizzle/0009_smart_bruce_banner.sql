CREATE TYPE "public"."chemistry_relationship" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TYPE "public"."draft_event_type" AS ENUM('created', 'started', 'paused', 'resumed', 'pick-made', 'pick-reversed', 'clock-expired', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."draft_order_mode" AS ENUM('snake', 'linear');--> statement-breakpoint
CREATE TYPE "public"."draft_pick_source" AS ENUM('manager', 'commissioner', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."draft_pick_status" AS ENUM('active', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('setup', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "draft_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" "draft_event_type" NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"team_id" uuid,
	"pick_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"pick_number" integer NOT NULL,
	"round_number" integer NOT NULL,
	"slot_position" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"picked_by_person_id" uuid NOT NULL,
	"source" "draft_pick_source" NOT NULL,
	"status" "draft_pick_status" DEFAULT 'active' NOT NULL,
	"reason" text,
	"selected_at" timestamp with time zone NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "draft_picks_league_id_id_unique" UNIQUE("league_id","id"),
	CONSTRAINT "draft_picks_number_check" CHECK ("draft_picks"."pick_number" > 0),
	CONSTRAINT "draft_picks_round_check" CHECK ("draft_picks"."round_number" > 0),
	CONSTRAINT "draft_picks_slot_check" CHECK ("draft_picks"."slot_position" > 0)
);
--> statement-breakpoint
CREATE TABLE "draft_queues" (
	"league_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"rank" integer NOT NULL,
	"updated_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_queues_league_id_draft_id_team_id_character_id_pk" PRIMARY KEY("league_id","draft_id","team_id","character_id"),
	CONSTRAINT "draft_queues_rank_check" CHECK ("draft_queues"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "draft_slots" (
	"league_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_slots_league_id_draft_id_position_pk" PRIMARY KEY("league_id","draft_id","position"),
	CONSTRAINT "draft_slots_position_check" CHECK ("draft_slots"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"stat_profile_revision_id" uuid NOT NULL,
	"game_id" text DEFAULT 'RMBE01' NOT NULL,
	"name" text NOT NULL,
	"status" "draft_status" DEFAULT 'setup' NOT NULL,
	"order_mode" "draft_order_mode" DEFAULT 'snake' NOT NULL,
	"rounds" integer NOT NULL,
	"pick_seconds" integer DEFAULT 120 NOT NULL,
	"current_pick_number" integer DEFAULT 1 NOT NULL,
	"turn_started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_league_id_id_unique" UNIQUE("league_id","id"),
	CONSTRAINT "drafts_rounds_check" CHECK ("drafts"."rounds" between 1 and 18),
	CONSTRAINT "drafts_pick_seconds_check" CHECK ("drafts"."pick_seconds" between 15 and 86400),
	CONSTRAINT "drafts_current_pick_check" CHECK ("drafts"."current_pick_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "game_character_chemistry" (
	"game_id" text NOT NULL,
	"character_a_id" text NOT NULL,
	"character_b_id" text NOT NULL,
	"relationship" "chemistry_relationship" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_character_chemistry_game_id_character_a_id_character_b_id_pk" PRIMARY KEY("game_id","character_a_id","character_b_id"),
	CONSTRAINT "game_character_chemistry_canonical_pair_check" CHECK ("game_character_chemistry"."character_a_id" < "game_character_chemistry"."character_b_id")
);
--> statement-breakpoint
CREATE TABLE "game_characters" (
	"game_id" text NOT NULL,
	"character_id" text NOT NULL,
	"display_name" text NOT NULL,
	"is_captain" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_characters_game_id_character_id_pk" PRIMARY KEY("game_id","character_id")
);
--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_draft_fk" FOREIGN KEY ("league_id","draft_id") REFERENCES "public"."drafts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_pick_fk" FOREIGN KEY ("league_id","pick_id") REFERENCES "public"."draft_picks"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "draft_events_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_picked_by_person_id_people_id_fk" FOREIGN KEY ("picked_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_fk" FOREIGN KEY ("league_id","draft_id") REFERENCES "public"."drafts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_slot_fk" FOREIGN KEY ("league_id","draft_id","slot_position") REFERENCES "public"."draft_slots"("league_id","draft_id","position") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_queues" ADD CONSTRAINT "draft_queues_updated_by_person_id_people_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_queues" ADD CONSTRAINT "draft_queues_draft_fk" FOREIGN KEY ("league_id","draft_id") REFERENCES "public"."drafts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_queues" ADD CONSTRAINT "draft_queues_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_slots" ADD CONSTRAINT "draft_slots_draft_fk" FOREIGN KEY ("league_id","draft_id") REFERENCES "public"."drafts"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_slots" ADD CONSTRAINT "draft_slots_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_stat_profile_revision_fk" FOREIGN KEY ("league_id","stat_profile_revision_id") REFERENCES "public"."stat_profile_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_character_chemistry" ADD CONSTRAINT "game_character_chemistry_character_a_fk" FOREIGN KEY ("game_id","character_a_id") REFERENCES "public"."game_characters"("game_id","character_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_character_chemistry" ADD CONSTRAINT "game_character_chemistry_character_b_fk" FOREIGN KEY ("game_id","character_b_id") REFERENCES "public"."game_characters"("game_id","character_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_events_draft_sequence_unique" ON "draft_events" USING btree ("league_id","draft_id","sequence");--> statement-breakpoint
CREATE INDEX "draft_events_draft_occurred_index" ON "draft_events" USING btree ("league_id","draft_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_active_number_unique" ON "draft_picks" USING btree ("league_id","draft_id","pick_number") WHERE "draft_picks"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_active_character_unique" ON "draft_picks" USING btree ("league_id","draft_id","character_id") WHERE "draft_picks"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "draft_queues_team_rank_unique" ON "draft_queues" USING btree ("league_id","draft_id","team_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_slots_draft_team_unique" ON "draft_slots" USING btree ("league_id","draft_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_league_season_name_unique" ON "drafts" USING btree ("league_id","season_id","name");--> statement-breakpoint
CREATE INDEX "game_characters_game_display_name_index" ON "game_characters" USING btree ("game_id","display_name");