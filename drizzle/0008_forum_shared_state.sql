CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_label" varchar(120),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"reason" varchar(1000) NOT NULL,
	"before_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK (actor_id IS NOT NULL OR actor_label IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "forum_migration_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"reason" varchar(80) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "forum_migration_issues_thread_reason_key" UNIQUE("thread_id","reason")
);
--> statement-breakpoint
CREATE TABLE "post_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"summary" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_revisions_post_version_key" UNIQUE("post_id","version"),
	CONSTRAINT "post_revisions_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "request_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" varchar(100) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_keys_actor_operation_key" UNIQUE("actor_id","operation","idempotency_key"),
	CONSTRAINT "request_keys_hash_check" CHECK (length(request_hash) = 64)
);
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_thread_id_fkey";
--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT "threads_category_id_fkey";
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "author_label" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "legacy_reference" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "post_no" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "author_label" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "legacy_reference" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "quarantine_reason" varchar(80);--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "last_activity_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "next_post_no" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
WITH ordered_posts AS (
	SELECT id, row_number() OVER (PARTITION BY thread_id ORDER BY created_at ASC, id ASC)::integer AS post_no
	FROM posts
)
UPDATE posts AS p SET post_no = ordered_posts.post_no
FROM ordered_posts WHERE ordered_posts.id = p.id;--> statement-breakpoint
INSERT INTO forum_migration_issues (thread_id, reason, details)
SELECT t.id, 'missing-opening-post', jsonb_build_object('title', t.title, 'createdAt', t.created_at)
FROM threads AS t
WHERE NOT EXISTS (SELECT 1 FROM posts AS p WHERE p.thread_id = t.id)
ON CONFLICT (thread_id, reason) DO NOTHING;--> statement-breakpoint
UPDATE threads AS t
SET quarantined_at = now(), quarantine_reason = 'missing-opening-post'
WHERE NOT EXISTS (SELECT 1 FROM posts AS p WHERE p.thread_id = t.id);--> statement-breakpoint
INSERT INTO forum_migration_issues (thread_id, reason, details)
SELECT tied.thread_id, 'tied-legacy-timestamps', jsonb_build_object('groups', jsonb_agg(tied.group_data ORDER BY tied.created_at))
FROM (
	SELECT thread_id, created_at,
		jsonb_build_object('createdAt', created_at, 'postIds', jsonb_agg(id::text ORDER BY id)) AS group_data
	FROM posts
	GROUP BY thread_id, created_at
	HAVING count(*) > 1
) AS tied
GROUP BY tied.thread_id
ON CONFLICT (thread_id, reason) DO NOTHING;--> statement-breakpoint
UPDATE threads AS t
SET last_activity_at = COALESCE((SELECT max(p.created_at) FROM posts AS p WHERE p.thread_id = t.id AND p.deleted_at IS NULL), t.created_at),
	next_post_no = COALESCE((SELECT max(p.post_no) + 1 FROM posts AS p WHERE p.thread_id = t.id), 2);--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "post_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_migration_issues" ADD CONSTRAINT "forum_migration_issues_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_keys" ADD CONSTRAINT "request_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_thread_post_no_key" UNIQUE("thread_id","post_no");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_post_no_check" CHECK (post_no > 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_version_check" CHECK (version > 0);--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_next_post_no_check" CHECK (next_post_no > 1);
