CREATE TYPE "public"."league_deadline_kind" AS ENUM('trade', 'roster', 'lineup');--> statement-breakpoint
CREATE TYPE "public"."roster_transaction_kind" AS ENUM('trade', 'commissioner');--> statement-breakpoint
CREATE TYPE "public"."trade_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."trade_proposal_status" AS ENUM('pending', 'applied', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "league_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"kind" "league_deadline_kind" NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_deadlines_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
CREATE TABLE "roster_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"kind" "roster_transaction_kind" NOT NULL,
	"source_id" uuid,
	"character_id" text NOT NULL,
	"from_team_id" uuid,
	"to_team_id" uuid,
	"from_before_roster_revision_id" uuid,
	"from_after_roster_revision_id" uuid,
	"to_before_roster_revision_id" uuid,
	"to_after_roster_revision_id" uuid,
	"actor_person_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_transactions_team_change_check" CHECK ("roster_transactions"."from_team_id" is not null or "roster_transactions"."to_team_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "trade_approvals" (
	"league_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"decision" "trade_decision" NOT NULL,
	"decided_by_person_id" uuid NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trade_approvals_league_id_proposal_id_team_id_pk" PRIMARY KEY("league_id","proposal_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"league_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"from_team_id" uuid NOT NULL,
	"to_team_id" uuid NOT NULL,
	CONSTRAINT "trade_items_league_id_proposal_id_character_id_pk" PRIMARY KEY("league_id","proposal_id","character_id"),
	CONSTRAINT "trade_items_distinct_teams_check" CHECK ("trade_items"."from_team_id" <> "trade_items"."to_team_id")
);
--> statement-breakpoint
CREATE TABLE "trade_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"proposer_team_id" uuid NOT NULL,
	"counterparty_team_id" uuid NOT NULL,
	"status" "trade_proposal_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"proposed_by_person_id" uuid NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_proposals_league_id_id_unique" UNIQUE("league_id","id"),
	CONSTRAINT "trade_proposals_distinct_teams_check" CHECK ("trade_proposals"."proposer_team_id" <> "trade_proposals"."counterparty_team_id")
);
--> statement-breakpoint
ALTER TABLE "league_deadlines" ADD CONSTRAINT "league_deadlines_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_deadlines" ADD CONSTRAINT "league_deadlines_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_from_team_fk" FOREIGN KEY ("league_id","from_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_to_team_fk" FOREIGN KEY ("league_id","to_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_from_before_roster_fk" FOREIGN KEY ("league_id","from_before_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_from_after_roster_fk" FOREIGN KEY ("league_id","from_after_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_to_before_roster_fk" FOREIGN KEY ("league_id","to_before_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_transactions" ADD CONSTRAINT "roster_transactions_to_after_roster_fk" FOREIGN KEY ("league_id","to_after_roster_revision_id") REFERENCES "public"."roster_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_approvals" ADD CONSTRAINT "trade_approvals_decided_by_person_id_people_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_approvals" ADD CONSTRAINT "trade_approvals_proposal_fk" FOREIGN KEY ("league_id","proposal_id") REFERENCES "public"."trade_proposals"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_approvals" ADD CONSTRAINT "trade_approvals_team_fk" FOREIGN KEY ("league_id","team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_proposal_fk" FOREIGN KEY ("league_id","proposal_id") REFERENCES "public"."trade_proposals"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_from_team_fk" FOREIGN KEY ("league_id","from_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_to_team_fk" FOREIGN KEY ("league_id","to_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_proposed_by_person_id_people_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_season_fk" FOREIGN KEY ("league_id","season_id") REFERENCES "public"."seasons"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_proposer_team_fk" FOREIGN KEY ("league_id","proposer_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_counterparty_team_fk" FOREIGN KEY ("league_id","counterparty_team_id") REFERENCES "public"."league_teams"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "league_deadlines_season_kind_unique" ON "league_deadlines" USING btree ("league_id","season_id","kind");--> statement-breakpoint
CREATE INDEX "roster_transactions_league_occurred_index" ON "roster_transactions" USING btree ("league_id","occurred_at");--> statement-breakpoint
CREATE INDEX "trade_proposals_league_status_index" ON "trade_proposals" USING btree ("league_id","status","proposed_at");