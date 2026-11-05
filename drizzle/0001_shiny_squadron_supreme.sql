CREATE TABLE `attempt_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invite_id` integer,
	`kind` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invites` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `search_name` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `joined_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `current_question` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `user_agent` text;