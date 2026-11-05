CREATE INDEX `attempt_events_participant_index` ON `attempt_events` (`invite_id`,`id`);--> statement-breakpoint
CREATE INDEX `invites_browser_index` ON `invites` (`browser`);