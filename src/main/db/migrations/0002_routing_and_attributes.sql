-- Phase 4: snap-to-road provenance, control points, and the road-attribute
-- cache.
--
-- Hand-written rather than drizzle-kit generated, because SQLite cannot add a
-- column with a non-constant default and the generated form for three new
-- columns plus two tables is less readable than this.

-- Provenance for snapped geometry. All nullable: a null `routing_provider` is
-- a hand-drawn route, which is how every existing route stays untouched and
-- how "normal behaviour is unchanged" holds without a feature flag.
ALTER TABLE `routes` ADD `routing_provider` text;--> statement-breakpoint
ALTER TABLE `routes` ADD `transport_mode` text;--> statement-breakpoint
ALTER TABLE `routes` ADD `snapped_at` integer;--> statement-breakpoint

-- The points the user actually placed.
--
-- Separate from `route_points`, which holds the shape that is drawn and
-- exported. Keeping both means editing one control point can re-snap only the
-- affected legs instead of discarding the user's intent (Requirement 3.3).
--
-- A route with no rows here is hand-drawn: `route_points` is then the user's
-- own geometry and there is nothing to re-snap from.
CREATE TABLE `route_control_points` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_route_control_points_seq` ON `route_control_points` (`route_id`,`seq`);--> statement-breakpoint

-- Map-matched road attributes: a cache, never a source of truth.
--
-- `geometry_hash` is recomputed on read and a mismatch means stale, which is
-- how invalidation-on-edit is enforced without a trigger. One row per object,
-- so re-matching replaces rather than accumulates.
--
-- `payload` is JSON: per-edge speed limit, road class and surface. Not
-- normalised into columns because it is only ever read back whole, and the
-- alternative is a table that exists solely to be re-joined.
CREATE TABLE `road_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`geometry_hash` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`payload` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_road_attributes_owner` ON `road_attributes` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_road_attributes_fetched` ON `road_attributes` (`fetched_at`);
