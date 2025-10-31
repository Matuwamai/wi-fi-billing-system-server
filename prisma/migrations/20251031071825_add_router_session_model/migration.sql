/*
  Warnings:

  - You are about to drop the column `duration` on the `RouterSession` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddress` on the `RouterSession` table. All the data in the column will be lost.
  - You are about to drop the column `loginTime` on the `RouterSession` table. All the data in the column will be lost.
  - You are about to drop the column `logoutTime` on the `RouterSession` table. All the data in the column will be lost.
  - You are about to drop the column `macAddress` on the `RouterSession` table. All the data in the column will be lost.
  - Added the required column `planId` to the `RouterSession` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subscriptionId` to the `RouterSession` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `RouterSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `RouterSession` DROP COLUMN `duration`,
    DROP COLUMN `ipAddress`,
    DROP COLUMN `loginTime`,
    DROP COLUMN `logoutTime`,
    DROP COLUMN `macAddress`,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `endedAt` DATETIME(3) NULL,
    ADD COLUMN `planId` INTEGER NOT NULL,
    ADD COLUMN `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `subscriptionId` INTEGER NOT NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- AddForeignKey
ALTER TABLE `RouterSession` ADD CONSTRAINT `RouterSession_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RouterSession` ADD CONSTRAINT `RouterSession_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
