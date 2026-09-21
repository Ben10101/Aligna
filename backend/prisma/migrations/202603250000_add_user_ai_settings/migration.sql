-- AlterTable
ALTER TABLE `users`
ADD COLUMN `ai_settings` JSON NULL AFTER `email`;
