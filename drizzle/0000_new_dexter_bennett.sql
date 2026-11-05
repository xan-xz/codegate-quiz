CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`session` text,
	`browser` text,
	`reason` text,
	`answers` text DEFAULT '{}' NOT NULL,
	`score` integer,
	`created` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_hash_unique` ON `invites` (`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invites_session_unique` ON `invites` (`session`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL
);
