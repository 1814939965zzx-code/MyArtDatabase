CREATE TABLE `asset_dimension_values` (
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`dimension_id` text NOT NULL,
	`value` integer DEFAULT 500 NOT NULL,
	PRIMARY KEY(`project_id`, `asset_id`, `dimension_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dimension_id`) REFERENCES `project_dimensions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_dimension_values_range_check" CHECK("asset_dimension_values"."value" >= 0 AND "asset_dimension_values"."value" <= 1000)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`file_name` text NOT NULL,
	`thumbnail_url` text,
	`tags` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_assets` (
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `asset_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_dimensions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`left_label` text NOT NULL,
	`right_label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_dimensions_sort_order_check" CHECK("project_dimensions"."sort_order" >= 0 AND "project_dimensions"."sort_order" <= 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_dimensions_project_order_unique` ON `project_dimensions` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
