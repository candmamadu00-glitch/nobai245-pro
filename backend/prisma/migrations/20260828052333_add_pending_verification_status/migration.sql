-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'PENDING_VERIFICATION';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "mtnNumber" VARCHAR(20),
ADD COLUMN     "orangeNumber" VARCHAR(20);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" VARCHAR(50) NOT NULL DEFAULT 'bai245-system-config',
    "adminOrangeNumber" VARCHAR(20) NOT NULL DEFAULT '245950000000',
    "adminMtnNumber" VARCHAR(20) NOT NULL DEFAULT '245960000000',
    "defaultCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);
