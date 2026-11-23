CREATE TABLE `completion_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurrence_step_id` integer NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`snapshot_id` integer,
	`slot` integer,
	`event_ts` text NOT NULL,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`occurrence_step_id`) REFERENCES `occurrence_step`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_event_dedupe` ON `completion_event` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `day_override` (
	`member_id` integer NOT NULL,
	`local_date` text NOT NULL,
	`day_type_id` integer NOT NULL,
	`note` text,
	`source` text NOT NULL,
	PRIMARY KEY(`member_id`, `local_date`),
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_type_id`) REFERENCES `day_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `day_type` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`glyph` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen` text,
	`settings_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`short_label` text NOT NULL,
	`kind` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`icon` text DEFAULT 'star' NOT NULL,
	`display_mode` text DEFAULT 'reader' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `occurrence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`local_date` text NOT NULL,
	`day_type_id` integer,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `routine_template`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_type_id`) REFERENCES `day_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_template_date` ON `occurrence` (`template_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `occurrence_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurrence_id` integer NOT NULL,
	`step_id` integer NOT NULL,
	`title_snapshot` text NOT NULL,
	`icon_snapshot` text,
	`sort_snapshot` integer NOT NULL,
	`completed_at` text,
	`completed_by` text,
	FOREIGN KEY (`occurrence_id`) REFERENCES `occurrence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`step_id`) REFERENCES `routine_step`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `occurrence_step_occ` ON `occurrence_step` (`occurrence_id`);--> statement-breakpoint
CREATE TABLE `planner_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routine_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`title` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`icon` text,
	`day_type_ids_json` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `routine_template`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `routine_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`days_of_week` integer DEFAULT 127 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `served_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`page_id` text NOT NULL,
	`rendered_at` text NOT NULL,
	`slots_json` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `served_snapshot_device_page` ON `served_snapshot` (`device_id`,`page_id`,`id`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_pattern` (
	`member_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`day_type_id` integer NOT NULL,
	PRIMARY KEY(`member_id`, `weekday`),
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_type_id`) REFERENCES `day_type`(`id`) ON UPDATE no action ON DELETE no action
);
