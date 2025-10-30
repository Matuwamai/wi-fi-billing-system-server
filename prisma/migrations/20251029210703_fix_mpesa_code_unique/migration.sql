/*
  Warnings:

  - You are about to alter the column `mpesaCode` on the `Payment` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(50)`.

*/
-- AlterTable
ALTER TABLE `Payment` MODIFY `mpesaCode` VARCHAR(50) NULL;
