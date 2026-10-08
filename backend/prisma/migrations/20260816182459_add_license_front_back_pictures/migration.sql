-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('ORANGE_MONEY', 'MTN_MOMO');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "licenseBackPicture" TEXT,
ADD COLUMN     "licenseFrontPicture" TEXT;

-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "paymentAccountNumber" VARCHAR(20),
ADD COLUMN     "paymentProvider" "MobileMoneyProvider";
