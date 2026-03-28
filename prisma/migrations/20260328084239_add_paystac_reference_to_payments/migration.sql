/*
  Warnings:

  - A unique constraint covering the columns `[reference]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `paystackRef` VARCHAR(191) NULL,
    ADD COLUMN `reference` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Payment_reference_key` ON `Payment`(`reference`);
