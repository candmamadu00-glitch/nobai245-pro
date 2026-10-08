/*
  Warnings:

  - Changed the type of `category` on the `Ticket` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `senderId` to the `TicketMessage` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `sender` on the `TicketMessage` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_passengerId_fkey";

-- DropIndex
DROP INDEX "Ticket_status_idx";

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "isApproved" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "deliveryPhotoUrl" TEXT,
ADD COLUMN     "packageNotes" TEXT,
ADD COLUMN     "pickupPhotoUrl" TEXT,
ADD COLUMN     "recipientName" VARCHAR(100),
ADD COLUMN     "recipientPhone" VARCHAR(20);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignedAdminId" UUID,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "createdByType" "UserType" NOT NULL DEFAULT 'DRIVER',
ADD COLUMN     "driverId" UUID,
ADD COLUMN     "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "rideId" UUID,
ALTER COLUMN "passengerId" DROP NOT NULL,
DROP COLUMN "category",
ADD COLUMN     "category" VARCHAR(100) NOT NULL;

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "senderId" UUID NOT NULL,
DROP COLUMN "sender",
ADD COLUMN     "sender" "UserType" NOT NULL;

-- CreateIndex
CREATE INDEX "Ticket_driverId_idx" ON "Ticket"("driverId");

-- CreateIndex
CREATE INDEX "Ticket_rideId_idx" ON "Ticket"("rideId");

-- CreateIndex
CREATE INDEX "Ticket_status_priority_createdAt_idx" ON "Ticket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assignedAdminId_idx" ON "Ticket"("assignedAdminId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
