ALTER TABLE `occurrence_step` ADD `ended_at` text;--> statement-breakpoint
ALTER TABLE `routine_step` ADD `timer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `routine_step` ADD `usual_min` integer;