ALTER TABLE `artifact_reviews`
  ADD COLUMN `quality_score` INT UNSIGNED NULL,
  ADD COLUMN `quality_report` JSON NULL;
