-- AlterTable
ALTER TABLE `agent_runs`
MODIFY `status` ENUM('queued', 'running', 'completed', 'failed', 'aborted', 'stale', 'cancelled') NOT NULL DEFAULT 'queued';
