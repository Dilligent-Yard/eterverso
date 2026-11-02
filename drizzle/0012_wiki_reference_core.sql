CREATE TABLE "wiki_names" (
	"name_key" varchar(100) PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_names_kind_check" CHECK (kind IN ('canonical', 'alias', 'historical')),
	CONSTRAINT "wiki_names_key_check" CHECK (name_key ~ '^[a-z0-9][a-z0-9-]{0,99}$')
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"head_revision_id" uuid,
	"published_revision_id" uuid,
	"work_version" integer DEFAULT 1 NOT NULL,
	"public_version" integer DEFAULT 0 NOT NULL,
	"access_level" varchar(16) DEFAULT 'staff' NOT NULL,
	"archived_at" timestamp with time zone,
	"discussion_thread_id" uuid,
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_id_key" UNIQUE("id"),
	CONSTRAINT "wiki_pages_work_version_check" CHECK (work_version > 0),
	CONSTRAINT "wiki_pages_public_version_check" CHECK (public_version >= 0),
	CONSTRAINT "wiki_pages_access_level_check" CHECK (access_level IN ('public', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "wiki_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"proposer_id" uuid NOT NULL,
	"base_published_revision_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"edit_summary" varchar(1000) NOT NULL,
	"state" varchar(16) DEFAULT 'submitted' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_proposal_id" uuid,
	"review_reason" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_proposals_page_id_id_key" UNIQUE("page_id","id"),
	CONSTRAINT "wiki_proposals_state_check" CHECK (state IN ('submitted', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "wiki_proposals_version_check" CHECK (version > 0),
	CONSTRAINT "wiki_proposals_snapshot_version_check" CHECK (jsonb_typeof(snapshot) = 'object' AND snapshot->>'schemaVersion' = '1')
);
--> statement-breakpoint
CREATE TABLE "wiki_revision_categories" (
	"revision_id" uuid NOT NULL,
	"category" varchar(100) NOT NULL,
	"category_key" varchar(100) NOT NULL,
	CONSTRAINT "wiki_revision_categories_revision_category_key" UNIQUE("revision_id","category_key")
);
--> statement-breakpoint
CREATE TABLE "wiki_revision_citations" (
	"revision_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"locator" varchar(500) NOT NULL,
	CONSTRAINT "wiki_revision_citations_identity_key" UNIQUE("revision_id","section_id","source_id","locator")
);
--> statement-breakpoint
CREATE TABLE "wiki_revision_links" (
	"revision_id" uuid NOT NULL,
	"target_name_key" varchar(100) NOT NULL,
	"target_anchor" varchar(80) DEFAULT '' NOT NULL,
	CONSTRAINT "wiki_revision_links_identity_key" UNIQUE("revision_id","target_name_key","target_anchor")
);
--> statement-breakpoint
CREATE TABLE "wiki_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"parent_revision_id" uuid,
	"base_published_revision_id" uuid,
	"actor_id" uuid NOT NULL,
	"edit_summary" varchar(1000) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"restores_id" uuid,
	"accepted_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_revisions_page_id_id_key" UNIQUE("page_id","id"),
	CONSTRAINT "wiki_revisions_page_sequence_key" UNIQUE("page_id","sequence"),
	CONSTRAINT "wiki_revisions_sequence_check" CHECK (sequence > 0),
	CONSTRAINT "wiki_revisions_snapshot_version_check" CHECK (jsonb_typeof(snapshot) = 'object' AND snapshot->>'schemaVersion' = '1')
);
--> statement-breakpoint
CREATE TABLE "wiki_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archive_sha256" varchar(64) NOT NULL,
	"relative_path" text NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"family" varchar(80) NOT NULL,
	"language" varchar(20) NOT NULL,
	"declared_version" varchar(120),
	"declared_date" varchar(40),
	"content" text NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_sources_archive_path_key" UNIQUE("archive_sha256","relative_path"),
	CONSTRAINT "wiki_sources_archive_hash_check" CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wiki_sources_file_hash_check" CHECK (file_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "wiki_names" ADD CONSTRAINT "wiki_names_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_discussion_thread_id_fkey" FOREIGN KEY ("discussion_thread_id") REFERENCES "public"."threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_head_revision_fkey" FOREIGN KEY ("id","head_revision_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_published_revision_fkey" FOREIGN KEY ("id","published_revision_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_base_revision_fkey" FOREIGN KEY ("page_id","base_published_revision_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_proposals" ADD CONSTRAINT "wiki_proposals_previous_proposal_fkey" FOREIGN KEY ("page_id","previous_proposal_id") REFERENCES "public"."wiki_proposals"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revision_categories" ADD CONSTRAINT "wiki_revision_categories_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."wiki_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revision_citations" ADD CONSTRAINT "wiki_revision_citations_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."wiki_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revision_citations" ADD CONSTRAINT "wiki_revision_citations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."wiki_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revision_links" ADD CONSTRAINT "wiki_revision_links_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."wiki_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_accepted_proposal_id_wiki_proposals_id_fk" FOREIGN KEY ("accepted_proposal_id") REFERENCES "public"."wiki_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_parent_revision_fkey" FOREIGN KEY ("page_id","parent_revision_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_base_published_revision_fkey" FOREIGN KEY ("page_id","base_published_revision_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_restores_fkey" FOREIGN KEY ("page_id","restores_id") REFERENCES "public"."wiki_revisions"("page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sources" ADD CONSTRAINT "wiki_sources_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_names_one_canonical_per_page_key" ON "wiki_names" USING btree ("page_id") WHERE kind = 'canonical';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_wiki_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Wiki revisions are immutable.' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wiki_revisions_immutable
BEFORE UPDATE OR DELETE ON wiki_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_wiki_revision_mutation();
