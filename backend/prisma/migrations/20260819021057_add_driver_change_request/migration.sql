/*
  Warnings:

  - You are about to drop the column `licensePicture` on the `Driver` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Driver" DROP COLUMN "licensePicture";

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "requestedVehicleType" "VehicleType" NOT NULL DEFAULT 'PARTICULAR';

-- CreateTable
CREATE TABLE "DriverChangeRequest" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "newFullName" VARCHAR(100),
    "newVehiclePlate" VARCHAR(20),
    "newVehicleBrand" VARCHAR(50),
    "newVehicleColor" VARCHAR(30),
    "newDocumentNumber" VARCHAR(50),
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverChangeRequest_driverId_idx" ON "DriverChangeRequest"("driverId");

-- CreateIndex
CREATE INDEX "DriverChangeRequest_status_idx" ON "DriverChangeRequest"("status");

-- AddForeignKey
ALTER TABLE "DriverChangeRequest" ADD CONSTRAINT "DriverChangeRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
