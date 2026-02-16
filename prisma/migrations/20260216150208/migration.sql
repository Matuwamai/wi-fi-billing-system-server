-- CreateTable
CREATE TABLE `radusergroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL DEFAULT '',
    `groupname` VARCHAR(191) NOT NULL DEFAULT '',
    `priority` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `radgroupcheck` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupname` VARCHAR(191) NOT NULL DEFAULT '',
    `attribute` VARCHAR(191) NOT NULL DEFAULT '',
    `op` CHAR(2) NOT NULL DEFAULT '==',
    `value` VARCHAR(191) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `radgroupreply` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupname` VARCHAR(191) NOT NULL DEFAULT '',
    `attribute` VARCHAR(191) NOT NULL DEFAULT '',
    `op` CHAR(2) NOT NULL DEFAULT '=',
    `value` VARCHAR(191) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `radpostauth` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL DEFAULT '',
    `pass` VARCHAR(191) NOT NULL DEFAULT '',
    `reply` VARCHAR(191) NOT NULL DEFAULT '',
    `authdate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
