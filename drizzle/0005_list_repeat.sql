CREATE TABLE `list_item_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`done_on` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by` text NOT NULL,
	`note` text,
	`due_before` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_item_log_item` ON `list_item_log` (`item_id`,`id`);--> statement-breakpoint
ALTER TABLE `list_item` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `list_item` ADD `repeat_every` integer;--> statement-breakpoint
ALTER TABLE `list_item` ADD `repeat_unit` text;--> statement-breakpoint
ALTER TABLE `list_item` ADD `repeat_mode` text;--> statement-breakpoint
ALTER TABLE `list_item` ADD `repeat_anchor` text;--> statement-breakpoint
ALTER TABLE `list_item` ADD `lead_days` integer;