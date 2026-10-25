CREATE TABLE `cards` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`topicId` text NOT NULL,
	`planRowId` text,
	`cardType` text NOT NULL,
	`fields` text NOT NULL,
	`mediaIds` text NOT NULL,
	`tags` text NOT NULL,
	`knowledgeItemIds` text NOT NULL,
	`guid` text NOT NULL,
	`status` text NOT NULL,
	`warning` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_plans` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`topicId` text NOT NULL,
	`status` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`snapshotId` text
);
--> statement-breakpoint
CREATE TABLE `card_plan_rows` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`planId` text NOT NULL,
	`knowledgeItemIds` text NOT NULL,
	`cardType` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `occlusion_masks` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`cardId` text NOT NULL,
	`mediaId` text NOT NULL,
	`shapes` text NOT NULL,
	`origin` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`subtopicId` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`interpretationStatus` text DEFAULT 'supported' NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`userEdited` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`knowledgeItemId` text NOT NULL,
	`kind` text NOT NULL,
	`sourceUnitId` text,
	`external` text,
	`note` text DEFAULT '' NOT NULL,
	`verification` text NOT NULL,
	`approvalId` text
);
--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`conceptId` text NOT NULL,
	`statement` text NOT NULL,
	`types` text NOT NULL,
	`priority` text NOT NULL,
	`origin` text NOT NULL,
	`interpretationStatus` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`userEdited` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_objectives` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`text` text NOT NULL,
	`origin` text NOT NULL,
	`sourceUnitId` text,
	`verb` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_links` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`mediaId` text NOT NULL,
	`conceptId` text,
	`knowledgeItemId` text,
	`role` text NOT NULL,
	`component` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `objective_mappings` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`objectiveId` text NOT NULL,
	`conceptId` text,
	`knowledgeItemId` text,
	`sourceCoverage` text NOT NULL,
	`libraryCoverage` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`fromId` text NOT NULL,
	`toId` text NOT NULL,
	`kind` text NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtopics` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`topicId` text NOT NULL,
	`title` text NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`title` text NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`excluded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY,
	`libraryId` text,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trusted_sources` (
	`id` text PRIMARY KEY,
	`libraryId` text,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`domain` text NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY,
	`path` text NOT NULL,
	`reason` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changesets` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL UNIQUE,
	`libraryId` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`jobId` text,
	`sessionId` text,
	`reviewItemId` text,
	`note` text DEFAULT '' NOT NULL,
	`revertOf` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `display_counters` (
	`libraryId` text NOT NULL,
	`prefix` text NOT NULL,
	`next` integer NOT NULL,
	CONSTRAINT `display_counters_pk` PRIMARY KEY(`libraryId`, `prefix`)
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`snapshotId` text,
	`filePath` text NOT NULL,
	`copiedTo` text,
	`counts` text NOT NULL,
	`cardGuids` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`sessionId` text NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`effort` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`resumeAfter` text,
	`error` text,
	`exitCode` integer,
	`usage` text,
	`reviewItemIds` text NOT NULL,
	`runDir` text,
	`createdAt` text NOT NULL,
	`startedAt` text,
	`finishedAt` text
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`jobId` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_checks` (
	`provider` text PRIMARY KEY,
	`path` text,
	`version` text,
	`loggedIn` integer DEFAULT false NOT NULL,
	`ok` integer DEFAULT false NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`testOk` integer,
	`testMessage` text,
	`testedAt` text,
	`checkedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `row_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`changesetSeq` integer NOT NULL,
	`changesetId` text NOT NULL,
	`libraryId` text,
	`tableName` text NOT NULL,
	`rowId` text NOT NULL,
	`version` integer NOT NULL,
	`op` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`scope` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`effort` text,
	`cliSessionId` text,
	`status` text NOT NULL,
	`contextTokens` integer DEFAULT 0 NOT NULL,
	`jobCount` integer DEFAULT 0 NOT NULL,
	`parentSessionId` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_summaries` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`sessionId` text NOT NULL,
	`body` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_tokens` (
	`tokenHash` text PRIMARY KEY,
	`sessionId` text NOT NULL,
	`valid` integer NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`gate` text NOT NULL,
	`topicId` text,
	`name` text NOT NULL,
	`changesetSeq` integer NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`reviewItemId` text NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	`topicId` text,
	`raisedBy` text NOT NULL,
	`resolution` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_item_targets` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`reviewItemId` text NOT NULL,
	`targetTable` text NOT NULL,
	`targetId` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_messages` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`reviewItemId` text NOT NULL,
	`author` text NOT NULL,
	`action` text,
	`body` text NOT NULL,
	`jobId` text,
	`processed` text DEFAULT 'n/a' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coverage_entries` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`sourceUnitId` text NOT NULL,
	`outcome` text NOT NULL,
	`conceptIds` text NOT NULL,
	`knowledgeItemIds` text NOT NULL,
	`mediaIds` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`sha256` text NOT NULL,
	`storagePath` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`origin` text NOT NULL,
	`sourceId` text,
	`provenance` text NOT NULL,
	`relevance` text DEFAULT 'uncertain' NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`title` text NOT NULL,
	`fileName` text NOT NULL,
	`fileType` text NOT NULL,
	`sha256` text NOT NULL,
	`storagePath` text NOT NULL,
	`pageCount` integer DEFAULT 0 NOT NULL,
	`extractionStatus` text NOT NULL,
	`limitations` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_units` (
	`id` text PRIMARY KEY,
	`libraryId` text NOT NULL,
	`version` integer NOT NULL,
	`changesetId` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`displayId` text NOT NULL,
	`sourceId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`unitType` text NOT NULL,
	`location` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`textBlocks` text NOT NULL,
	`renderMediaId` text,
	`mediaIds` text NOT NULL,
	`width` integer,
	`height` integer
);
--> statement-breakpoint
CREATE INDEX `cards_topic_idx` ON `cards` (`topicId`);--> statement-breakpoint
CREATE INDEX `card_plans_topic_idx` ON `card_plans` (`topicId`);--> statement-breakpoint
CREATE INDEX `card_plan_rows_plan_idx` ON `card_plan_rows` (`planId`);--> statement-breakpoint
CREATE INDEX `occlusion_masks_card_idx` ON `occlusion_masks` (`cardId`);--> statement-breakpoint
CREATE INDEX `concepts_subtopic_idx` ON `concepts` (`subtopicId`);--> statement-breakpoint
CREATE INDEX `evidence_ki_idx` ON `evidence` (`knowledgeItemId`);--> statement-breakpoint
CREATE INDEX `knowledge_items_concept_idx` ON `knowledge_items` (`conceptId`);--> statement-breakpoint
CREATE INDEX `learning_objectives_library_idx` ON `learning_objectives` (`libraryId`);--> statement-breakpoint
CREATE INDEX `media_links_media_idx` ON `media_links` (`mediaId`);--> statement-breakpoint
CREATE INDEX `objective_mappings_objective_idx` ON `objective_mappings` (`objectiveId`);--> statement-breakpoint
CREATE INDEX `subtopics_topic_idx` ON `subtopics` (`topicId`);--> statement-breakpoint
CREATE INDEX `topics_library_idx` ON `topics` (`libraryId`);--> statement-breakpoint
CREATE INDEX `settings_library_key_idx` ON `settings` (`libraryId`,`key`);--> statement-breakpoint
CREATE INDEX `changesets_library_idx` ON `changesets` (`libraryId`);--> statement-breakpoint
CREATE INDEX `changesets_job_idx` ON `changesets` (`jobId`);--> statement-breakpoint
CREATE INDEX `jobs_session_idx` ON `jobs` (`sessionId`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `job_events_job_idx` ON `job_events` (`jobId`);--> statement-breakpoint
CREATE INDEX `row_versions_row_idx` ON `row_versions` (`tableName`,`rowId`);--> statement-breakpoint
CREATE INDEX `row_versions_changeset_idx` ON `row_versions` (`changesetId`);--> statement-breakpoint
CREATE INDEX `row_versions_library_seq_idx` ON `row_versions` (`libraryId`,`changesetSeq`);--> statement-breakpoint
CREATE INDEX `sessions_library_idx` ON `sessions` (`libraryId`);--> statement-breakpoint
CREATE INDEX `session_summaries_session_idx` ON `session_summaries` (`sessionId`);--> statement-breakpoint
CREATE INDEX `approvals_library_idx` ON `approvals` (`libraryId`);--> statement-breakpoint
CREATE INDEX `review_items_library_status_idx` ON `review_items` (`libraryId`,`status`);--> statement-breakpoint
CREATE INDEX `review_item_targets_item_idx` ON `review_item_targets` (`reviewItemId`);--> statement-breakpoint
CREATE INDEX `review_item_targets_target_idx` ON `review_item_targets` (`targetId`);--> statement-breakpoint
CREATE INDEX `review_messages_item_idx` ON `review_messages` (`reviewItemId`);--> statement-breakpoint
CREATE INDEX `coverage_entries_unit_idx` ON `coverage_entries` (`sourceUnitId`);--> statement-breakpoint
CREATE INDEX `media_assets_library_idx` ON `media_assets` (`libraryId`);--> statement-breakpoint
CREATE INDEX `sources_library_idx` ON `sources` (`libraryId`);--> statement-breakpoint
CREATE INDEX `source_units_source_idx` ON `source_units` (`sourceId`);