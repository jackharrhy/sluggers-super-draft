CREATE TYPE "public"."discord_notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "discord_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"message" text NOT NULL,
	"status" "discord_notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_notification_outbox_attempts_check" CHECK ("discord_notification_outbox"."attempts" >= 0),
	CONSTRAINT "discord_notification_outbox_event_type_check" CHECK (length("discord_notification_outbox"."event_type") between 3 and 100),
	CONSTRAINT "discord_notification_outbox_message_check" CHECK (length("discord_notification_outbox"."message") between 1 and 1800)
);
--> statement-breakpoint
CREATE TABLE "discord_notification_settings" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"configured_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_notification_settings_channel_id_check" CHECK ("discord_notification_settings"."channel_id" ~ '^[0-9]{17,20}$')
);
--> statement-breakpoint
ALTER TABLE "discord_notification_outbox" ADD CONSTRAINT "discord_notification_outbox_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_notification_settings" ADD CONSTRAINT "discord_notification_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_notification_settings" ADD CONSTRAINT "discord_notification_settings_configured_by_person_id_people_id_fk" FOREIGN KEY ("configured_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_notification_outbox_dedupe_unique" ON "discord_notification_outbox" USING btree ("league_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "discord_notification_outbox_delivery_index" ON "discord_notification_outbox" USING btree ("league_id","status","created_at");