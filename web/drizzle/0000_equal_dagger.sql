CREATE TYPE "public"."invite_status" AS ENUM('pending', 'redeemed', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."league_role" AS ENUM('owner', 'administrator', 'commissioner', 'manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."league_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('draft', 'active', 'complete', 'archived');--> statement-breakpoint
CREATE TABLE "audit_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid,
	"actor_person_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conferences_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "discord_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"username" text NOT NULL,
	"avatar_hash" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"conference_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" text NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"source_content_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" "league_role" NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"redeemed_by_person_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_membership_roles" (
	"league_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "league_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_person_id" uuid,
	CONSTRAINT "league_membership_roles_league_id_person_id_role_pk" PRIMARY KEY("league_id","person_id","role")
);
--> statement-breakpoint
CREATE TABLE "league_memberships" (
	"league_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "league_memberships_league_id_person_id_pk" PRIMARY KEY("league_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "league_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_teams_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "league_status" DEFAULT 'active' NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_hash" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier" text NOT NULL,
	"invitation_id" uuid,
	"return_to" text DEFAULT '/' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"is_site_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_settings" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"league_visible" boolean DEFAULT false NOT NULL,
	"standings_visible" boolean DEFAULT false NOT NULL,
	"stats_visible" boolean DEFAULT false NOT NULL,
	"draft_visible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "season_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"game_venue_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_league_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_identities" ADD CONSTRAINT "discord_identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_league_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_league_conference_fk" FOREIGN KEY ("league_id","conference_id") REFERENCES "public"."conferences"("league_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_references" ADD CONSTRAINT "import_references_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_person_id_people_id_fk" FOREIGN KEY ("redeemed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_membership_roles" ADD CONSTRAINT "league_membership_roles_granted_by_person_id_people_id_fk" FOREIGN KEY ("granted_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_membership_roles" ADD CONSTRAINT "league_membership_roles_membership_fk" FOREIGN KEY ("league_id","person_id") REFERENCES "public"."league_memberships"("league_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_settings" ADD CONSTRAINT "publication_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_credentials" ADD CONSTRAINT "runner_credentials_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_credentials" ADD CONSTRAINT "runner_credentials_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_records_league_occurred_at_index" ON "audit_records" USING btree ("league_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_records_actor_occurred_at_index" ON "audit_records" USING btree ("actor_person_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conferences_league_season_slug_unique" ON "conferences" USING btree ("league_id","season_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_identities_discord_user_id_unique" ON "discord_identities" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "discord_identities_person_id_index" ON "discord_identities" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_league_season_slug_unique" ON "divisions" USING btree ("league_id","season_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "import_references_source_identity_unique" ON "import_references" USING btree ("league_id","source","source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "import_references_target_index" ON "import_references" USING btree ("league_id","target_entity_type","target_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_league_id_index" ON "invitations" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_memberships_person_id_index" ON "league_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_teams_league_season_slug_unique" ON "league_teams" USING btree ("league_id","season_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_attempts_transaction_hash_unique" ON "oauth_attempts" USING btree ("transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_attempts_state_hash_unique" ON "oauth_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_credentials_league_id_name_unique" ON "runner_credentials" USING btree ("league_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_league_id_slug_unique" ON "seasons" USING btree ("league_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_person_id_index" ON "sessions" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_league_id_slug_unique" ON "venues" USING btree ("league_id","slug");