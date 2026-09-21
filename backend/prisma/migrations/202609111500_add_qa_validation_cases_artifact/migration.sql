ALTER TABLE `task_artifacts`
  MODIFY `artifact_type` ENUM('idea', 'backlog', 'requirements', 'test_plan', 'qa_validation_cases', 'test_case', 'architecture', 'code', 'review', 'deployment_notes', 'commentary', 'custom') NOT NULL DEFAULT 'custom';
