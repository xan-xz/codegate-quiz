CREATE TABLE `quiz_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`questions` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `attempt_events` ADD `event_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_events_event_key_unique` ON `attempt_events` (`event_key`);--> statement-breakpoint
ALTER TABLE `invites` ADD `question_snapshot` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `violation_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_violation_id` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_violation_at` integer;