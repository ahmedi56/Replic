CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`actor_label` text DEFAULT 'System' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_org_created` ON `audit_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_org` ON `bank_accounts` (`organization_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#10B981' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_org_name` ON `categories` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`bank_account_id` text,
	`filename` text NOT NULL,
	`checksum` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`column_mapping` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `imports_org_checksum` ON `imports` (`organization_id`,`checksum`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`score` real NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`breakdown` text NOT NULL,
	`method` text DEFAULT 'deterministic' NOT NULL,
	`confirmed_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_receipt_txn` ON `matches` (`receipt_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `matches_org_status` ON `matches` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `matches_org_score` ON `matches` (`organization_id`,`score`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_org` ON `memberships` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `memberships_org` ON `memberships` (`organization_id`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`aliases` text,
	`category_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_org_norm` ON `merchants` (`organization_id`,`normalized`);--> statement-breakpoint
CREATE TABLE `org_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matching_config` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_settings_organization_id_unique` ON `org_settings` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `receipt_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`merchant_raw` text,
	`merchant_norm` text,
	`merchant_id` text,
	`date` integer,
	`total` real,
	`subtotal` real,
	`tax` real,
	`currency` text,
	`invoice_number` text,
	`payment_method` text,
	`items` text,
	`field_confidence` text,
	`overall_confidence` real DEFAULT 0 NOT NULL,
	`provider` text DEFAULT 'mock' NOT NULL,
	`raw_response` text,
	`edited_by_user` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_extractions_receipt_id_unique` ON `receipt_extractions` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `extractions_merchant_norm` ON `receipt_extractions` (`merchant_norm`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`failure_code` text,
	`is_duplicate` integer DEFAULT false NOT NULL,
	`duplicate_of_id` text,
	`category_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `receipts_org_status` ON `receipts` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `receipts_org_checksum` ON `receipts` (`organization_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `receipts_org_created` ON `receipts` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`receipt_quota` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_organization_id_unique` ON `subscriptions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`bank_account_id` text,
	`import_id` text,
	`description_raw` text NOT NULL,
	`description_norm` text NOT NULL,
	`merchant_norm` text,
	`merchant_id` text,
	`reference` text,
	`date` integer NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`payment_method` text,
	`fingerprint` text NOT NULL,
	`category_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_org_fingerprint` ON `transactions` (`organization_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_org_date` ON `transactions` (`organization_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_org_amount` ON `transactions` (`organization_id`,`amount`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`persona` text,
	`onboarded_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);