CREATE TABLE `list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`icon` text DEFAULT 'bag' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `list_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`title` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`done_at` text,
	`done_by` text,
	FOREIGN KEY (`list_id`) REFERENCES `list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_item_list` ON `list_item` (`list_id`,`sort`);
--> statement-breakpoint
INSERT INTO `list` (`name`, `kind`, `icon`, `sort`, `created_at`) VALUES ('Shopping', 'grocery', 'bag', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
