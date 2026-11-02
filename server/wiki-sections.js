'use strict';

const express = require('express');

function createWikiSectionsRouter({ sql } = {}) {
  if (typeof sql !== 'function') {
    throw new TypeError('createWikiSectionsRouter requires the injected postgres client.');
  }

  const router = express.Router();
  router.get('/wiki/sections', (req, res, next) => {
    Promise.resolve().then(async () => {
      const rows = await sql`
        WITH RECURSIVE section_descendants(parent_key, descendant_key) AS (
          SELECT "key", "key" FROM wiki_sections
          UNION
          SELECT descendants.parent_key, child."key"
          FROM section_descendants descendants
          JOIN wiki_sections child ON child.parent_key = descendants.descendant_key
        ),
        public_category_pages(page_id, category_key) AS (
          SELECT DISTINCT page.id, category.category_key
          FROM wiki_pages page
          JOIN wiki_revisions revision
            ON revision.id = page.published_revision_id AND revision.page_id = page.id
          JOIN wiki_revision_categories category ON category.revision_id = revision.id
          WHERE page.published_revision_id IS NOT NULL
            AND page.archived_at IS NULL
            AND page.access_level = 'public'
            AND revision.snapshot->>'accessLevel' = 'public'
        )
        SELECT section."key", section.name, section.description,
               section.parent_key, section.sort_order,
               count(DISTINCT public_page.page_id)::bigint AS pages_count
        FROM wiki_sections section
        LEFT JOIN wiki_sections parent ON parent."key" = section.parent_key
        LEFT JOIN section_descendants descendant ON descendant.parent_key = section."key"
        LEFT JOIN public_category_pages public_page
          ON public_page.category_key = descendant.descendant_key
        GROUP BY section."key", section.name, section.description,
                 section.parent_key, section.sort_order, parent.sort_order
        ORDER BY coalesce(parent.sort_order, section.sort_order),
                 section.parent_key NULLS FIRST, section.sort_order, section."key"`;

      return res.json({
        data: rows.map((row) => {
          const order = Number(row.sort_order);
          const pagesCount = Number(row.pages_count);
          if (!Number.isSafeInteger(order) || order < 0
              || !Number.isSafeInteger(pagesCount) || pagesCount < 0) {
            throw new TypeError('The wiki section query returned an invalid integer.');
          }
          return {
            key: row.key,
            name: row.name,
            description: row.description,
            parentKey: row.parent_key,
            order,
            pagesCount,
          };
        }),
      });
    }).catch(next);
  });

  return router;
}

module.exports = { createWikiSectionsRouter };
