ALTER TABLE `routine_step` ADD `due_at` text;--> statement-breakpoint
ALTER TABLE `routine_step` ADD `due_after_step_id` integer;--> statement-breakpoint
ALTER TABLE `routine_step` ADD `due_after_min` integer;