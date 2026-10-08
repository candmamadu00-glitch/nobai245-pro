import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { api } from '../services/api';
import { socket } from '../services/passengerSocket';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

type RideStatus = 'idle' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
type PaymentMethod = 'CASH' | 'ORANGE_MONEY' | 'MTN_MOMO';

export interface DriverInfo { 
  id: string; 
  name: string; 
  photoUrl?: string; 
  carModel?: string; 
  carColor?: string; 
  licensePlate?: string; 
  rating?: number; 
  phone?: string;
  vehicleType?: string;
  startOtp?: string;
}

export interface RideData {
  id: string;
  originAddress: string;
  destinationAddress: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  priceXof: number;
  paymentMethod: PaymentMethod;
  requestedVehicleType: string;
  status: RideStatus;
  startOtp?: string;
  driver?: DriverInfo;
}

interface RideContextData {
  rideStatus: RideStatus;
  setRideStatus: (status: RideStatus) => void;
  activeRide: RideData | null;
  setActiveRide: (ride: RideData | null) => void;
  driverInfo: DriverInfo | null;
  setDriverInfo: (info: DriverInfo | null) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (method: PaymentMethod) => void;
  isLoading: boolean;
  
  requestRide: (ridePayload: any) => Promise<boolean>;
  cancelRide: (reason?: string) => Promise<boolean>;
  resetRide: () => void;
}

interface ApiError {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

const RideContext = createContext<RideContextData>({} as RideContextData);

export const RideProvider = ({ children, passengerId }: { children: ReactNode; passengerId?: string }) => {
  const [rideStatus, setRideStatus] = useState<RideStatus>('idle');
  const [activeRide, setActiveRide] = useState<RideData | null>(null);
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const resetRide = useCallback(() => {
    setActiveRide(null);
    setDriverInfo(null);
    setRideStatus('idle');
  }, []);

  useEffect(() => {
    if (!passengerId) return;

    if (socket.connected) {
      socket.emit('join_room', `passenger:${passengerId}`);
    }

    const handleRideAccepted = (data: { ride: any }) => {
      if (data?.ride) {
        setActiveRide(data.ride);
        if (data.ride.driver) {
          setDriverInfo({
            id: data.ride.driver.id || data.ride.driverId,
            name: data.ride.driver.fullName || 'Motorista',
            photoUrl: formatPhotoUrl(data.ride.driver.profilePicture),
            carModel: data.ride.driver.vehicleBrand,
            carColor: data.ride.driver.vehicleColor,
            licensePlate: data.ride.driver.vehiclePlate,
            rating: data.ride.driver.ratingAverage,
            phone: data.ride.driver.phone,
            startOtp: data.ride.startOtp
          });
        }
        setRideStatus('accepted');
      }
    };

    const handleRideArrived = () => {
      setRideStatus('arrived');
    };

    const handleRideStarted = () => {
      setRideStatus('in_progress');
    };

    const handleRideCompleted = () => {
      setRideStatus('completed');
    };

    const handleRideCancelled = (data: { reason?: string }) => {
      setRideStatus('cancelled');
      Alert.alert(
        'Corrida Cancelada ⚠️', 
        `A corrida foi cancelada. Motivo: ${data?.reason || 'Não informado'}`
      );
      resetRide();
    };

    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:arrived', handleRideArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:completed', handleRideCompleted);
    socket.on('ride:finished', handleRideCompleted);
    socket.on('ride:cancelled', handleRideCancelled);

    return () => {
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:arrived', handleRideArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:completed', handleRideCompleted);
      socket.off('ride:finished', handleRideCompleted);
      socket.off('ride:cancelled', handleRideCancelled);
    };
  }, [passengerId, resetRide]);

  const requestRide = async (ridePayload: any): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await api.post('/rides/request', {
        ...ridePayload,
        paymentMethod
      });

      if (response.data?.success && response.data?.ride) {
        const createdRide = response.data.ride;
        setActiveRide(createdRide);
        setRideStatus('searching');
        
        if (socket.connected) {
          socket.emit('join_room', createdRide.id);
        }
        return true;
      }
      return false;
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const message = apiError.response?.data?.error || apiError.response?.data?.message || 'Não foi possível solicitar a corrida.';
      console.error('❌ [RIDES] Erro ao solicitar corrida:', message);
      Alert.alert('Erro ao solicitar', message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const cancelRide = async (reason?: string): Promise<boolean> => {
    if (!activeRide?.id) return false;

    try {
      setIsLoading(true);
      const response = await api.post('/rides/cancel', {
        rideId: activeRide.id,
        reason: reason || 'Cancelado pelo passageiro'
      });

      if (response.data?.success) {
        resetRide();
        return true;
      }
      return false;
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const message = apiError.response?.data?.error || apiError.response?.data?.message || 'Erro ao cancelar corrida.';
      console.error('❌ [RIDES] Erro ao cancelar corrida:', message);
      Alert.alert('Erro no cancelamento', message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <RideContext.Provider value={{
      rideStatus, setRideStatus,
      activeRide, setActiveRide,
      driverInfo, setDriverInfo,
      paymentMethod, setPaymentMethod,
      isLoading,
      requestRide, cancelRide, resetRide
    }}>
      {children}
    </RideContext.Provider>
  );
};

export function useRide() {
  return useContext(RideContext);
}