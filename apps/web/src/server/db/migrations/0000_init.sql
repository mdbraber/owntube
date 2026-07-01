CREATE TABLE `interactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interactions_user_video_idx` ON `interactions` (`user_id`,`video_id`);--> statement-breakpoint
CREATE INDEX `interactions_video_idx` ON `interactions` (`video_id`);--> statement-breakpoint
CREATE INDEX `interactions_channel_idx` ON `interactions` (`channel_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`subscribed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_channel_uidx` ON `subscriptions` (`user_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_channel_idx` ON `subscriptions` (`channel_id`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `video_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_cache_cache_key_unique` ON `video_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `video_cache_expires_idx` ON `video_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `video_cache_kind_idx` ON `video_cache` (`kind`);--> statement-breakpoint
CREATE TABLE `watch_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_watched` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `watch_history_user_started_idx` ON `watch_history` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `watch_history_video_idx` ON `watch_history` (`video_id`);--> statement-breakpoint
CREATE INDEX `watch_history_channel_idx` ON `watch_history` (`channel_id`);