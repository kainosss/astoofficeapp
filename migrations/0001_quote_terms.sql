ALTER TABLE `quote_items` ADD `show_quantity` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `scope_template_cctv` text DEFAULT 'Scope of Works – CCTV Installation

Supply, installation, configuration and testing of the CCTV system and equipment listed in this quotation.

Installation includes Cat6 network cabling, RJ45 terminations, camera mounting and surface-mounted ducting where required to achieve a neat and professional finish.

Final camera positions, equipment locations and cable routes will be confirmed with the customer prior to installation.

System commissioning includes recording configuration, remote viewing setup (subject to suitable internet connectivity) and a basic customer demonstration.

Any unforeseen works outside the agreed scope will be discussed and approved by the customer before proceeding.' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `scope_template_alarm` text DEFAULT 'Scope of Works – Intruder Alarm Installation

Supply, installation, programming and testing of the intruder alarm system and equipment listed in this quotation.

Final detector, keypad, siren and control panel locations will be confirmed with the customer prior to installation.

Commissioning includes zone programming, user code setup and a basic customer demonstration of arming and disarming the system.

Any unforeseen works outside the agreed scope will be discussed and approved by the customer before proceeding.' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `scope_template_maintenance` text DEFAULT 'Scope of Works – Preventative Maintenance

Inspection and testing of the security equipment listed in this quotation, including checking operation, power supplies, recording and connectivity where applicable.

Minor adjustments and cleaning are included. Any faulty equipment or additional work identified will be reported and quoted separately before proceeding.' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `workmanship_warranty_months` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `manufacturer_warranty_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `claim_expenses_policy` text DEFAULT '' NOT NULL;