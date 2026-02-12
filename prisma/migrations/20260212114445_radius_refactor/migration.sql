/*
  Warnings:

  - You are about to drop the column `deviceId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `isTempMac` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `lastMacUpdate` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `macAddress` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `RouterSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SyncLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TempDeviceLink` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `RouterSession` DROP FOREIGN KEY `RouterSession_planId_fkey`;

-- DropForeignKey
ALTER TABLE `RouterSession` DROP FOREIGN KEY `RouterSession_subscriptionId_fkey`;

-- DropForeignKey
ALTER TABLE `RouterSession` DROP FOREIGN KEY `RouterSession_userId_fkey`;

-- DropForeignKey
ALTER TABLE `TempDeviceLink` DROP FOREIGN KEY `TempDeviceLink_userId_fkey`;

-- DropIndex
DROP INDEX `User_deviceId_key` ON `User`;

-- AlterTable
ALTER TABLE `Plan` ADD COLUMN `dataLimit` BIGINT NULL,
    ADD COLUMN `rateLimit` VARCHAR(191) NOT NULL DEFAULT '10M/10M';

-- AlterTable
ALTER TABLE `User` DROP COLUMN `deviceId`,
    DROP COLUMN `isTempMac`,
    DROP COLUMN `lastMacUpdate`,
    DROP COLUMN `macAddress`;

-- DropTable
DROP TABLE `RouterSession`;

-- DropTable
DROP TABLE `SyncLog`;

-- DropTable
DROP TABLE `TempDeviceLink`;

-- CreateTable
CREATE TABLE `radcheck` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `attribute` VARCHAR(64) NOT NULL,
    `op` VARCHAR(2) NOT NULL DEFAULT ':=',
    `value` VARCHAR(253) NOT NULL,

    INDEX `radcheck_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `radreply` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `attribute` VARCHAR(64) NOT NULL,
    `op` VARCHAR(2) NOT NULL DEFAULT '=',
    `value` VARCHAR(253) NOT NULL,

    INDEX `radreply_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `radacct` (
    `radacctid` BIGINT NOT NULL AUTO_INCREMENT,
    `acctsessionid` VARCHAR(64) NOT NULL,
    `acctuniqueid` VARCHAR(32) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `realm` VARCHAR(64) NULL,
    `nasipaddress` VARCHAR(15) NOT NULL,
    `nasportid` VARCHAR(32) NULL,
    `nasporttype` VARCHAR(32) NULL,
    `acctstarttime` DATETIME(3) NULL,
    `acctupdatetime` DATETIME(3) NULL,
    `acctstoptime` DATETIME(3) NULL,
    `acctsessiontime` INTEGER UNSIGNED NULL,
    `acctauthentic` VARCHAR(32) NULL,
    `connectinfo_start` VARCHAR(128) NULL,
    `connectinfo_stop` VARCHAR(128) NULL,
    `acctinputoctets` BIGINT NULL,
    `acctoutputoctets` BIGINT NULL,
    `calledstationid` VARCHAR(50) NULL,
    `callingstationid` VARCHAR(50) NULL,
    `acctterminatecause` VARCHAR(32) NULL,
    `servicetype` VARCHAR(32) NULL,
    `framedprotocol` VARCHAR(32) NULL,
    `framedipaddress` VARCHAR(15) NULL,

    UNIQUE INDEX `radacct_acctuniqueid_key`(`acctuniqueid`),
    INDEX `radacct_username_idx`(`username`),
    INDEX `radacct_acctsessionid_idx`(`acctsessionid`),
    INDEX `radacct_acctstarttime_idx`(`acctstarttime`),
    INDEX `radacct_acctstoptime_idx`(`acctstoptime`),
    INDEX `radacct_nasipaddress_idx`(`nasipaddress`),
    INDEX `radacct_callingstationid_idx`(`callingstationid`),
    PRIMARY KEY (`radacctid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nasname` VARCHAR(128) NOT NULL,
    `shortname` VARCHAR(32) NOT NULL,
    `type` VARCHAR(30) NOT NULL DEFAULT 'other',
    `ports` INTEGER NULL,
    `secret` VARCHAR(60) NOT NULL,
    `server` VARCHAR(64) NULL,
    `community` VARCHAR(50) NULL,
    `description` VARCHAR(200) NULL,

    UNIQUE INDEX `nas_nasname_key`(`nasname`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
