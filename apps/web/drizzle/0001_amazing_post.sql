CREATE TABLE `canvas_items` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	`rotation` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_items_canvas_idx` ON `canvas_items` (`canvas_id`);--> statement-breakpoint
CREATE TABLE `canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_dimensions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`left_label` text NOT NULL,
	`right_label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_project_dimensions`("id", "project_id", "left_label", "right_label", "sort_order", "created_at") SELECT "id", "project_id", "left_label", "right_label", "sort_order", "created_at" FROM `project_dimensions`;--> statement-breakpoint
DROP TABLE `project_dimensions`;--> statement-breakpoint
ALTER TABLE `__new_project_dimensions` RENAME TO `project_dimensions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `project_dimensions_project_order_unique` ON `project_dimensions` (`project_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `assets` ADD `storage_key` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `thumbnail_key` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `width` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `height` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `mime_type` text DEFAULT 'image/jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `source_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `assets_sha256_idx` ON `assets` (`sha256`);