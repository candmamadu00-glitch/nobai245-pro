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

    // 1. MOTORISTA ACEITOU A CORRIDA
    const handleRideAccepted = (data: any) => {
      const ride = data?.ride || data;
      if (ride) {
        setActiveRide(ride);
        if (ride.driver) {
          setDriverInfo({
            id: ride.driver.id || ride.driverId,
            name: ride.driver.name || ride.driver.fullName || 'Motorista',
            photoUrl: formatPhotoUrl(ride.driver.profilePicture || ride.driver.avatarUrl),
            carModel: ride.driver.vehicleBrand || ride.driver.carModel,
            carColor: ride.driver.vehicleColor || ride.driver.carColor,
            licensePlate: ride.driver.vehiclePlate || ride.driver.licensePlate,
            rating: ride.driver.ratingAverage || ride.driver.rating || 5.0,
            phone: ride.driver.phone,
            startOtp: ride.startOtp
          });
        }
        setRideStatus('accepted');
      }
    };

    // 2. MOTORISTA PRÓXIMO (< 300m)
    const handleDriverNearby = () => {
      Alert.alert('📍 Motorista Próximo!', 'Seu motorista está a menos de 300 metros do local de embarque.');
    };

    // 3. MOTORISTA CHEGOU AO LOCAL
    const handleRideArrived = (data: any) => {
      setRideStatus('arrived');
      const otp = data?.startOtp || activeRide?.startOtp || '****';
      Alert.alert(
        '🚗 O Motorista Chegou!',
        `Seu motorista está no local. Informe o código OTP abaixo ao embarcar:\n\n🔑 CÓDIGO: ${otp}`,
        [{ text: 'Entendido' }]
      );
    };

    // 4. VIAGEM INICIADA
    const handleRideStarted = () => {
      setRideStatus('in_progress');
    };

    // 5. VIAGEM CONCLUÍDA
    const handleRideCompleted = (data: any) => {
      setRideStatus('completed');
      const price = data?.priceXof || activeRide?.priceXof || '';
      Alert.alert(
        '🏁 Viagem Concluída!',
        `Você chegou ao seu destino.${price ? ` Total: ${price} XOF.` : ''}\nObrigado por viajar com o Nô Bai 245!`,
        [{ text: 'Avaliar Motorista', onPress: () => console.log('Abrir modal de avaliação') }]
      );
    };

    // 6. CORRIDA CANCELADA
    const handleRideCancelled = (data: { reason?: string }) => {
      setRideStatus('cancelled');
      Alert.alert(
        'Corrida Cancelada ⚠️', 
        `A corrida foi cancelada. Motivo: ${data?.reason || 'Não informado'}`
      );
      resetRide();
    };

    // 7. CHECAGEM DE SEGURANÇA (VEÍCULO PARADO > 5 MINUTOS)
    const handleSafetyCheck = (data: { message?: string }) => {
      Alert.alert(
        '🛡️ Checagem de Segurança Nô Bai 245',
        data?.message || 'Notamos que seu veículo está parado há algum tempo. Está tudo bem com você?',
        [
          { text: 'Estou Bem 👍', style: 'cancel' },
          { text: 'Preciso de Ajuda (SOS) 🚨', style: 'destructive', onPress: () => Alert.alert('Alerta SOS', 'Acionando contatos de emergência e central de segurança...') }
        ],
        { cancelable: false }
      );
    };

    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:driver_nearby', handleDriverNearby);
    socket.on('ride:arrived', handleRideArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:completed', handleRideCompleted);
    socket.on('ride:finished', handleRideCompleted);
    socket.on('ride:cancelled', handleRideCancelled);
    socket.on('ride:safety_check', handleSafetyCheck);

    return () => {
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:driver_nearby', handleDriverNearby);
      socket.off('ride:arrived', handleRideArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:completed', handleRideCompleted);
      socket.off('ride:finished', handleRideCompleted);
      socket.off('ride:cancelled', handleRideCancelled);
      socket.off('ride:safety_check', handleSafetyCheck);
    };
  }, [passengerId, resetRide, activeRide?.startOtp, activeRide?.priceXof]);

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