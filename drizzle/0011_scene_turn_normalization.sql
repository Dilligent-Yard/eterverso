CREATE TABLE "scene_turn_legacy_backups" (
	"scene_id" uuid PRIMARY KEY NOT NULL,
	"turns" jsonb NOT NULL,
	"legacy_sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_turn_legacy_backups_hash_check" CHECK (length(legacy_sha256) = 64)
);
--> statement-breakpoint
CREATE TABLE "scene_turn_migration_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"reason" varchar(80) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_turn_migration_issues_scene_ordinal_reason_key" UNIQUE("scene_id","ordinal","reason"),
	CONSTRAINT "scene_turn_migration_issues_ordinal_check" CHECK (ordinal >= 0)
);
--> statement-breakpoint
CREATE TABLE "scene_turn_migrations" (
	"scene_id" uuid PRIMARY KEY NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"legacy_sha256" varchar(64) NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_turn_migrations_count_check" CHECK (turn_count >= 0),
	CONSTRAINT "scene_turn_migrations_hash_check" CHECK (length(legacy_sha256) = 64)
);
--> statement-breakpoint
CREATE TABLE "scene_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"author_id" uuid,
	"legacy_author_label" text,
	"legacy_id" varchar(80),
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"presentation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_turns_scene_ordinal_key" UNIQUE("scene_id","ordinal"),
	CONSTRAINT "scene_turns_ordinal_check" CHECK (ordinal >= 0),
	CONSTRAINT "scene_turns_version_check" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "personagens" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "personagens" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki_posts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scene_turn_legacy_backups" ADD CONSTRAINT "scene_turn_legacy_backups_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "public"."wiki_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turn_migration_issues" ADD CONSTRAINT "scene_turn_migration_issues_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "public"."wiki_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turn_migrations" ADD CONSTRAINT "scene_turn_migrations_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "public"."wiki_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turns" ADD CONSTRAINT "scene_turns_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "public"."wiki_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_turns" ADD CONSTRAINT "scene_turns_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scene_turns_scene_legacy_id_key" ON "scene_turns" USING btree ("scene_id","legacy_id") WHERE legacy_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_scene_turns_author_id" ON "scene_turns" USING btree ("author_id");--> statement-breakpoint
ALTER TABLE "personagens" ADD CONSTRAINT "personagens_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "wiki_posts" ADD CONSTRAINT "wiki_posts_version_check" CHECK (version > 0);