CREATE TABLE "wiki_transfer_instances" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"instance_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_transfer_instances_singleton_check" CHECK (singleton),
	CONSTRAINT "wiki_transfer_instances_instance_id_key" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_transfer_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"bundle_sha256" varchar(64) NOT NULL,
	"bundle" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"preview_version" integer DEFAULT 1 NOT NULL,
	"preview_sha256" varchar(64) NOT NULL,
	"state" varchar(16) DEFAULT 'staged' NOT NULL,
	"commit_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "wiki_transfer_jobs_bundle_sha256_key" UNIQUE("bundle_sha256"),
	CONSTRAINT "wiki_transfer_jobs_preview_version_check" CHECK (preview_version > 0),
	CONSTRAINT "wiki_transfer_jobs_state_check" CHECK (state IN ('staged', 'committed')),
	CONSTRAINT "wiki_transfer_jobs_bundle_hash_check" CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wiki_transfer_jobs_preview_hash_check" CHECK (preview_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wiki_transfer_jobs_bundle_shape_check" CHECK (jsonb_typeof(bundle) = 'object' AND bundle->>'format' = 'AetherverseWikiBundleV1'),
	CONSTRAINT "wiki_transfer_jobs_preview_shape_check" CHECK (jsonb_typeof(preview) = 'object')
);
--> statement-breakpoint
CREATE TABLE "wiki_transfer_page_mappings" (
	"origin_id" uuid NOT NULL,
	"source_page_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"source_snapshot_sha256" varchar(64) NOT NULL,
	"target_page_id" uuid NOT NULL,
	"target_revision_id" uuid NOT NULL,
	"target_snapshot_sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_transfer_page_mappings_identity_key" PRIMARY KEY("origin_id", "source_page_id"),
	CONSTRAINT "wiki_transfer_page_mappings_target_page_key" UNIQUE("target_page_id"),
	CONSTRAINT "wiki_transfer_page_mappings_source_hash_check" CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wiki_transfer_page_mappings_target_hash_check" CHECK (target_snapshot_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "wiki_transfer_source_mappings" (
	"origin_id" uuid NOT NULL,
	"source_source_id" uuid NOT NULL,
	"source_record_sha256" varchar(64) NOT NULL,
	"target_source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_transfer_source_mappings_identity_key" PRIMARY KEY("origin_id", "source_source_id"),
	CONSTRAINT "wiki_transfer_source_mappings_hash_check" CHECK (source_record_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "wiki_transfer_jobs" ADD CONSTRAINT "wiki_transfer_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wiki_transfer_page_mappings" ADD CONSTRAINT "wiki_transfer_page_mappings_target_page_fkey" FOREIGN KEY ("target_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wiki_transfer_page_mappings" ADD CONSTRAINT "wiki_transfer_page_mappings_target_revision_fkey" FOREIGN KEY ("target_page_id", "target_revision_id") REFERENCES "public"."wiki_revisions"("page_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "wiki_transfer_source_mappings" ADD CONSTRAINT "wiki_transfer_source_mappings_target_source_fkey" FOREIGN KEY ("target_source_id") REFERENCES "public"."wiki_sources"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
