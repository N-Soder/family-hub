CREATE TABLE `list_shop` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`name` text NOT NULL,
	`tone` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_shop_list` ON `list_shop` (`list_id`,`sort`);--> statement-breakpoint
ALTER TABLE `list_item` ADD `shop_id` integer REFERENCES list_shop(id) ON DELETE set null;