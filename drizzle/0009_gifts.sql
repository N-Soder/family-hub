CREATE TABLE `gift_idea` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`price` integer,
	`status` text DEFAULT 'idea' NOT NULL,
	`occasion` text,
	`created_at` text NOT NULL,
	`bought_at` text,
	`given_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `gift_person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gift_idea_person` ON `gift_idea` (`person_id`,`status`);--> statement-breakpoint
CREATE TABLE `gift_person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`birthday` text,
	`notes` text,
	`created_at` text NOT NULL
);
