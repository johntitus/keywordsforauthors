CREATE TABLE `search_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`keyword` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `search_events_created_idx` ON `search_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `search_events_user_idx` ON `search_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `search_events_keyword_idx` ON `search_events` (`keyword`);