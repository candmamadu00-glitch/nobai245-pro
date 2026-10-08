/*
  Warnings:

  - You are about to drop the column `userId` on the `AccountDeletionRequest` table. All the data in the column will be lost.
  - You are about to drop the column `userType` on the `AccountDeletionRequest` table. All the data in the column will be lost.
  - You are about to drop the column `otpCode` on the `Driver` table. All the data in the column will be lost.
  - You are about to drop the column `refreshToken` on the `Driver` table. All the data in the column will be lost.
  - You are about to drop the column `otpCode` on the `Passenger` table. All the data in the column will be lost.
  - You are about to drop the column `refreshToken` on the `Passenger` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RideStatus" ADD VALUE 'PENDING';
ALTER TYPE "RideStatus" ADD VALUE 'AWAITING_PAYMENT';

-- DropIndex
DROP INDEX "Driver_currentRideId_idx";

-- DropIndex
DROP INDEX "Passenger_currentRideId_idx";

-- DropIndex
DROP INDEX "Ride_driverId_idx";

-- DropIndex
DROP INDEX "Ride_passengerId_idx";

-- DropIndex
DROP INDEX "Ride_status_createdAt_idx";

-- DropIndex
DROP INDEX "RideLocationHistory_rideId_idx";

-- DropIndex
DROP INDEX "SosAlert_status_idx";

-- DropIndex
DROP INDEX "Transaction_createdAt_idx";

-- DropIndex
DROP INDEX "Transaction_driverId_idx";

-- DropIndex
DROP INDEX "Transaction_passengerId_idx";

-- DropIndex
DROP INDEX "Transaction_rideId_idx";

-- AlterTable
ALTER TABLE "AccountDeletionRequest" DROP COLUMN "userId",
DROP COLUMN "userType",
ADD COLUMN     "driverId" UUID,
ADD COLUMN     "passengerId" UUID;

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Driver" DROP COLUMN "otpCode",
DROP COLUMN "refreshToken",
ADD COLUMN     "otpCodeHash" VARCHAR(100),
ADD COLUMN     "refreshTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Passenger" DROP COLUMN "otpCode",
DROP COLUMN "refreshToken",
ADD COLUMN     "otpCodeHash" VARCHAR(100),
ADD COLUMN     "refreshTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "balanceAfter" DECIMAL(12,2),
ADD COLUMN     "balanceBefore" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(50) NOT NULL,
    "targetId" VARCHAR(100),
    "ipAddress" VARCHAR(45),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_passengerId_idx" ON "AccountDeletionRequest"("passengerId");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_driverId_idx" ON "AccountDeletionRequest"("driverId");

-- CreateIndex
CREATE INDEX "Passenger_status_idx" ON "Passenger"("status");

-- CreateIndex
CREATE INDEX "RideLocationHistory_rideId_createdAt_idx" ON "RideLocationHistory"("rideId", "createdAt");

-- CreateIndex
CREATE INDEX "SosAlert_status_createdAt_idx" ON "SosAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SosAlert_passengerId_idx" ON "SosAlert"("passengerId");

-- CreateIndex
CREATE INDEX "SosAlert_driverId_idx" ON "SosAlert"("driverId");

-- CreateIndex
CREATE INDEX "Transaction_passengerId_createdAt_idx" ON "Transaction"("passengerId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_driverId_createdAt_idx" ON "Transaction"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_reference_idx" ON "Transaction"("reference");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_currentRideId_fkey" FOREIGN KEY ("currentRideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_currentRideId_fkey" FOREIGN KEY ("currentRideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
