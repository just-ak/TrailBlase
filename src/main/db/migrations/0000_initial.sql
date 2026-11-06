CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`relative_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "attachments_owner_type_valid" CHECK("attachments"."owner_type" in ('trip', 'route', 'track', 'waypoint'))
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_owner` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folders_parent` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE TABLE `import_history` (
	`id` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`source_format` text NOT NULL,
	`destination_trip_id` text,
	`status` text NOT NULL,
	`report` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`destination_trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_history_status_valid" CHECK("import_history"."status" in ('success', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_import_history_started` ON `import_history` (`started_at`);--> statement-breakpoint
CREATE TABLE `recent_items` (
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`accessed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recent_items_accessed` ON `recent_items` (`accessed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recent_items` ON `recent_items` (`item_type`,`item_id`);--> statement-breakpoint
CREATE TABLE `route_points` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`ele_m` real,
	`name` text,
	`symbol` text,
	`notes` text,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_route_points_seq` ON `route_points` (`route_id`,`seq`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text,
	`source` text DEFAULT 'user' NOT NULL,
	`point_count` integer DEFAULT 0 NOT NULL,
	`distance_m` real,
	`elev_gain_m` real,
	`elev_loss_m` real,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "routes_source_valid" CHECK("routes"."source" in ('user', 'import'))
);
--> statement-breakpoint
CREATE INDEX `idx_routes_trip` ON `routes` (`trip_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_points` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`segment_index` integer DEFAULT 0 NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`ele_m` real,
	`recorded_at` integer,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_track_points_seq` ON `track_points` (`track_id`,`segment_index`,`seq`);--> statement-breakpoint
CREATE TABLE `track_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`original_bytes` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text,
	`width` integer,
	`source` text DEFAULT 'import' NOT NULL,
	`point_count` integer DEFAULT 0 NOT NULL,
	`distance_m` real,
	`elev_gain_m` real,
	`elev_loss_m` real,
	`started_at` integer,
	`ended_at` integer,
	`render_geometry` blob,
	`render_tolerance_m` real,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tracks_trip` ON `tracks` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`description` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "trips_status_valid" CHECK("trips"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `idx_trips_folder` ON `trips` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_trips_status` ON `trips` (`status`);--> statement-breakpoint
CREATE INDEX `idx_trips_updated` ON `trips` (`updated_at`);--> statement-breakpoint
CREATE TABLE `waypoint_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `waypoints` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`group_id` text,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`ele_m` real,
	`description` text,
	`symbol` text,
	`notes` text,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `waypoint_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_waypoints_trip` ON `waypoints` (`trip_id`);--> statement-breakpoint
CREATE INDEX `idx_waypoints_coords` ON `waypoints` (`lat`,`lon`);