CREATE TABLE "content_assets" (
	"league_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"display_name" text NOT NULL,
	"uploaded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_assets_league_id_sha256_pk" PRIMARY KEY("league_id","sha256"),
	CONSTRAINT "content_assets_sha256_check" CHECK ("content_assets"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "content_assets_size_check" CHECK ("content_assets"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_pack_asset_assignments" (
	"league_id" uuid NOT NULL,
	"content_pack_revision_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"slot" text NOT NULL,
	"asset_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pack_asset_assignments_league_id_content_pack_revision_id_character_id_slot_pk" PRIMARY KEY("league_id","content_pack_revision_id","character_id","slot"),
	CONSTRAINT "content_pack_asset_assignments_slot_check" CHECK ("content_pack_asset_assignments"."slot" in ('icon', 'portrait', 'model', 'texture'))
);
--> statement-breakpoint
CREATE TABLE "content_pack_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"content_pack_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "revision_status" DEFAULT 'draft' NOT NULL,
	"stat_profile_revision_id" uuid NOT NULL,
	"ruleset_revision_id" uuid NOT NULL,
	"adapter_version" text NOT NULL,
	"main_dol_sha256" text NOT NULL,
	"stat_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb,
	"manifest_sha256" text,
	"based_on_revision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "content_pack_revisions_league_id_id_unique" UNIQUE("league_id","id"),
	CONSTRAINT "content_pack_revisions_number_check" CHECK ("content_pack_revisions"."revision_number" > 0),
	CONSTRAINT "content_pack_revisions_dol_hash_check" CHECK ("content_pack_revisions"."main_dol_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "content_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_packs_league_id_id_unique" UNIQUE("league_id","id")
);
--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_uploaded_by_person_id_people_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_asset_assignments" ADD CONSTRAINT "content_pack_asset_assignments_revision_fk" FOREIGN KEY ("league_id","content_pack_revision_id") REFERENCES "public"."content_pack_revisions"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_asset_assignments" ADD CONSTRAINT "content_pack_asset_assignments_asset_fk" FOREIGN KEY ("league_id","asset_sha256") REFERENCES "public"."content_assets"("league_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_revisions" ADD CONSTRAINT "content_pack_revisions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_revisions" ADD CONSTRAINT "content_pack_revisions_pack_fk" FOREIGN KEY ("league_id","content_pack_id") REFERENCES "public"."content_packs"("league_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_revisions" ADD CONSTRAINT "content_pack_revisions_stat_profile_fk" FOREIGN KEY ("league_id","stat_profile_revision_id") REFERENCES "public"."stat_profile_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_revisions" ADD CONSTRAINT "content_pack_revisions_ruleset_fk" FOREIGN KEY ("league_id","ruleset_revision_id") REFERENCES "public"."ruleset_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_revisions" ADD CONSTRAINT "content_pack_revisions_based_on_fk" FOREIGN KEY ("league_id","based_on_revision_id") REFERENCES "public"."content_pack_revisions"("league_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_object_key_unique" ON "content_assets" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pack_revisions_number_unique" ON "content_pack_revisions" USING btree ("league_id","content_pack_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "content_packs_league_slug_unique" ON "content_packs" USING btree ("league_id","slug");--> statement-breakpoint
CREATE TRIGGER content_pack_revisions_immutable
	BEFORE UPDATE OR DELETE ON "content_pack_revisions"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_revision_mutation();--> statement-breakpoint
CREATE FUNCTION prevent_published_content_assignment_mutation() RETURNS trigger AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM content_pack_revisions
		WHERE league_id = COALESCE(OLD.league_id, NEW.league_id)
			AND id = COALESCE(OLD.content_pack_revision_id, NEW.content_pack_revision_id)
			AND status = 'published'
	) THEN
		RAISE EXCEPTION 'published content-pack assignments are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER content_pack_asset_assignments_immutable
	BEFORE INSERT OR UPDATE OR DELETE ON "content_pack_asset_assignments"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_content_assignment_mutation();
