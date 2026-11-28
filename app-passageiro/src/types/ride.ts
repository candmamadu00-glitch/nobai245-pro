export interface RideDriver {
  id?: string;
  fullName?: string;
  profilePicture?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehiclePlate?: string;
}

export interface Ride {
  id: string;
  status: string;
  originAddress: string;
  destinationAddress: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  distanceKm?: number;
  paymentMethod?: string;
  vehicleType?: string;
  priceXof?: number;
  createdAt: string;
  updatedAt?: string;
  driver?: RideDriver;
}
