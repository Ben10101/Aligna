ALTER TABLE `task_artifacts`
  MODIFY COLUMN `artifact_scope` ENUM('refinement', 'implementation', 'review_decisions') NOT NULL DEFAULT 'refinement';
