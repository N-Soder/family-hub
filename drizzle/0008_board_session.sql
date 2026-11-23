CREATE TABLE `board_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
