ALTER TABLE `invites` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_ip_address` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `last_user_agent` text;--> statement-breakpoint
ALTER TABLE `invites` ADD `previous_attempt_id` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `next_attempt_id` integer;