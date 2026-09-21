-- AlterTable
ALTER TABLE `users`
ADD COLUMN `requirement_models` JSON NULL AFTER `ai_settings`;
