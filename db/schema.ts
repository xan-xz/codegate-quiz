import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
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
});

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  expires: integer('expires').notNull(),
});
