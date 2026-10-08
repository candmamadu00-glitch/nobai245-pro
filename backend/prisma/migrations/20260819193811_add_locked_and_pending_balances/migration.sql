-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "pendingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "lockedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00;
