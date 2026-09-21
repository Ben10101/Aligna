ALTER TABLE `artifact_reviews`
  ADD UNIQUE INDEX `artifact_reviews_artifact_version_decision_key` (`artifact_id`, `version`, `decision`);
