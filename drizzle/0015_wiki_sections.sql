CREATE TABLE "wiki_sections" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"parent_key" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "wiki_sections_key_check" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "wiki_sections_parent_check" CHECK ("parent_key" IS NULL OR "parent_key" <> "key"),
	CONSTRAINT "wiki_sections_sort_order_check" CHECK ("sort_order" >= 0),
	CONSTRAINT "wiki_sections_parent_key_fkey" FOREIGN KEY ("parent_key") REFERENCES "public"."wiki_sections"("key") ON DELETE RESTRICT ON UPDATE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "wiki_sections_parent_order_idx" ON "wiki_sections" USING btree ("parent_key", "sort_order", "key");
--> statement-breakpoint
INSERT INTO "wiki_sections" ("key", "name", "description", "parent_key", "sort_order") VALUES
	('paranormalidade', 'Paranormalidade', '', NULL, 0),
	('percepcao', 'Percepção', '', 'paranormalidade', 0),
	('classes', 'Classes', '', 'paranormalidade', 1),
	('feiticos-e-rituais', 'Feitiços e rituais', '', 'paranormalidade', 2),
	('fundamentos-e-transformacoes', 'Fundamentos e transformações', '', 'paranormalidade', 3),
	('cosmologia', 'Cosmologia', '', NULL, 1),
	('conceitos-e-fenomenos', 'Conceitos e fenômenos', '', 'cosmologia', 0),
	('planos-e-lugares', 'Planos e lugares', '', 'cosmologia', 1),
	('religiao', 'Religião', '', 'cosmologia', 2),
	('vinculos-arquetipicos', 'Vínculos arquetípicos', '', 'cosmologia', 3),
	('sociedade-e-instituicoes', 'Sociedade e Instituições', '', NULL, 2),
	('trabalho-paranormal', 'Trabalho Paranormal', '', 'sociedade-e-instituicoes', 0),
	('vida-social-e-instituicoes', 'Vida social e instituições', '', 'sociedade-e-instituicoes', 1),
	('seres-e-entidades-area', 'Seres e Entidades', '', NULL, 3),
	('personagens', 'Personagens', '', 'seres-e-entidades-area', 0),
	('seres-e-entidades', 'Seres e entidades', '', 'seres-e-entidades-area', 1)
ON CONFLICT ("key") DO NOTHING;
