CREATE TABLE `goal` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `objective` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `token_budget` integer,
  `tokens_used` integer NOT NULL DEFAULT 0,
  `time_used_seconds` integer NOT NULL DEFAULT 0,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);

CREATE INDEX `goal_session_idx` ON `goal` (`session_id`);
