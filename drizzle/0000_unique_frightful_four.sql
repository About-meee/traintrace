CREATE TABLE `account_secrets` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`cursor_secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_records` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` text NOT NULL,
	`record_id` text NOT NULL,
	`local_date` text NOT NULL,
	`completed_at` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_records_owner_record_unique` ON `training_records` (`owner_user_id`,`record_id`);--> statement-breakpoint
CREATE INDEX `training_records_owner_order_idx` ON `training_records` (`owner_user_id`,`local_date`,`completed_at`,`record_id`);--> statement-breakpoint
CREATE INDEX `training_records_owner_seq_idx` ON `training_records` (`owner_user_id`,`seq`);--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `training_sessions_owner_idx` ON `training_sessions` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `training_sessions_expiry_idx` ON `training_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_workspace` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`draft_json` text,
	`custom_exercises_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
