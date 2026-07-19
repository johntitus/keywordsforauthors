CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`api_cost_usd` real,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_transactions_idempotency_key_unique` ON `credit_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_tx_user_idx` ON `credit_transactions` (`user_id`);--> statement-breakpoint
CREATE TABLE `keyword_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer NOT NULL,
	`search_volume` integer,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshot_keyword_idx` ON `keyword_snapshots` (`keyword`,`location_code`);--> statement-breakpoint
CREATE TABLE `keywords` (
	`keyword` text PRIMARY KEY NOT NULL,
	`search_volume` integer,
	`source` text,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `keyword_prefix_idx` ON `keywords` (`keyword`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
