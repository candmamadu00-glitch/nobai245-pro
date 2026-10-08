-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'RENTAL';

-- AlterEnum
ALTER TYPE "VehicleType" ADD VALUE 'TOCA_TOCA';

-- DropIndex
DROP INDEX "Driver_isOnline_isAvailable_idx";

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "vehicleSeats" INTEGER;

-- AlterTable
ALTER TABLE "EmergencyContact" ADD COLUMN     "relationship" VARCHAR(50);

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "rentalDays" INTEGER,
ADD COLUMN     "rentalHours" INTEGER;

-- CreateIndex
CREATE INDEX "Driver_isOnline_isAvailable_lastLat_lastLng_idx" ON "Driver"("isOnline", "isAvailable", "lastLat", "lastLng");

-- CreateIndex
CREATE INDEX "SosAlert_rideId_idx" ON "SosAlert"("rideId");

-- CreateIndex
CREATE INDEX "Transaction_rideId_idx" ON "Transaction"("rideId");
