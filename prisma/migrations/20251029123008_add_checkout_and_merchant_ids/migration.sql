/*
  Warnings:

  - A unique constraint covering the columns `[merchantRequestId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `merchantRequestId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Payment_merchantRequestId_key` ON `Payment`(`merchantRequestId`);
