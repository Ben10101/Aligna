CREATE TABLE `artifact_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `artifact_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `decision` VARCHAR(20) NOT NULL,
  `released_stage` VARCHAR(50) NULL,
  `comment` TEXT NULL,
  `reason` TEXT NULL,
  `reviewed_by` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `version` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `artifact_reviews_uuid_key` (`uuid`), UNIQUE INDEX `artifact_reviews_artifact_version_decision_key` (`artifact_id`, `version`, `decision`), INDEX `artifact_reviews_artifact_id_idx` (`artifact_id`), INDEX `artifact_reviews_task_id_idx` (`task_id`), INDEX `artifact_reviews_reviewed_by_idx` (`reviewed_by`),
  CONSTRAINT `artifact_reviews_artifact_id_fkey` FOREIGN KEY (`artifact_id`) REFERENCES `task_artifacts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `artifact_reviews_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `artifact_reviews_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
