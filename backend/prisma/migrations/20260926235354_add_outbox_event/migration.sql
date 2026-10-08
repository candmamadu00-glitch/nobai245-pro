-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'HELD_IN_ESCROW';

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "lastResetAttempt" TIMESTAMP(3),
ADD COLUMN     "resetTokenExpires" TIMESTAMP(3),
ADD COLUMN     "resetTokenHash" VARCHAR(100);

-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "lastResetAttempt" TIMESTAMP(3),
ADD COLUMN     "resetTokenExpires" TIMESTAMP(3),
ADD COLUMN     "resetTokenHash" VARCHAR(100);

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "rideId" UUID;

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_isProcessed_createdAt_idx" ON "OutboxEvent"("isProcessed", "createdAt");
