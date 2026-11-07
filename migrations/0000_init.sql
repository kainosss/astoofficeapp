CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text DEFAULT '' NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'individual' NOT NULL,
	`name` text NOT NULL,
	`contact_person` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manufacturer` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`kind` text DEFAULT 'equipment' NOT NULL,
	`unit` text DEFAULT 'each' NOT NULL,
	`pack_quantity` integer DEFAULT 1 NOT NULL,
	`cost_ex_gst_cents` integer NOT NULL,
	`cost_inc_gst_cents` integer NOT NULL,
	`markup_bp` integer,
	`sell_price_cents` integer,
	`customer_description` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_estimate` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `equipment_name_idx` ON `equipment` (`name`);--> statement-breakpoint
CREATE INDEX `equipment_sku_idx` ON `equipment` (`sku`);--> statement-breakpoint
CREATE TABLE `package_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`role` text DEFAULT 'priced' NOT NULL,
	`equipment_id` integer,
	`description` text DEFAULT '' NOT NULL,
	`quantity_centi` integer DEFAULT 100 NOT NULL,
	`in_package` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `package_items_pkg_idx` ON `package_items` (`package_id`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`pricing_mode` text DEFAULT 'fixed' NOT NULL,
	`fixed_price_cents` integer,
	`labour_hours_centi` integer DEFAULT 0 NOT NULL,
	`labour_rate_cents` integer,
	`markup_bp` integer,
	`complexity_bp` integer DEFAULT 10000 NOT NULL,
	`travel_charge_cents` integer DEFAULT 0 NOT NULL,
	`travel_cost_cents` integer DEFAULT 0 NOT NULL,
	`consumables_cost_cents` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`inclusions` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`revision_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`role` text DEFAULT 'priced' NOT NULL,
	`kind` text DEFAULT 'equipment' NOT NULL,
	`equipment_id` integer,
	`name` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'each' NOT NULL,
	`quantity_centi` integer DEFAULT 100 NOT NULL,
	`pack_quantity` integer DEFAULT 1 NOT NULL,
	`cost_ex_gst_cents` integer DEFAULT 0 NOT NULL,
	`cost_inc_gst_cents` integer DEFAULT 0 NOT NULL,
	`markup_bp` integer,
	`sell_unit_cents` integer,
	`in_package` integer DEFAULT false NOT NULL,
	`is_estimate` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quote_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quote_items_rev_idx` ON `quote_items` (`revision_id`);--> statement-breakpoint
CREATE TABLE `quote_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quote_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`package_id` integer,
	`package_name` text DEFAULT '' NOT NULL,
	`issue_date` text,
	`expiry_date` text,
	`issued_at` text,
	`pricing` text NOT NULL,
	`totals` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`inclusions` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`deposit_terms` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`warranty_text` text DEFAULT '' NOT NULL,
	`acceptance_text` text DEFAULT '' NOT NULL,
	`customer_notes` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`snapshot` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_revisions_idx` ON `quote_revisions` (`quote_id`,`revision`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quote_number` text NOT NULL,
	`customer_id` integer NOT NULL,
	`site_id` integer,
	`current_revision_id` integer,
	`duplicated_from_quote_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_idx` ON `quotes` (`quote_number`);--> statement-breakpoint
CREATE INDEX `quotes_customer_idx` ON `quotes` (`customer_id`);--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_name` text NOT NULL,
	`abn` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`logo_data_url` text,
	`labour_rate_cents` integer NOT NULL,
	`default_markup_bp` integer NOT NULL,
	`gst_registered` integer DEFAULT false NOT NULL,
	`gst_rate_bp` integer DEFAULT 1000 NOT NULL,
	`quote_validity_days` integer DEFAULT 30 NOT NULL,
	`overhead_bp` integer DEFAULT 0 NOT NULL,
	`warranty_bp` integer DEFAULT 0 NOT NULL,
	`owner_labour_cost_cents` integer DEFAULT 0 NOT NULL,
	`min_gross_margin_bp` integer DEFAULT 0 NOT NULL,
	`min_surplus_cents` integer DEFAULT 0 NOT NULL,
	`deposit_terms` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`warranty_text` text DEFAULT '' NOT NULL,
	`acceptance_text` text DEFAULT '' NOT NULL,
	`standard_inclusions` text DEFAULT '' NOT NULL,
	`standard_exclusions` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`address` text NOT NULL,
	`suburb` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'QLD' NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sites_customer_idx` ON `sites` (`customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);