/*
  Warnings:

  - A unique constraint covering the columns `[checkoutRequestId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `checkoutRequestId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Payment_checkoutRequestId_key` ON `Payment`(`checkoutRequestId`);
