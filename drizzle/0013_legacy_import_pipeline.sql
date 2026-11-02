CREATE TABLE "legacy_import_batches" (
	"job_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"batch_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_batches_job_number_key" UNIQUE("job_id","batch_number"),
	CONSTRAINT "legacy_import_batches_number_check" CHECK (batch_number BETWEEN 1 AND 100),
	CONSTRAINT "legacy_import_batches_hash_check" CHECK (batch_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "legacy_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"raw_snapshot_sha256" varchar(64) NOT NULL,
	"legacy_origin" varchar(200) NOT NULL,
	"batch_count" integer NOT NULL,
	"state" varchar(16) DEFAULT 'uploading' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_digest" varchar(64),
	"plan_hash" varchar(64),
	"plan" jsonb,
	"preview_report" jsonb,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "legacy_import_jobs_actor_source_export_key" UNIQUE("created_by","source_id","export_id"),
	CONSTRAINT "legacy_import_jobs_batch_count_check" CHECK (batch_count BETWEEN 1 AND 100),
	CONSTRAINT "legacy_import_jobs_version_check" CHECK (version > 0),
	CONSTRAINT "legacy_import_jobs_state_check" CHECK (state IN ('uploading', 'staged', 'previewed', 'committed', 'replay')),
	CONSTRAINT "legacy_import_jobs_raw_hash_check" CHECK (raw_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_jobs_content_digest_check" CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_import_jobs_plan_hash_check" CHECK (plan_hash IS NULL OR plan_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "legacy_import_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"raw_snapshot_sha256" varchar(64) NOT NULL,
	"origin_label" varchar(200) NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_provenance_identity_key" UNIQUE("import_id","source_id","raw_snapshot_sha256"),
	CONSTRAINT "legacy_import_provenance_raw_hash_check" CHECK (raw_snapshot_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "legacy_import_source_mappings" (
	"source_id" uuid NOT NULL,
	"resource_type" varchar(16) NOT NULL,
	"legacy_id" varchar(80) NOT NULL,
	"import_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_source_mappings_identity_key" UNIQUE("source_id","resource_type","legacy_id"),
	CONSTRAINT "legacy_import_source_mappings_type_check" CHECK (resource_type IN ('category', 'thread', 'post', 'character', 'scene', 'turn'))
);
--> statement-breakpoint
CREATE TABLE "legacy_import_targets" (
	"import_id" uuid NOT NULL,
	"resource_type" varchar(16) NOT NULL,
	"legacy_id" varchar(80) NOT NULL,
	"target_id" uuid NOT NULL,
	"author_id" uuid,
	"author_label" text,
	"legacy_created_at_text" text,
	"legacy_updated_at_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_targets_identity_key" UNIQUE("import_id","resource_type","legacy_id"),
	CONSTRAINT "legacy_import_targets_type_check" CHECK (resource_type IN ('category', 'thread', 'post', 'character', 'scene', 'turn'))
);
--> statement-breakpoint
CREATE TABLE "legacy_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"first_source_id" uuid NOT NULL,
	"first_export_id" uuid NOT NULL,
	"first_raw_snapshot_sha256" varchar(64) NOT NULL,
	"first_origin_label" varchar(200) NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_imports_content_digest_key" UNIQUE("content_digest"),
	CONSTRAINT "legacy_imports_content_digest_check" CHECK (content_digest ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legacy_imports_raw_hash_check" CHECK (first_raw_snapshot_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "legacy_import_batches" ADD CONSTRAINT "legacy_import_batches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."legacy_import_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_jobs" ADD CONSTRAINT "legacy_import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_jobs" ADD CONSTRAINT "legacy_import_jobs_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_provenance" ADD CONSTRAINT "legacy_import_provenance_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_provenance" ADD CONSTRAINT "legacy_import_provenance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_source_mappings" ADD CONSTRAINT "legacy_import_source_mappings_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_targets" ADD CONSTRAINT "legacy_import_targets_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_import_targets" ADD CONSTRAINT "legacy_import_targets_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_imports" ADD CONSTRAINT "legacy_imports_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;