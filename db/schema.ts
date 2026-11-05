import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hash: text('hash').notNull().unique(),
  label: text('label').notNull(),
  status: text('status').notNull().default('new'),
  session: text('session').unique(),
  browser: text('browser'),
  reason: text('reason'),
  answers: text('answers').notNull().default('{}'),
  score: integer('score'),
  created: text('created').notNull().default(sql`CURRENT_TIMESTAMP`),
  firstName: text('first_name'),
  lastName: text('last_name'),
  searchName: text('search_name'),
  joinedAt: integer('joined_at'),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  lastSeenAt: integer('last_seen_at'),
  currentQuestion: integer('current_question').notNull().default(0),
  userAgent: text('user_agent'),
  questionSnapshot: text('question_snapshot'),
  violationCount: integer('violation_count').notNull().default(0),
  lastViolationId: text('last_violation_id'),
  lastViolationAt: integer('last_violation_at'),
}, table => [index('invites_browser_index').on(table.browser)]);

export const attemptEvents = sqliteTable('attempt_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  inviteId: integer('invite_id').references(() => invites.id),
  kind: text('kind').notNull(),
  detail: text('detail').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  eventKey: text('event_key').unique(),
}, table => [index('attempt_events_participant_index').on(table.inviteId, table.id)]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  expires: integer('expires').notNull(),
});

export const quizSettings = sqliteTable('quiz_settings', {
  id: text('id').primaryKey(),
  questions: text('questions').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
});
