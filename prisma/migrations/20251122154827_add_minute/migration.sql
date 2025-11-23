-- AlterTable
ALTER TABLE `Plan` MODIFY `durationType` ENUM('MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH') NOT NULL;
