CREATE TABLE `alignment_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `original_input` LONGTEXT NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'required',
    `created_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    UNIQUE INDEX `alignment_sessions_uuid_key`(`uuid`),
    INDEX `alignment_sessions_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `alignment_sessions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alignment_versions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `session_id` BIGINT UNSIGNED NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `input_snapshot` LONGTEXT NOT NULL,
    `analysis_snapshot` LONGTEXT NOT NULL,
    `clarification_snapshot` LONGTEXT NOT NULL,
    `created_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `alignment_versions_uuid_key`(`uuid`),
    UNIQUE INDEX `alignment_versions_session_id_version_key`(`session_id`, `version`),
    INDEX `alignment_versions_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alignment_clarification_answers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `alignment_version_id` BIGINT UNSIGNED NOT NULL,
    `question_id` VARCHAR(120) NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `answer` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `alignment_clarification_answers_uuid_key`(`uuid`),
    INDEX `alignment_clarification_answers_alignment_version_id_idx`(`alignment_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `alignment_versions` ADD CONSTRAINT `alignment_versions_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `alignment_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `alignment_clarification_answers` ADD CONSTRAINT `alignment_clarification_answers_alignment_version_id_fkey` FOREIGN KEY (`alignment_version_id`) REFERENCES `alignment_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
