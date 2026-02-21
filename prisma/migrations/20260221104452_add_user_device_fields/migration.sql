/*
  Warnings:

  - A unique constraint covering the columns `[macAddress]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `macAddress` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_macAddress_key` ON `User`(`macAddress`);
