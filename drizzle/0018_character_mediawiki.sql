ALTER TABLE "personagens" ADD COLUMN "content_mode" varchar(20) DEFAULT 'html' NOT NULL;
--> statement-breakpoint
ALTER TABLE "personagens" ADD COLUMN "wikitext" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "personagens" ADD COLUMN "custom_css" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "personagens" ADD CONSTRAINT "personagens_content_mode_check" CHECK ("content_mode" IN ('html', 'wikitext'));
--> statement-breakpoint
CREATE TABLE "character_mw_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"name_key" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_mw_resources_kind_name_key" UNIQUE("kind","name_key"),
	CONSTRAINT "character_mw_resources_kind_check" CHECK ("kind" IN ('template', 'lua', 'css')),
	CONSTRAINT "character_mw_resources_name_check" CHECK (length(trim("name")) > 0),
	CONSTRAINT "character_mw_resources_version_check" CHECK ("version" > 0),
	CONSTRAINT "character_mw_resources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "character_mw_resources_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_character_mw_resources_kind_key" ON "character_mw_resources" USING btree ("kind", "name_key");
