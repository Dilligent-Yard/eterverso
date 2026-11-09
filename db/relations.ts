import { relations } from "drizzle-orm/relations";
import { users, threads, categories, posts, personagens, comments, wikiPosts, wikiPages, wikiRevisions, wikiProposals, wikiSections, notifications, likes, timelineEvents } from "./schema";

// Relações entre as tabelas

export const threadsRelations = relations(threads, ({ one, many }) => ({
	user: one(users, {
		fields: [threads.authorId],
		references: [users.id]
	}),
	category: one(categories, {
		fields: [threads.categoryId],
		references: [categories.id]
	}),
	posts: many(posts),
}));

export const usersRelations = relations(users, ({ many }) => ({
	threads: many(threads),
	posts: many(posts),
	personagens: many(personagens),
	comments: many(comments),
	wikiPosts: many(wikiPosts),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
	threads: many(threads),
}));

export const postsRelations = relations(posts, ({ one }) => ({
	user: one(users, {
		fields: [posts.authorId],
		references: [users.id]
	}),
	thread: one(threads, {
		fields: [posts.threadId],
		references: [threads.id]
	}),
}));

export const personagensRelations = relations(personagens, ({ one, many }) => ({
	user: one(users, {
		fields: [personagens.authorId],
		references: [users.id]
	}),
	comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	user: one(users, {
		fields: [comments.authorId],
		references: [users.id]
	}),
	personagen: one(personagens, {
		fields: [comments.personagemId],
		references: [personagens.id]
	}),
}));

export const wikiPostsRelations = relations(wikiPosts, ({ one }) => ({
	user: one(users, {
		fields: [wikiPosts.authorId],
		references: [users.id]
	}),
}));

export const wikiPagesRelations = relations(wikiPages, ({ one, many }) => ({
	creator: one(users, { fields: [wikiPages.createdBy], references: [users.id] }),
	headRevision: one(wikiRevisions, { fields: [wikiPages.id, wikiPages.headRevisionId], references: [wikiRevisions.pageId, wikiRevisions.id], relationName: "wiki_page_head" }),
	publishedRevision: one(wikiRevisions, { fields: [wikiPages.id, wikiPages.publishedRevisionId], references: [wikiRevisions.pageId, wikiRevisions.id], relationName: "wiki_page_published" }),
	revisions: many(wikiRevisions),
	proposals: many(wikiProposals),
}));

export const wikiRevisionsRelations = relations(wikiRevisions, ({ one }) => ({
	page: one(wikiPages, { fields: [wikiRevisions.pageId], references: [wikiPages.id] }),
	actor: one(users, { fields: [wikiRevisions.actorId], references: [users.id] }),
}));

export const wikiProposalsRelations = relations(wikiProposals, ({ one }) => ({
	page: one(wikiPages, { fields: [wikiProposals.pageId], references: [wikiPages.id] }),
	proposer: one(users, { fields: [wikiProposals.proposerId], references: [users.id] }),
}));

export const wikiSectionsRelations = relations(wikiSections, ({ one, many }) => ({
	parent: one(wikiSections, {
		fields: [wikiSections.parentKey],
		references: [wikiSections.key],
		relationName: "wiki_section_tree",
	}),
	children: many(wikiSections, { relationName: "wiki_section_tree" }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
	actor: one(users, {
		fields: [notifications.actorId],
		references: [users.id]
	}),
}));

export const likesRelations = relations(likes, ({ one }) => ({
	user: one(users, {
		fields: [likes.userId],
		references: [users.id]
	}),
}));
