CREATE TABLE IF NOT EXISTS "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_id" varchar(50) NOT NULL,
	"title" varchar(250) NOT NULL,
	"short_title" varchar(150),
	"summary" text DEFAULT '',
	"color" varchar(50) DEFAULT 'Green',
	"era" varchar(50) DEFAULT 'Before Daare' NOT NULL,
	"start_date" varchar(100) NOT NULL,
	"end_date" varchar(100),
	"order_index" integer DEFAULT 0 NOT NULL,
	"tags" varchar(250) DEFAULT '',
	"story_arc" varchar(150) DEFAULT '',
	"characters" text DEFAULT '',
	"character_group" varchar(150) DEFAULT '',
	"location" varchar(150) DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timeline_events_era" ON "timeline_events" USING btree ("era");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timeline_events_order" ON "timeline_events" USING btree ("order_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_timeline_events_internal_id" ON "timeline_events" USING btree ("internal_id");
