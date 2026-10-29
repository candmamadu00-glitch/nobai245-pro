import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal, 
  KeyboardAvoidingView, Platform, StatusBar, Image, Vibration, Switch,
  Animated, PanResponder, ScrollView, AppState, AppStateStatus
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Haptics from 'expo-haptics';
import * as Battery from 'expo-battery';
import { Ionicons } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { registerAndSendPushToken as registerForPushNotifications } from '../services/notifications';
import { ChatModal } from '../components/ChatModal';
import { saveActionToQueue, processOfflineQueue } from '../services/offlineSync';
import { TurnByTurnSheet } from '../components/TurnByTurnSheet';
import { socket, connectDriverSocket } from '../services/socket';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CancelModal } from '../components/CancelModal';
import { RatingModal } from '../components/RatingModal';
import { StartRideOtpModal } from '../components/StartRideOtpModal';
import { api } from '../services/api';
import { DriverSOSModal } from '../components/DriverSOSModal';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { createAudioPlayer } from 'expo-audio';
import { useBilingualVoice } from '../hooks/useBilingualVoice';
import { updateOngoingRideNotification, dismissOngoingRideNotification } from '../services/ongoingNotification';
// 🛡️ Token Mapbox
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

// 🛡️ Configuração de URL da API
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
const CLEAN_BASE_URL = RAW_API_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const API_URL = `${CLEAN_BASE_URL}/api`;

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
const STORAGE_ACTIVE_RIDE_ID = '@nobai245:activeRideId';
const STORAGE_ACTIVE_RIDE_DATA = '@nobai245:activeRideData';
const STORAGE_ACTIVE_RIDE_STATE = '@nobai245:activeRideState';

const BISSAU_CENTER_LNG = -15.5977;
const BISSAU_CENTER_LAT = 11.8632;

const demandZonesData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [BISSAU_CENTER_LNG, BISSAU_CENTER_LAT] },
      properties: { name: 'Centro de Bissau / Praça do Império' },
    },
  ],
};

function translateToKriol(text: string): string {
  if (!text) return '';
  return text
    .replace(/Vire à direita/gi, 'Dobra pa direitu')
    .replace(/Vire à esquerda/gi, 'Dobra pa eskerda')
    .replace(/Mantenha-se à direita/gi, 'Pega na ladu direitu')
    .replace(/Mantenha-se à esquerda/gi, 'Pega na ladu eskerdu')
    .replace(/Siga em frente/gi, 'Siga na frenti')
    .replace(/Em (\d+) metros/gi, 'Na $1 metro')
    .replace(/Na rotatória/gi, 'Na rotunda')
    .replace(/pegue a (\d+)ª saída/gi, 'pense $1 saída')
    .replace(/Você chegou ao seu destino/gi, 'Bu tchega ja na bu distinu')
    .replace(/Você está se aproximando do seu destino/gi, 'Bu sta kuazi pa tchega na bu distinu');
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const { locations } = data;
  const location = locations?.[0];

  if (location?.coords) {
    const isMocked = location.mocked || (location.coords as any)?.mocked;
    if (isMocked && !__DEV__) return;

    try {
      const storedUser = await AsyncStorage.getItem('@nobai245:driverUser');
      const driverId = storedUser ? JSON.parse(storedUser)?.id : null;
      const rideId = await AsyncStorage.getItem(STORAGE_ACTIVE_RIDE_ID);
      
      let token = await SecureStore.getItemAsync('@nobai245:driverAccessToken');
      if (!token) {
        token = await AsyncStorage.getItem('@nobai245:driverAccessToken') || await AsyncStorage.getItem('@nobai245:driverToken');
      }

      if (!driverId) return;

      const payload = {
        driverId,
        rideId: rideId || undefined,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        speed: Math.max(0, location.coords.speed || 0),
        heading: Math.max(0, location.coords.heading || 0)
      };

      const sendFallbackHttp = async (locPayload: any, authToken: string | null) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          await fetch(`${API_URL}/drivers/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken || ''}`
            },
            body: JSON.stringify(locPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
        } catch {}
      };

      if (socket && socket.connected) {
        socket.timeout(3000).emit('driver:location_update', payload, (err: any) => {
          if (err) sendFallbackHttp(payload, token);
        });
      } else {
        sendFallbackHttp(payload, token);
      }
    } catch (err) {}
  }
});

export type RideState = 'idle' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed';

export interface IncomingRideData {
  rideId: string;
  passengerId: string;
  passengerName?: string;
  passengerPhone?: string;
  passengerPhoto?: string;
  passengerRating?: number;
  pickupLat: number;
  pickupLng: number;
  originAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationAddress?: string;
  referencePoint?: string;
  startOtp?: string;
  serviceType?: 'RIDE' | 'DELIVERY' | 'RENTAL';
  vehicleType?: 'PARTICULAR' | 'TAXI' | 'MOTO' | 'MOTO_CARRO' | 'TOCA_TOCA';
  paymentMethod?: 'ORANGE_MONEY' | 'MTN_MOMO' | 'WALLET' | 'CASH';
  priceXof?: number;
  deliveryNotes?: string;
  recipientName?: string;
  guestName?: string;
  guestPhone?: string;
  extraStopLat?: number;
  extraStopLng?: number;
  extraStopAddress?: string;
  estimatedPrice?: number;
  transactionId?: string;
  stops?: any[]; 
}

export interface CompletedRideInfo { fareXOF: number; distanceKm: number; transactionId: string; }

function calculateDirectDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  const brng = toDeg(Math.atan2(y, x));
  return Math.round((brng + 360) % 360);
}

function getVehicle3DIconAsset(vehicleType?: string, vehicleColor?: string) {
  const type = (vehicleType || 'PARTICULAR').toUpperCase().trim();
  const color = (vehicleColor || 'BRANCO').toUpperCase().trim();

  if (type === 'MOTO') return require('../../assets/images/vehicles/moto.jpg');
  if (type === 'TOCA_TOCA' || type === 'VAN') return require('../../assets/images/vehicles/toca_toca.jpg');
  if (type === 'TAXI') return require('../../assets/images/vehicles/taxi_yellow.jpg');

  switch (color) {
    case 'BLACK': case 'PRETO': return require('../../assets/images/vehicles/car_black.jpg');
    case 'BLUE': case 'AZUL': return require('../../assets/images/vehicles/car_blue.jpg');
    case 'RED': case 'VERMELHO': return require('../../assets/images/vehicles/car_red.jpg');
    case 'ORANGE': case 'LARANJA': return require('../../assets/images/vehicles/car_orange.jpg');
    case 'GREEN': case 'VERDE': return require('../../assets/images/vehicles/car_green.jpg');
    case 'GRAY': case 'SILVER': case 'CINZA': case 'PRATA': return require('../../assets/images/vehicles/car_gray.jpg');
    case 'BROWN': case 'CASTANHO': case 'MARROM': return require('../../assets/images/vehicles/car_brown.jpg');
    case 'YELLOW': case 'AMARELO': return require('../../assets/images/vehicles/car_yellow.jpg');
    case 'WHITE': case 'BRANCO': default: return require('../../assets/images/vehicles/car_white.jpg');
  }
}

const formatCurrency = (val?: number | string | null): string => {
  const num = Number(val || 0);
  if (isNaN(num)) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatWaitTime = (seconds: number = 0): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const formatImageUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${CLEAN_BASE_URL}${cleanPath}`;
};

export function Home() {
  useKeepAwake();

  const { driver } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const audioRecorder = useAudioRecorder();
  const route = useRoute<any>();
  const isMountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  
  const [incomingRide, setIncomingRide] = useState<IncomingRideData | null>(null);
  const [queuedOfferData, setQueuedOfferData] = useState<IncomingRideData | null>(null);
  const [rideState, setRideState] = useState<RideState>('idle');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [completedInfo, setCompletedInfo] = useState<CompletedRideInfo | null>(null);
  const [driverEta, setDriverEta] = useState<number | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<number[][] | null>(null);

  const [isChatVisible, setIsChatVisible] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [finishedRideId, setFinishedRideId] = useState<string | null>(null);
  const [finishedTargetName, setFinishedTargetName] = useState<string>('');
  const [finishedRideSummary, setFinishedRideSummary] = useState<any>(null);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showNavSheet, setShowNavSheet] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);

  const [todayEarnings, setTodayEarnings] = useState<number>(0);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [serviceFilters, setServiceFilters] = useState({ RIDE: true, DELIVERY: true, RENTAL: true });
  
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState(15);
  
  const rideStateRef = useRef(rideState);
  const incomingRideRef = useRef(incomingRide);
  const queuedOfferDataRef = useRef(queuedOfferData);
  const activeRideIdRef = useRef(activeRideId);
  const isOnlineRef = useRef(isOnline);
  const serviceFiltersRef = useRef(serviceFilters);
  const lastDriverCoordsRef = useRef<{ latitude: number; longitude: number; heading: number } | null>(null);
  const { speakInstruction: playBilingualVoice } = useBilingualVoice();
  const alertPlayerRef = useRef<any>(null);

  useEffect(() => { rideStateRef.current = rideState; }, [rideState]);
  useEffect(() => { incomingRideRef.current = incomingRide; }, [incomingRide]);
  useEffect(() => { queuedOfferDataRef.current = queuedOfferData; }, [queuedOfferData]);
  useEffect(() => { activeRideIdRef.current = activeRideId; }, [activeRideId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { serviceFiltersRef.current = serviceFilters; }, [serviceFilters]);

  const panY = useRef(new Animated.Value(0)).current;
  const isExpandedRef = useRef(true);
  const [sheetHeight, setSheetHeight] = useState(380);

  const maxCollapsedY = Math.max(100, sheetHeight - 90 - Math.max(insets.bottom, 20));
  const maxCollapsedYRef = useRef(maxCollapsedY);
  useEffect(() => { maxCollapsedYRef.current = maxCollapsedY; }, [maxCollapsedY]);

  const snapToState = useCallback((toExpanded: boolean) => {
    isExpandedRef.current = toExpanded;
    const targetY = toExpanded ? 0 : maxCollapsedYRef.current;
    Animated.spring(panY, {
      toValue: targetY,
      useNativeDriver: true,
      bounciness: 4,
      speed: 12,
    }).start();
  }, [panY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const maxLimit = maxCollapsedYRef.current;
        let newY = isExpandedRef.current ? gestureState.dy : maxLimit + gestureState.dy;
        if (newY < 0) newY = 0;
        if (newY > maxLimit) newY = maxLimit;
        panY.setValue(newY);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 50 || gestureState.vy > 0.5) {
          snapToState(false);
        } else if (gestureState.dy < -50 || gestureState.vy < -0.5) {
          snapToState(true);
        } else {
          snapToState(isExpandedRef.current);
        }
      },
    })
  ).current;

  const stops = incomingRide?.stops || [];
  const isNavigatingToStop = currentStopIndex < stops.length;
  const displayPassengerName = incomingRide?.guestName || incomingRide?.passengerName || 'Passageiro';
  
  const [waitTimeLeft, setWaitTimeLeft] = useState(300);
  const [canCancelNoShow, setCanCancelNoShow] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isLowBattery, setIsLowBattery] = useState(false);

  const cameraRef = useRef<Mapbox.Camera>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const acceptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCameraUpdateRef = useRef<number>(0);

  const isRideActive = ['accepted', 'arrived', 'in_progress'].includes(rideState);

  const mapStyle = useMemo(() => {
    const hour = new Date().getHours();
    return (hour >= 19 || hour < 6) ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';
  }, []);

  const navDestination = useMemo(() => {
    if (!incomingRide) return null;

    const isHeadingToDestination = rideState === 'in_progress';

    const pLat = Number(incomingRide.pickupLat);
    const pLng = Number(incomingRide.pickupLng);
    const dLat = Number(incomingRide.destinationLat);
    const dLng = Number(incomingRide.destinationLng);

    const destLat = isHeadingToDestination ? (isNaN(dLat) ? BISSAU_CENTER_LAT : dLat) : (isNaN(pLat) ? BISSAU_CENTER_LAT : pLat);
    const destLng = isHeadingToDestination ? (isNaN(dLng) ? BISSAU_CENTER_LNG : dLng) : (isNaN(pLng) ? BISSAU_CENTER_LNG : pLng);

    return {
      latitude: destLat,
      longitude: destLng,
      title: isHeadingToDestination ? 'Destino Final (Desembarque)' : 'Local de Embarque (Buscar Passageiro)',
      address: isHeadingToDestination ? (incomingRide.destinationAddress || 'Destino do Passageiro') : (incomingRide.originAddress || 'Ponto de Encontro'),
    };
  }, [incomingRide, rideState]);

  const profileImageUrl = formatImageUrl(driver?.profilePicture || undefined);

  const fetchTodayEarnings = useCallback(async () => {
    try {
      if (!api || typeof api.get !== 'function') return;
      const response = await api.get('/drivers/finance');
      if (response?.data && isMountedRef.current) {
        setTodayEarnings(Number(response.data.todayEarned ?? response.data.totalEarned ?? 0));
      }
    } catch (err) {}
  }, []);

  useEffect(() => { fetchTodayEarnings(); }, [fetchTodayEarnings, rideState]);

  useEffect(() => {
    if (driver?.id && typeof registerForPushNotifications === 'function') registerForPushNotifications(driver.id);
  }, [driver?.id]);

  useEffect(() => {
    let sub: any = null;
    async function checkBattery() {
      try {
        if (typeof Battery?.getBatteryLevelAsync === 'function') {
          const level = await Battery.getBatteryLevelAsync();
          if (level !== null && level >= 0 && isMountedRef.current) {
            setBatteryLevel(level);
            setIsLowBattery(level > 0 && level <= 0.15);
          }
        }
        if (typeof Battery?.addBatteryLevelListener === 'function') {
          sub = Battery.addBatteryLevelListener(({ batteryLevel: lvl }) => {
            if (isMountedRef.current) {
              setBatteryLevel(lvl);
              setIsLowBattery(lvl > 0 && lvl <= 0.15);
            }
          });
        }
      } catch (e) {}
    }
    checkBattery();
    return () => { if (sub?.remove) sub.remove(); };
  }, []);

  useEffect(() => {
    let activePlayer: any = null;
    const hasActiveOffer = !!queuedOfferData || (rideState === 'idle' && !!incomingRide);

    if (hasActiveOffer) {
      Vibration.vibrate([0, 800, 300, 800], false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      try {
        const player = createAudioPlayer(require('../../assets/sounds/alert.mp3'));
        player.loop = false;
        player.play();
        alertPlayerRef.current = player;
        activePlayer = player;
      } catch (audioErr) {}

      playBilingualVoice('new_ride', 'Nova viagem encontrada');
    } else {
      Vibration.cancel();
      if (alertPlayerRef.current) {
        try { alertPlayerRef.current.pause(); } catch (e) {}
        alertPlayerRef.current = null;
      }
    }

    return () => {
      Vibration.cancel();
      if (activePlayer) {
        try { activePlayer.pause(); } catch (e) {}
      }
    };
  }, [queuedOfferData, incomingRide, rideState, playBilingualVoice]);

  useEffect(() => { if (route.params?.openChat) setIsChatVisible(true); }, [route.params]); 

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (rideState === 'arrived') {
      interval = setInterval(() => {
        if (!isMountedRef.current) return;
        setWaitTimeLeft((prev) => {
          if (prev <= 1) {
            setCanCancelNoShow(true);
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setWaitTimeLeft(300);
      setCanCancelNoShow(false);
    }
    return () => clearInterval(interval);
  }, [rideState]);

  useEffect(() => {
    let syncInterval: ReturnType<typeof setInterval>;
    if (isRideActive && activeRideId) {
      syncInterval = setInterval(() => {
        if (socket && socket.connected) {
          socket.timeout(5000).emit('driver:request_state', (err: any) => {}); 
        } else if (socket) socket.connect();
      }, 10000);
    }
    return () => clearInterval(syncInterval);
  }, [isRideActive, activeRideId]);

  const updateCameraThrottled = useCallback((lng: number, lat: number) => {
    if (!isMapReady || !cameraRef.current) return;
    const now = Date.now();
    if (now - lastCameraUpdateRef.current > 2000) {
      lastCameraUpdateRef.current = now;
      try {
        cameraRef.current.setCamera({ 
          centerCoordinate: [lng, lat], 
          heading: lastDriverCoordsRef.current?.heading || 0,
          zoomLevel: 17, 
          animationDuration: 1000 
        });
      } catch (e) {}
    }
  }, [isMapReady]);

  const persistActiveRideState = async (rideData: IncomingRideData | null, state: RideState, rideId: string | null) => {
    try {
      if (rideData && rideId && state !== 'idle' && state !== 'completed') {
        await AsyncStorage.multiSet([
          [STORAGE_ACTIVE_RIDE_ID, rideId],
          [STORAGE_ACTIVE_RIDE_DATA, JSON.stringify(rideData)],
          [STORAGE_ACTIVE_RIDE_STATE, state]
        ]);
      } else {
        await AsyncStorage.multiRemove([STORAGE_ACTIVE_RIDE_ID, STORAGE_ACTIVE_RIDE_DATA, STORAGE_ACTIVE_RIDE_STATE]);
      }
    } catch (err) {}
  };

  const resetDriverState = useCallback(async () => {
    Vibration.cancel();
    if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
    await AsyncStorage.multiRemove([STORAGE_ACTIVE_RIDE_ID, STORAGE_ACTIVE_RIDE_DATA, STORAGE_ACTIVE_RIDE_STATE]);
    if (!isMountedRef.current) return;
    setRideState('idle'); 
    setActiveRideId(null);
    setIncomingRide(null); 
    setQueuedOfferData(null);
    setCompletedInfo(null);
    setFinishedRideSummary(null);
    setDriverEta(null);
    setRouteCoordinates(null);
    setShowCancelModal(false);
    setShowRatingModal(false);
    setShowReceiptModal(false);
    setShowOtpModal(false);
    setIsLoading(false);
    setShowNavSheet(false);
    snapToState(true);
  }, [snapToState]);

  useEffect(() => {
    async function restoreLocalState() {
      try {
        const storedRideId = await AsyncStorage.getItem(STORAGE_ACTIVE_RIDE_ID);
        const storedRideData = await AsyncStorage.getItem(STORAGE_ACTIVE_RIDE_DATA);
        const storedRideState = await AsyncStorage.getItem(STORAGE_ACTIVE_RIDE_STATE);

        if (storedRideId && storedRideData && storedRideState && isMountedRef.current) {
          setActiveRideId(storedRideId);
          setIncomingRide(JSON.parse(storedRideData));
          setRideState(storedRideState as RideState);
        }
      } catch (err) {}
    }
    restoreLocalState();
  }, []);
// 🟢 ADICIONE O SEU USEEFFECT AQUI:
  useEffect(() => {
    if (!socket) return;

    const handleRideFinishedConfirm = (data: any) => {
      if (data) {
        setFinishedRideSummary((prev: any) => ({
          rideId: data.rideId || prev?.rideId,
          passengerName: prev?.passengerName || 'Passageiro',
          totalAmount: Number(data.priceXof || data.totalAmount || data.amount || prev?.totalAmount || 0),
          paymentMethod: data.paymentMethod || prev?.paymentMethod || 'CASH',
          transactionId: data.transactionId || data.paymentId || prev?.transactionId || `TRX-${Date.now().toString().slice(-6)}`,
        }));
      }
    };

    socket.on('ride:finished', handleRideFinishedConfirm);
    socket.on('driver:ride_finished_confirm', handleRideFinishedConfirm);

    return () => {
      socket.off('ride:finished', handleRideFinishedConfirm);
      socket.off('driver:ride_finished_confirm', handleRideFinishedConfirm);
    };
  }, [socket]);
  const fetchMapboxRoute = async (
    startLng: number, 
    startLat: number, 
    endLng: number, 
    endLat: number,
    waypoints: Array<any> = []
  ) => {
    try {
      const validWaypoints = (waypoints || [])
        .map(w => {
          const lat = Number(w?.lat ?? w?.latitude);
          const lng = Number(w?.lng ?? w?.longitude);
          return (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) ? `${lng},${lat}` : null;
        })
        .filter((wp): wp is string => wp !== null);

      const waypointsString = validWaypoints.length > 0 ? `${validWaypoints.join(';')};` : '';
      const token = MAPBOX_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${waypointsString}${endLng},${endLat}?geometries=geojson&steps=true&voice_instructions=true&banner_instructions=true&language=pt&access_token=${token}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Falha rota Mapbox: ${response.status}`);
      const data = await response.json();

      if (data.routes && data.routes.length > 0 && isMountedRef.current) {
        const route = data.routes[0];
        setRouteCoordinates(route.geometry.coordinates);
        
        const eta = Math.ceil(route.duration / 60);
        setDriverEta(eta);

        if (route.legs && route.legs.length > 0) {
          const steps = route.legs.flatMap((leg: any) => leg.steps || []);
          setRouteSteps(steps);
          setCurrentStepIndex(0);

          if (steps.length > 0 && steps[0]?.maneuver?.instruction) {
            const firstInstruction = translateToKriol(steps[0].maneuver.instruction);
            playBilingualVoice('navigation', firstInstruction);
          }
        }

        if ((activeRideId || incomingRide?.rideId) && driver?.id && location?.coords && socket?.connected) {
          socket.emit('driver:location_update', {
            rideId: activeRideId || incomingRide?.rideId,
            driverId: driver.id,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            speed: location.coords.speed || 0,
            heading: location.coords.heading || 0,
            durationMinutes: eta
          });
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRouteCoordinates([[startLng, startLat], [endLng, endLat]]);
        const distKm = calculateDirectDistance(startLat, startLng, endLat, endLng);
        setDriverEta(Math.max(1, Math.ceil((distKm / 30) * 60)));
      }
    }
  };

  useEffect(() => {
    if (!location?.coords || routeSteps.length === 0 || currentStepIndex >= routeSteps.length) return;

    const currentStep = routeSteps[currentStepIndex];
    if (!currentStep?.maneuver?.location) return;

    const [stepLng, stepLat] = currentStep.maneuver.location;
    const distToStepKm = calculateDirectDistance(
      location.coords.latitude,
      location.coords.longitude,
      stepLat,
      stepLng
    );

    if (distToStepKm * 1000 <= 40) {
      const nextIndex = currentStepIndex + 1;
      if (nextIndex < routeSteps.length) {
        setCurrentStepIndex(nextIndex);
        const nextInstruction = routeSteps[nextIndex]?.maneuver?.instruction;
        if (nextInstruction) {
          playBilingualVoice('navigation', translateToKriol(nextInstruction));
        }
      } else {
        playBilingualVoice('navigation', 'Bu sta kuazi pa tchega na bu distinu');
      }
    }
  }, [location?.coords, routeSteps, currentStepIndex, playBilingualVoice]);

  useEffect(() => {
    if (!location?.coords || !incomingRide) return;

    const driverLat = location.coords.latitude;
    const driverLng = location.coords.longitude;

    const pLat = Number(incomingRide.pickupLat);
    const pLng = Number(incomingRide.pickupLng);
    const dLat = Number(incomingRide.destinationLat);
    const dLng = Number(incomingRide.destinationLng);

    if (rideState === 'accepted' || rideState === 'arrived') {
      if (!isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0) {
        fetchMapboxRoute(driverLng, driverLat, pLng, pLat);
      }
    } else if (rideState === 'in_progress') {
      if (!isNaN(dLat) && !isNaN(dLng) && dLat !== 0 && dLng !== 0) {
        let rawStops = incomingRide.stops;
        if (typeof rawStops === 'string') {
          try { rawStops = JSON.parse(rawStops); } catch (e) { rawStops = []; }
        }

        let pendingStops: any[] = [];
        if (Array.isArray(rawStops) && rawStops.length > 0) {
          pendingStops = rawStops.filter((s: any) => {
            const lat = Number(s.lat ?? s.latitude);
            const lng = Number(s.lng ?? s.longitude);
            return s.status !== 'COMPLETED' && !isNaN(lat) && !isNaN(lng) && lat !== 0;
          });
        }
        fetchMapboxRoute(driverLng, driverLat, dLng, dLat, pendingStops);
      }
    } else if (rideState === 'idle' && incomingRide) {
      if (!isNaN(pLat) && !isNaN(pLng) && !isNaN(dLat) && !isNaN(dLng)) {
        fetchMapboxRoute(pLng, pLat, dLng, dLat);
      }
    } else {
      setRouteCoordinates(null);
    }

    persistActiveRideState(incomingRide, rideState, activeRideId);
  }, [rideState, activeRideId, location?.coords?.latitude, location?.coords?.longitude, incomingRide]);

  const handleNewRideRequest = (data: IncomingRideData & { isQueuedOffer?: boolean; rideId?: string }) => {
    if (!isMountedRef.current) return;

    const currentRideId = activeRideIdRef.current || activeRideId;
    const currentRideState = rideStateRef.current || rideState;
    const newRideId = data.rideId || (data as any).id;

    if (currentRideId && currentRideId === newRideId) return;
    if (incomingRideRef.current?.rideId === newRideId && currentRideState !== 'idle') return;

    setShowReceiptModal(false);
    setShowRatingModal(false);

    const rawType = (data.serviceType || 'RIDE').toString().toUpperCase();
    let normalizedService: 'RIDE' | 'DELIVERY' | 'RENTAL' = 'RIDE';
    if (['ENTREGA', 'DELIVERY'].includes(rawType)) normalizedService = 'DELIVERY';
    if (['ALUGUEL', 'RENTAL'].includes(rawType)) normalizedService = 'RENTAL';

    if (serviceFiltersRef.current && serviceFiltersRef.current[normalizedService] === false) return;

    const rawPrice = (data as any).fareXOF ?? data.priceXof ?? 0;
    let rawStops = data.stops;
    if (typeof rawStops === 'string') {
      try { rawStops = JSON.parse(rawStops); } catch { rawStops = []; }
    }

    let stopsArray: any[] = [];
    if (Array.isArray(rawStops) && rawStops.length > 0) {
      stopsArray = rawStops.map((s: any, index: number) => ({
        ...s,
        id: s.id || `stop_${index}`,
        lat: Number(s.lat ?? s.latitude),
        lng: Number(s.lng ?? s.longitude),
        address: s.address || s.name || `Parada ${index + 1}`,
        status: s.status || 'PENDING'
      }));
    }

    const isCurrentlyInRide = ['accepted', 'arrived', 'in_progress'].includes(currentRideState);

    const formattedOffer = {
      ...data,
      rideId: newRideId,
      referencePoint: (data as any).referencePoint || (data as any).reference_point || '',
      isQueuedOffer: isCurrentlyInRide,
      passengerName: data.passengerName || 'Passageiro',
      passengerRating: data.passengerRating || 5.0,
      serviceType: normalizedService,
      paymentMethod: data.paymentMethod || 'CASH',
      priceXof: typeof rawPrice === 'string' ? parseFloat(rawPrice) : Number(rawPrice),
      pickupLat: Number(data.pickupLat ?? (data as any).originLat),
      pickupLng: Number(data.pickupLng ?? (data as any).originLng),
      destinationLat: Number(data.destinationLat),
      destinationLng: Number(data.destinationLng),
      stops: stopsArray,
    };

    setTimeLeft(15);

    if (isCurrentlyInRide) {
      setQueuedOfferData(formattedOffer);
    } else {
      setQueuedOfferData(null);
      setIncomingRide(formattedOffer);
    }

    snapToState(true);
    Vibration.vibrate([0, 500, 200, 500], false);
  };

  const handleRideAccepted = async (data: any) => {
    Vibration.cancel();
    if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
    if (!isMountedRef.current) return;
    setIsLoading(false);

    const currentRideState = rideStateRef.current || rideState;
    const isCurrentlyInRide = ['accepted', 'arrived', 'in_progress'].includes(currentRideState);

    if (data.driverId === driver?.id || data.rideId) {
      if (!isCurrentlyInRide || activeRideIdRef.current === data.rideId) {
        setActiveRideId(data.rideId);
        setRideState('accepted');
        setIncomingRide((prev) => ({
          ...prev,
          ...data,
          rideId: data.rideId,
          passengerName: data.passengerName || prev?.passengerName || 'Passageiro',
          pickupLat: Number(data.pickupLat || prev?.pickupLat || 0),
          pickupLng: Number(data.pickupLng || prev?.pickupLng || 0),
          destinationLat: Number(data.destinationLat || prev?.destinationLat || 0),
          destinationLng: Number(data.destinationLng || prev?.destinationLng || 0),
          priceXof: Number(data.priceXof || prev?.priceXof || 0),
        }));
        if (incomingRideRef.current) {
          persistActiveRideState(incomingRideRef.current, 'accepted', data.rideId);
        }
        snapToState(true);
      }
    } else {
      setQueuedOfferData(null);
      setIncomingRide(null);
    }
  };

  const handleRideStarted = () => {
    if (!isMountedRef.current) return;
    setIsLoading(false);
    setRideState('in_progress');
    setShowOtpModal(false);
    snapToState(true);
    if (incomingRideRef.current && activeRideIdRef.current) {
      persistActiveRideState(incomingRideRef.current, 'in_progress', activeRideIdRef.current);
    }
  };

  const syncActiveRideWithServer = useCallback(async () => {
    try {
      if (!api || typeof api.get !== 'function') return;
      const response = await api.get('/drivers/active-ride').catch(() => null);
      if (response?.data?.ride && isMountedRef.current) {
        const activeRide = response.data.ride;
        const mappedState: RideState = 
          activeRide.status === 'ACCEPTED' ? 'accepted' :
          activeRide.status === 'ARRIVED' ? 'arrived' :
          activeRide.status === 'IN_PROGRESS' ? 'in_progress' : 'idle';

        if (mappedState !== 'idle') {
          let rawStops = activeRide.stops;
          if (typeof rawStops === 'string') {
            try { rawStops = JSON.parse(rawStops); } catch { rawStops = []; }
          }

          let stopsArray: any[] = [];
          if (Array.isArray(rawStops) && rawStops.length > 0) {
            stopsArray = rawStops.map((s: any, idx: number) => ({
              ...s,
              id: s.id || `stop_${idx}`,
              lat: Number(s.lat ?? s.latitude),
              lng: Number(s.lng ?? s.longitude),
              address: s.address || s.name || `Parada ${idx + 1}`,
              status: s.status || 'PENDING'
            }));
          }

          setActiveRideId(activeRide.id);
          setRideState(mappedState);
          setIncomingRide({
            rideId: activeRide.id,
            referencePoint: (activeRide as any)?.referencePoint || (activeRide as any)?.reference_point || '',
            passengerId: activeRide.passengerId,
            passengerName: activeRide.passenger?.fullName || 'Passageiro',
            passengerPhone: activeRide.passenger?.phone,
            passengerPhoto: activeRide.passenger?.profilePicture,
            passengerRating: activeRide.passenger?.ratingAverage || 5.0,
            pickupLat: Number(activeRide.originLat),
            pickupLng: Number(activeRide.originLng),
            originAddress: activeRide.originAddress,
            destinationLat: Number(activeRide.destinationLat),
            destinationLng: Number(activeRide.destinationLng),
            destinationAddress: activeRide.destinationAddress,
            priceXof: Number(activeRide.priceXof),
            paymentMethod: activeRide.paymentMethod,
            stops: stopsArray,
          } as any);
          persistActiveRideState(activeRide, mappedState, activeRide.id);
        }
      }
    } catch (err) {}
  }, []);

  const handleRideFinished = async (data: any) => {
    if (!isMountedRef.current) return;
    setIsLoading(false);
    setCompletedInfo({ fareXOF: data.fareXOF, distanceKm: data.distanceKm, transactionId: data.transactionId });

    if (data.hasQueuedRide && data.nextRideId) {
      setActiveRideId(data.nextRideId);
      setRideState('accepted');
      setShowReceiptModal(false);
      fetchTodayEarnings();
      await syncActiveRideWithServer();
    } else {
      setActiveRideId(null);
      setIncomingRide(null);
      setQueuedOfferData(null);
      setRideState('idle'); 
      setShowReceiptModal(true);
      setShowNavSheet(false);
      persistActiveRideState(null, 'idle', null);
      fetchTodayEarnings();
    }
  };

  const handleQueuedNowActive = async (data: { rideId: string; status: string }) => {
    if (!isMountedRef.current) return;
    setActiveRideId(data.rideId);
    setRideState('accepted');
    snapToState(true);
    await syncActiveRideWithServer();
  };

  const handleRideCancelled = (data: { cancelledBy?: string; rideId?: string }) => {
    if (!isMountedRef.current) return;
    setIsLoading(false);

    if (data.rideId && queuedOfferDataRef.current && data.rideId === queuedOfferDataRef.current.rideId) {
      setQueuedOfferData(null);
      return;
    }
    resetDriverState();
  };

  useEffect(() => {
    const handleConnect = async () => {
      if (driver?.id) {
        await processOfflineQueue(socket);
        socket.emit('driver:request_state');
        
        if (isOnlineRef.current && location?.coords) {
          socket.emit('driver:online', { 
            driverId: driver.id, 
            lat: location.coords.latitude, 
            lng: location.coords.longitude 
          });
        }
      }
    };

    if (socket && !socket.connected) socket.connect();

    socket.on('connect', handleConnect);
    socket.on('ride:new_request', handleNewRideRequest);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('driver:accept_ride_success', handleRideAccepted);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:queued_now_active', handleQueuedNowActive);
    socket.on('ride:cancelled', handleRideCancelled);

    return () => {
      Vibration.cancel();
      socket.off('connect', handleConnect);
      socket.off('ride:new_request', handleNewRideRequest);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('driver:accept_ride_success', handleRideAccepted);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:queued_now_active', handleQueuedNowActive);
      socket.off('ride:cancelled', handleRideCancelled);
    };
  }, [driver?.id, resetDriverState, snapToState, syncActiveRideWithServer]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const currentOffer = queuedOfferData || (rideState === 'idle' ? incomingRide : null);

    if (currentOffer) {
      if (timeLeft > 0) {
        timer = setInterval(() => {
          if (isMountedRef.current) setTimeLeft((prev) => prev - 1);
        }, 1000);
      } else {
        Vibration.cancel();
        if (isMountedRef.current) {
          setQueuedOfferData(null);
          if (rideState === 'idle') setIncomingRide(null);
          setTimeLeft(15);
        }
      }
    }
    return () => clearInterval(timer);
  }, [queuedOfferData, incomingRide, timeLeft, rideState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (socket && !socket.connected) {
          await connectDriverSocket();
        }
        await syncActiveRideWithServer();
      }
      appStateRef.current = nextAppState;
    });

    return () => { subscription.remove(); };
  }, [syncActiveRideWithServer]);

  async function stopBackgroundLocation() {
    const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (hasTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  const startTrackingForState = async (currentState: RideState) => {
    if (locationWatcherRef.current) { 
      locationWatcherRef.current.remove(); 
      locationWatcherRef.current = null; 
    }

    const isActive = ['accepted', 'arrived', 'in_progress'].includes(currentState);
    
    let timeInterval = isActive ? 2000 : 6000;
    let distanceInterval = isActive ? 3 : 10;

    if (isLowBattery) {
      timeInterval = isActive ? 5000 : 12000;
      distanceInterval = isActive ? 8 : 20;
    }

    try {
      const hasStartedBg = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (!hasStartedBg) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: isActive ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
          timeInterval,
          distanceInterval,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Nô Bai 245 Motorista',
            notificationBody: isActive ? 'Navegação de corrida ativa' : 'Você está online e visível',
            notificationColor: '#0E243C',
          },
        }).catch(() => {});
      }

      locationWatcherRef.current = await Location.watchPositionAsync(
        { 
          accuracy: isActive ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced, 
          timeInterval, 
          distanceInterval 
        },
        (newLocation) => {
          if (!isMountedRef.current) return;
          setLocation(newLocation);

          const { latitude, longitude } = newLocation.coords;
          let calculatedHeading = newLocation.coords.heading;

          if (calculatedHeading == null || calculatedHeading < 0) {
            if (lastDriverCoordsRef.current) {
              const distKm = calculateDirectDistance(
                lastDriverCoordsRef.current.latitude,
                lastDriverCoordsRef.current.longitude,
                latitude,
                longitude
              );

              if (distKm * 1000 > 2) {
                calculatedHeading = calculateBearing(
                  lastDriverCoordsRef.current.latitude,
                  lastDriverCoordsRef.current.longitude,
                  latitude,
                  longitude
                );
              } else {
                calculatedHeading = lastDriverCoordsRef.current.heading || 0;
              }
            } else {
              calculatedHeading = 0;
            }
          }

          lastDriverCoordsRef.current = { latitude, longitude, heading: calculatedHeading };

          updateCameraThrottled(longitude, latitude);

          if (driver?.id && socket?.connected) {
            socket.emit('driver:location_update', {
              driverId: driver.id,
              rideId: activeRideIdRef.current || undefined,
              latitude,
              longitude,
              speed: Math.max(0, newLocation.coords.speed || 0),
              heading: calculatedHeading,
            });
          }
        }
      );
    } catch (e) {}
  };

  async function startTracking() {
    if (driver?.status !== 'APPROVED') {
      return Alert.alert('Conta em Análise', 'Aguarde a aprovação dos documentos.');
    }

    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      return Alert.alert('Permissão Necessária', 'Permita acesso à localização.');
    }

    try {
      const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const isMocked = currentLoc.mocked || (currentLoc.coords as any)?.mocked;
      
      if (isMocked && !__DEV__) {
        if (isMountedRef.current) setIsOnline(false);
        return Alert.alert('GPS Simulado Detectado', 'Desative o aplicativo de GPS Falso.');
      }

      setIsOnline(true);
      const activeSocket = await connectDriverSocket();

      if (isMountedRef.current) {
        setLocation(currentLoc);
        if (cameraRef.current) {
          cameraRef.current.setCamera({ 
            centerCoordinate: [currentLoc.coords.longitude, currentLoc.coords.latitude], 
            zoomLevel: 16 
          });
        }
      }

      const socketToUse = (activeSocket as any) || socket;
      if (socketToUse) {
        const payload = {
          driverId: driver?.id,
          latitude: currentLoc.coords.latitude,
          longitude: currentLoc.coords.longitude,
          lat: currentLoc.coords.latitude,
          lng: currentLoc.coords.longitude,
          heading: currentLoc.coords.heading || 0,
          speed: currentLoc.coords.speed || 0,
        };

        socketToUse.emit('driver:online', payload);
        socketToUse.emit('driver:location_update', payload);
      }

      await startTrackingForState(rideState);
    } catch (e) {
      if (isMountedRef.current) setIsOnline(false);
    }
  }

  function stopTracking() {
    if (driver?.id && socket && socket.connected) {
      socket.timeout(2000).emit('driver:offline', { driverId: driver.id });
    }
    setIsOnline(false);
    if (locationWatcherRef.current) { 
      locationWatcherRef.current.remove(); 
      locationWatcherRef.current = null; 
    }
    stopBackgroundLocation();
  }

  useEffect(() => { if (isOnline) startTrackingForState(rideState); }, [rideState, isOnline, isLowBattery]);

  function acceptRide(rideId: string, driverId: string, currentLat: number, currentLng: number) {
    Vibration.cancel();
    setIsLoading(true);

    activeRideIdRef.current = rideId;
    rideStateRef.current = 'accepted';
    setQueuedOfferData(null);

    if (!socket || !socket.connected) {
      setIsLoading(false);
      return Alert.alert('Sem Conexão', 'Sinal de internet insuficiente.');
    }

    socket.timeout(8000).emit('driver:accept_ride', { 
      rideId, driverId, driverLat: currentLat, driverLng: currentLng 
    }, (err: any, response: any) => {
      if (!isMountedRef.current) return;
      setIsLoading(false);

      if (err) return Alert.alert('Sinal Fraco 📡', 'Não foi possível confirmar a tempo.');
      
      if (response?.error) {
        setQueuedOfferData(null); 
        return Alert.alert('Aviso', response.message);
      }

      setActiveRideId(rideId);
      setRideState('accepted');
      if (queuedOfferDataRef.current) {
        setIncomingRide(queuedOfferDataRef.current);
        persistActiveRideState(queuedOfferDataRef.current, 'accepted', rideId);
      }
      setQueuedOfferData(null);
      snapToState(true);
    });
  }

  async function handleArrived() {
    if (!activeRideId) return;
    setIsLoading(true);
    const payload = { rideId: activeRideId };

    const processOffline = async () => {
      await saveActionToQueue('driver:arrived', payload);
      if (isMountedRef.current) {
        setRideState('arrived');
        if (incomingRide) persistActiveRideState(incomingRide, 'arrived', activeRideId);
        setDriverEta(null);
        setIsLoading(false);
      }
    };

    if (socket && socket.connected) {
      socket.timeout(4000).emit('driver:arrived', payload, async (err: any) => {
        if (!isMountedRef.current) return;
        if (err) {
          await processOffline();
        } else {
          setRideState('arrived');
          if (incomingRide) persistActiveRideState(incomingRide, 'arrived', activeRideId);
          setDriverEta(null);
          setIsLoading(false);
        }
      });
    } else {
      await processOffline();
    }
  }

  function handleConfirmCancel(reason: string) {
    if (!activeRideId) return;
    setShowCancelModal(false);
    resetDriverState(); 

    if (socket && socket.connected) {
      socket.timeout(3000).emit('ride:cancel', { rideId: activeRideId, userId: driver?.id, userType: 'DRIVER', reason }, (err: any) => {
        if (err) saveActionToQueue('ride:cancel', { rideId: activeRideId, userId: driver?.id, userType: 'DRIVER', reason });
      });
    } else {
      saveActionToQueue('ride:cancel', { rideId: activeRideId, userId: driver?.id, userType: 'DRIVER', reason });
    }
  }

  async function handleStartRideWithOtp(otp: string) {
    if (!activeRideId) return;
    setIsLoading(true);
    const payload = { rideId: activeRideId, otp };

    const processOfflineStart = async () => {
      await saveActionToQueue('driver:start_ride', payload);
      if (isMountedRef.current) {
        setRideState('in_progress');
        setShowOtpModal(false);
        if (incomingRide) persistActiveRideState(incomingRide, 'in_progress', activeRideId);
        setIsLoading(false);
      }
    };

    if (socket && socket.connected) {
      socket.timeout(5000).emit('driver:start_ride', payload, async (err: any, response: any) => {
        if (!isMountedRef.current) return;
        if (err) {
          await processOfflineStart();
        } else if (response?.error) {
          Alert.alert('Erro no PIN', response.message || 'PIN incorreto. Tente novamente.');
          setIsLoading(false);
        } else {
          setRideState('in_progress');
          setShowOtpModal(false);
          if (incomingRide) persistActiveRideState(incomingRide, 'in_progress', activeRideId);
          setIsLoading(false);
        }
      });
    } else {
      await processOfflineStart();
    }
  }

  async function handleFinishRide() {
  if (!activeRideId) return;
  setIsLoading(true);

  const fallbackLat = Number(location?.coords?.latitude || incomingRide?.destinationLat || BISSAU_CENTER_LAT);
  const fallbackLng = Number(location?.coords?.longitude || incomingRide?.destinationLng || BISSAU_CENTER_LNG);
  const payload = { rideId: activeRideId, dropoffLat: fallbackLat, dropoffLng: fallbackLng };

  // 🟢 Captura o valor final e a forma de pagamento do objeto de corrida
  const finalPrice = Number(incomingRide?.priceXof || incomingRide?.estimatedPrice || 0);
  const paymentMethod = incomingRide?.paymentMethod || 'CASH';
  const transactionId = incomingRide?.transactionId || `TRX-${Date.now().toString().slice(-6)}`;

  // 🟢 Preenche o estado do recibo antes de abrir o modal
  setFinishedRideSummary({
    rideId: activeRideId,
    passengerName: displayPassengerName,
    totalAmount: finalPrice,
    paymentMethod: paymentMethod,
    transactionId: transactionId,
  });

  setFinishedRideId(activeRideId);
  setFinishedTargetName(displayPassengerName);

  if (socket && socket.connected) {
    socket.emit('driver:finish_ride', payload);
  } else {
    await saveActionToQueue('driver:finish_ride', payload);
  }

  setIsLoading(false);
  setShowReceiptModal(true);
}

  function handleNoShowCancel() {
    Alert.alert(
      'Cancelar por Ausência?',
      'O tempo limite de espera expirou. Deseja cancelar esta corrida e receber a taxa de cancelamento?',
      [
        { text: 'Aguardar mais um pouco', style: 'cancel' },
        { text: 'Confirmar No-Show', style: 'destructive', onPress: () => handleConfirmCancel('PASSENGER_NO_SHOW') }
      ]
    );
  }

  function handleSubmitRating(stars: number, tags: string[], comment: string) {
    const rideToRate = finishedRideId || activeRideId;
    if (rideToRate && incomingRide && socket && socket.connected) {
      socket.emit('ride:rate', { 
        rideId: rideToRate, 
        reviewerId: driver?.id, 
        reviewerType: 'DRIVER', 
        receiverId: incomingRide.passengerId, 
        stars, 
        tags, 
        comment 
      });
    }
    setShowRatingModal(false);
    setFinishedRideId(null);
    resetDriverState();
  }

  function handleCallPassenger() {
    setIsChatVisible(true);
  }

  const handleRecenterMap = () => {
    if (location?.coords && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [location.coords.longitude, location.coords.latitude],
        zoomLevel: 16,
        animationDuration: 1000,
      });
    }
  };

  const toggleAudioRecording = async () => {
    try {
      if ((audioRecorder as any)?.isRecording) {
        if (typeof (audioRecorder as any)?.stopRecording === 'function') {
          await (audioRecorder as any).stopRecording();
        }
        Alert.alert('Gravação Encerrada', 'O áudio de segurança foi gravado localmente.');
      } else {
        if (typeof (audioRecorder as any)?.startRecording === 'function') {
          await (audioRecorder as any).startRecording();
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (err) {}
  };

  const topHeaderInset = Math.max((insets?.top || 0) + 10, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 16);
  const bottomInset = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 24 : 16);

  // 1º Declare activeOffer PRIMEIRO:
const activeOffer = (queuedOfferData && queuedOfferData.rideId !== activeRideId) 
  ? queuedOfferData 
  : (rideState === 'idle' ? incomingRide : null);

// 2º Declare formattedStops LOGO DEPOIS:
const formattedStops = useMemo(() => {
  const stopsSource = activeOffer?.stops || incomingRide?.stops;
  if (!stopsSource) return [];
  let raw = stopsSource;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any, idx: number) => ({
    id: s.id || `stop_${idx}`,
    address: s.address || s.name || s.extraStopAddress || `Parada ${idx + 1}`,
    lat: Number(s.lat ?? s.latitude ?? 0),
    lng: Number(s.lng ?? s.longitude ?? 0),
    status: s.status || 'PENDING'
  }));
}, [activeOffer?.stops, incomingRide?.stops]);
  return (
  <View style={styles.container}>
    <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
    
    {/* 🗺️ MAPA DE NAVEGAÇÃO MAPBOX */}
    <Mapbox.MapView 
      style={StyleSheet.absoluteFill} 
      styleURL={mapStyle}
      logoEnabled={false}
      compassEnabled={false}
      scaleBarEnabled={false}
      attributionEnabled={false}
      onDidFinishLoadingMap={() => setIsMapReady(true)}
    >
      <Mapbox.Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: [
            Number(location?.coords.longitude || BISSAU_CENTER_LNG), 
            Number(location?.coords.latitude || BISSAU_CENTER_LAT)
          ],
          zoomLevel: 16,
        }}
        animationMode="flyTo"
        animationDuration={1000}
      />

      {/* 🔴 ZONAS DE ALTA DEMANDA */}
      {isOnline && !isRideActive && (
        <Mapbox.ShapeSource id="demandZonesSource" shape={demandZonesData as any}>
          <Mapbox.CircleLayer 
            id="demandZonesLayer" 
            style={{ 
              circleRadius: 40, 
              circleColor: '#FF3300', 
              circleOpacity: 0.2, 
              circleBlur: 0.6 
            }} 
          />
        </Mapbox.ShapeSource>
      )}

      {/* 🏎️ MARCADOR VEICULAR 3D */}
      {isOnline && location?.coords && (
        <Mapbox.PointAnnotation 
          key={`driver-car-${driver?.id || 'active'}`}
          id="car-location" 
          coordinate={[
            Number(location.coords.longitude || 0), 
            Number(location.coords.latitude || 0)
          ]}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.vehicle3DContainer}>
            <View 
              style={[
                styles.vehicle3DRotator,
                { 
                  transform: [
                    { 
                      rotate: `${Math.round(
                        Number(lastDriverCoordsRef.current?.heading) || 
                        Number(location.coords.heading) || 0
                      )}deg` 
                    }
                  ]
                }
              ]}
            >
              <Image
                source={getVehicle3DIconAsset(
                  (driver as any)?.vehicleType || incomingRide?.vehicleType || 'PARTICULAR',
                  (driver as any)?.carColor || 'BRANCO'
                )}
                style={styles.vehicle3DImage}
                fadeDuration={0}
                resizeMode="contain"
              />
            </View>
          </View>
        </Mapbox.PointAnnotation>
      )}

      {/* 🛣️ LINHA DA ROTA */}
      {routeCoordinates && routeCoordinates.length > 0 && (
        <Mapbox.ShapeSource 
          id="routeSource" 
          shape={{ 
            type: 'Feature', 
            properties: {}, 
            geometry: { type: 'LineString', coordinates: routeCoordinates } 
          }}
        >
          <Mapbox.LineLayer 
            id="routeLine" 
            style={{ 
              lineColor: rideState === 'in_progress' ? '#3B82F6' : '#EAB308', 
              lineWidth: 5, 
              lineCap: 'round', 
              lineJoin: 'round' 
            }} 
          />
        </Mapbox.ShapeSource>
      )}

      {/* 📍 PARADAS INTERMEDIÁRIAS NO MAPA */}
      {formattedStops.length > 0 && formattedStops.map((stop: any, index: number) => {
        if (!stop.lng || !stop.lat) return null;
        const isPassed = index < currentStopIndex;
        return (
          <Mapbox.PointAnnotation key={`stop-${stop.id || index}`} id={`stop-${stop.id || index}`} coordinate={[stop.lng, stop.lat]}>
            <View style={[styles.carMarkerContainer, { backgroundColor: isPassed ? '#64748B' : '#3B82F6' }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>P{index + 1}</Text>
            </View>
          </Mapbox.PointAnnotation>
        );
      })}

      {/* 🏁 PONTO DE DESEMBARQUE */}
      {incomingRide?.destinationLng != null && incomingRide?.destinationLat != null && !isNaN(Number(incomingRide.destinationLng)) && !isNaN(Number(incomingRide.destinationLat)) && (
        <Mapbox.PointAnnotation id="dropoffMarker" coordinate={[Number(incomingRide.destinationLng), Number(incomingRide.destinationLat)]}>
          <View style={styles.markerDestination}>
            <Ionicons name="flag" size={18} color="#FFFFFF" />
          </View>
        </Mapbox.PointAnnotation>
      )}
    </Mapbox.MapView>

    {/* 📊 HEADER SUPERIOR FLUTUANTE */}
    <View style={[styles.headerContainer, { top: topHeaderInset }]} pointerEvents="box-none">
      <View style={styles.headerRow}>
        <TouchableOpacity 
          style={[styles.statusPill, isOnline ? styles.pillOnline : styles.pillOffline]} 
          onPress={isOnline ? stopTracking : startTracking} 
          disabled={rideState !== 'idle' || isLoading}
          activeOpacity={0.85}
        >
          <View style={[styles.statusDot, isOnline ? styles.dotGreen : styles.dotRed]} />
          <Text style={[styles.statusPillText, { color: isOnline ? '#0F172A' : '#FFFFFF' }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.earningsPill} onPress={() => navigation.navigate('Earnings')} activeOpacity={0.85}>
          <Ionicons name="wallet-outline" size={15} color="#10B981" />
          <Text style={styles.earningsPillText}>{formatCurrency(todayEarnings)} XOF</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.filterPill} onPress={() => setShowFilterModal(true)} activeOpacity={0.85}>
          <Ionicons name="options-outline" size={18} color="#EAB308" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.profilePill} onPress={() => navigation.navigate('Profile')} activeOpacity={0.85}>
          {profileImageUrl ? (
            <Image source={{ uri: profileImageUrl }} style={styles.headerProfileImage} />
          ) : (
            <Ionicons name="person-circle-outline" size={24} color="#EAB308" />
          )}
        </TouchableOpacity>
      </View>

      {isLowBattery && !isRideActive && (
        <View style={styles.lowBatteryBanner}>
          <Ionicons name="battery-dead" size={13} color="#FFFFFF" />
          <Text style={styles.lowBatteryText}>
            Bateria Fraca ({Math.round((batteryLevel || 0) * 100)}%) - Modo Economia Ativo
          </Text>
        </View>
      )}
    </View>

    {/* 🎛️ BOTÕES FLUTUANTES */}
    <View style={styles.floatingButtonsWrapper} pointerEvents="box-none">
      <TouchableOpacity style={styles.recenterButton} onPress={handleRecenterMap} activeOpacity={0.85}>
        <Ionicons name="locate" size={20} color="#EAB308" />
      </TouchableOpacity>

      {isOnline && (
        <TouchableOpacity style={styles.sosButton} onPress={() => setShowSosModal(true)} activeOpacity={0.85}>
          <Text style={styles.sosText}>🚨 SOS</Text>
        </TouchableOpacity>
      )}

      {rideState === 'in_progress' && (
        <TouchableOpacity 
          style={[styles.audioRecordButton, audioRecorder.isRecording && styles.audioRecordButtonActive]} 
          onPress={toggleAudioRecording}
          activeOpacity={0.85}
        >
          <Ionicons name={audioRecorder.isRecording ? 'mic' : 'mic-outline'} size={16} color="#FFFFFF" />
          <Text style={styles.audioRecordText}>{audioRecorder.isRecording ? 'Gravando...' : 'Gravar Áudio'}</Text>
        </TouchableOpacity>
      )}
    </View>

    {/* 🛡️ MODAIS DE SEGURANÇA E AVALIAÇÃO */}
    <DriverSOSModal visible={showSosModal} onClose={() => setShowSosModal(false)} currentRideId={activeRideId} />
    <RatingModal visible={showRatingModal} targetName={finishedTargetName} isDriverEvaluating={true} onClose={() => setShowRatingModal(false)} onSubmit={handleSubmitRating} />

    {/* 📋 PAINEL INFERIOR (BOTTOM SHEET) */}
    <KeyboardAvoidingView 
      style={styles.bottomSheetWrapper} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
      pointerEvents="box-none"
    >
      <Animated.View 
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - sheetHeight) > 5) {
            setSheetHeight(h);
          }
        }}
        style={[
          styles.bottomSheet, 
          { 
            paddingBottom: bottomInset,
            transform: [{ translateY: panY }] 
          }
        ]}
      >
        <TouchableOpacity 
          activeOpacity={0.8}
          onPress={() => snapToState(!isExpandedRef.current)}
          style={styles.dragHandleArea} 
          {...panResponder.panHandlers}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.dragHintText}>
            {isExpandedRef.current ? '▼ Arraste para recolher' : '▲ Toque para expandir'}
          </Text>
        </TouchableOpacity>

        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}>
          {rideState === 'idle' && (
            <View style={styles.idleContainer}>
              <Text style={styles.idleTitle}>{isOnline ? 'Buscando solicitações...' : 'Pronto para dirigir?'}</Text>
              <Text style={styles.idleSub}>
                {isOnline ? 'Mantenha o aplicativo aberto para receber chamados na sua região.' : 'Fique online para começar a receber corridas.'}
              </Text>
              {!isOnline && (
                <TouchableOpacity style={styles.goOnlineBtn} onPress={startTracking} activeOpacity={0.85}>
                  <Text style={styles.goOnlineText}>Ficar Online</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {isRideActive && incomingRide && (
            <View style={styles.activeRideContainer}>
              
              <View style={styles.compactHeaderRow}>
                <View style={styles.serviceBadgeRow}>
                  {incomingRide.serviceType === 'DELIVERY' ? (
                    <View style={[styles.serviceTypeBadge, { backgroundColor: '#3B82F6' }]}>
                      <Ionicons name="cube" size={12} color="#FFFFFF" />
                      <Text style={styles.serviceTypeBadgeText}>ENTREGA DE ENCOMENDA</Text>
                    </View>
                  ) : incomingRide.serviceType === 'RENTAL' ? (
                    <View style={[styles.serviceTypeBadge, { backgroundColor: '#7C3AED' }]}>
                      <Ionicons name="time" size={12} color="#FFFFFF" />
                      <Text style={styles.serviceTypeBadgeText}>ALUGUEL</Text>
                    </View>
                  ) : (
                    <View style={[styles.serviceTypeBadge, { backgroundColor: '#EAB308' }]}>
                      <Ionicons name="car-sport" size={12} color="#0F172A" />
                      <Text style={[styles.serviceTypeBadgeText, { color: '#0F172A' }]}>CORRIDA DE PASSAGEIRO</Text>
                    </View>
                  )}
                </View>

                {incomingRide?.priceXof ? (
                  <View style={styles.priceBadgeContainer}>
                    <Text style={styles.priceBadgeText}>{formatCurrency(incomingRide?.priceXof)} XOF</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.etaHeader}>
                <Text style={styles.rideStateTitle}>
                  {rideState === 'accepted' 
                    ? (driverEta ? `Chegando em ${driverEta} min` : 'Indo ao local de embarque') 
                    : rideState === 'arrived' 
                    ? 'Aguardando Cliente' 
                    : (driverEta ? `Chegando ao destino em ${driverEta} min` : 'Viagem em Andamento')}
                </Text>

                {/* 🟢 BADGE DE DISTÂNCIA DINÂMICA */}
                {incomingRide?.pickupLat && incomingRide?.destinationLat ? (
                  <View style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#3B82F6',
                    alignSelf: 'flex-start',
                    marginTop: 6
                  }}>
                    <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: '700' }}>
                      📏 Distância: {(
                        (incomingRide as any)?.distance || 
                        calculateDirectDistance(
                          incomingRide.pickupLat, 
                          incomingRide.pickupLng, 
                          incomingRide.destinationLat, 
                          incomingRide.destinationLng ?? 0
                        )
                      ).toFixed(1)} km
                    </Text>
                  </View>
                ) : null}

                {rideState === 'arrived' && (
                  <View style={styles.waitTimerBox}>
                    <Ionicons name="timer-outline" size={14} color={canCancelNoShow ? '#EF4444' : '#EAB308'} />
                    <Text style={[styles.waitTimerText, canCancelNoShow && { color: '#EF4444' }]}>
                      {canCancelNoShow ? 'Tempo limite atingido!' : `Tempo grátis: ${formatWaitTime(waitTimeLeft)}`}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.passengerProfileCard}>
                <View style={styles.passengerPhotoContainer}>
                  {incomingRide.passengerPhoto ? (
                    <Image source={{ uri: formatImageUrl(incomingRide.passengerPhoto) }} style={styles.passengerPhoto} />
                  ) : (
                    <Ionicons name="person" size={18} color="#94A3B8" />
                  )}
                </View>
                <View style={styles.passengerDetails}>
                  <Text style={styles.passengerName}>{displayPassengerName}</Text>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={12} color="#EAB308" />
                    <Text style={styles.ratingText}>{incomingRide.passengerRating?.toFixed(1) || '5.0'}</Text>
                  </View>
                </View>
                {(incomingRide.passengerPhone || incomingRide.guestPhone) && (
                  <TouchableOpacity style={styles.callIconBtn} onPress={handleCallPassenger} activeOpacity={0.85}>
                    <Ionicons name="call" size={15} color="#0F172A" />
                  </TouchableOpacity>
                )}
              </View>

              {/* 📍 ROTA E PARADAS NA CORRIDA ATIVA */}
              <View style={styles.routeAddressesContainer}>
                {/* ORIGEM */}
                <View style={styles.addressItem}>
                  <Ionicons name="location" size={16} color="#10B981" />
                  <View style={styles.addressTextWrapper}>
                    <Text style={styles.addressLabel}>Origem:</Text>
                    <Text style={styles.addressValue} numberOfLines={1}>
                      {incomingRide?.originAddress || 'Local de Embarque'}
                    </Text>

                    {Boolean((incomingRide as any)?.referencePoint) && (
                      <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: 'rgba(234, 179, 8, 0.15)',
                        borderWidth: 1,
                        borderColor: '#EAB308',
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        marginTop: 4
                      }}>
                        <Ionicons name="compass" size={14} color="#EAB308" style={{ marginRight: 4 }} />
                        <Text style={{ color: '#EAB308', fontSize: 12, fontWeight: '700', flex: 1 }}>
                          Ref: {(incomingRide as any).referencePoint}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* 🟢 TODAS AS PARADAS INTERMEDIÁRIAS */}
                {formattedStops.length > 0 && formattedStops.map((stop: any, idx: number) => (
                  <View key={`active-stop-${idx}`} style={[styles.addressItem, { backgroundColor: 'rgba(59, 130, 246, 0.08)', padding: 6, borderRadius: 8, marginVertical: 3 }]}>
                    <Ionicons name="navigate-circle" size={16} color="#3B82F6" />
                    <View style={styles.addressTextWrapper}>
                      <Text style={[styles.addressLabel, { color: '#3B82F6', fontWeight: 'bold' }]}>
                        Parada {idx + 1} de {formattedStops.length}:
                      </Text>
                      <Text style={styles.addressValue} numberOfLines={1}>
                        {stop.address}
                      </Text>
                    </View>
                  </View>
                ))}

                {/* DESTINO FINAL */}
                <View style={styles.addressItem}>
                  <Ionicons name="flag" size={16} color="#EF4444" />
                  <View style={styles.addressTextWrapper}>
                    <Text style={[styles.addressLabel, { color: '#EF4444' }]}>Destino Final:</Text>
                    <Text style={styles.addressValue} numberOfLines={1}>
                      {incomingRide?.destinationAddress || 'Local de Desembarque'}
                    </Text>
                  </View>
                </View>
              </View>

              {incomingRide.serviceType === 'DELIVERY' && (
                <View style={styles.deliveryDetailsCard}>
                  <Text style={styles.deliveryDetailsTitle}>📦 Instruções da Encomenda:</Text>
                  <Text style={styles.deliveryDetailsText}>Destinatário: {incomingRide.recipientName || 'Não especificado'}</Text>
                  {incomingRide.deliveryNotes ? <Text style={styles.deliveryNotes}>Nota: {incomingRide.deliveryNotes}</Text> : null}
                </View>
              )}

              {rideState !== 'in_progress' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => setIsChatVisible(true)}>
                    <Ionicons name="chatbubbles-outline" size={16} color="#EAB308" />
                    <Text style={styles.actionButtonSecondaryText}>Chat</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionButtonSecondary} onPress={handleCallPassenger}>
                    <Ionicons name="call-outline" size={16} color="#10B981" />
                    <Text style={[styles.actionButtonSecondaryText, { color: '#10B981' }]}>Ligar</Text>
                  </TouchableOpacity>

                  {canCancelNoShow ? (
                    <TouchableOpacity style={styles.noShowBtnDanger} onPress={handleNoShowCancel}>
                      <Ionicons name="alert-circle" size={16} color="#FFFFFF" />
                      <Text style={styles.noShowBtnText}>No-Show</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.cancelButtonDanger} onPress={() => setShowCancelModal(true)} activeOpacity={0.85}>
                      <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                      <Text style={styles.cancelButtonText}>Cancelar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {rideState === 'accepted' && (
                <TouchableOpacity 
                  style={[styles.actionBtnPrimary, { backgroundColor: '#3B82F6' }, isLoading && { opacity: 0.75 }]} 
                  onPress={handleArrived} 
                  disabled={isLoading}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>{isLoading ? 'Enviando...' : 'CHEGUEI AO LOCAL'}</Text>
                </TouchableOpacity>
              )}

              {rideState === 'arrived' && (
                <TouchableOpacity 
                  style={[styles.actionBtnPrimary, { backgroundColor: '#10B981' }]} 
                  onPress={() => setShowOtpModal(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnText}>INSERIR PIN / INICIAR</Text>
                </TouchableOpacity>
              )}

              {rideState === 'in_progress' && (
                <TouchableOpacity 
                  style={[styles.actionBtnPrimary, { backgroundColor: '#EAB308' }, isLoading && { opacity: 0.75 }]} 
                  onPress={handleFinishRide} 
                  disabled={isLoading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.actionBtnText, { color: '#0F172A' }]}>{isLoading ? 'Processando...' : 'FINALIZAR E COBRAR'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>

    {/* 🧾 MODAL UNIFICADO DE CONCLUSÃO DE SERVIÇO E RECIBO */}
    <Modal 
      visible={showReceiptModal} 
      transparent 
      animationType="slide"
      onRequestClose={() => {
        setShowReceiptModal(false);
        resetDriverState();
      }}
    >
      <View style={styles.receiptOverlay}>
        <View style={styles.receiptContainer}>
          <View style={styles.receiptHeaderIcon}>
            <Ionicons name="checkmark-circle" size={60} color="#10B981" />
          </View>

          <Text style={styles.receiptTitle}>Serviço Concluído!</Text>
          <Text style={styles.receiptSubtitle}>
            Corrida finalizada com sucesso. Confira os detalhes abaixo:
          </Text>

          {finishedRideSummary?.paymentMethod === 'ORANGE_MONEY' || finishedRideSummary?.paymentMethod === 'MTN_MOMO' ? (
            <View style={styles.paidOnlineBox}>
              <Ionicons name="shield-checkmark-sharp" size={22} color="#FF6600" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.paidOnlineTitle}>
                  PAGO VIA {finishedRideSummary?.paymentMethod === 'ORANGE_MONEY' ? 'ORANGE MONEY' : 'MTN MOMO'}
                </Text>
                <Text style={styles.paidOnlineSub}>
                  O valor foi debitado digitalmente. <Text style={{ fontWeight: 'bold', color: '#EF4444' }}>NÃO cobre dinheiro em espécie!</Text>
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.collectCashBox}>
              <Ionicons name="cash-outline" size={22} color="#10B981" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.collectCashTitle}>COBRAR EM DINHEIRO 💵</Text>
                <Text style={styles.collectCashSub}>
                  Cobre o valor exato abaixo diretamente do passageiro.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.receiptValueContainer}>
            <Text style={styles.receiptValueLabel}>Total Ganho:</Text>
            <Text style={styles.receiptValueText}>
              {finishedRideSummary?.totalAmount 
                ? `${Number(finishedRideSummary.totalAmount).toLocaleString('pt-GW')} XOF` 
                : '0 XOF'}
            </Text>
            <Text style={styles.receiptTrxId}>
              ID da Transação: {finishedRideSummary?.transactionId || 'N/A'}
            </Text>
          </View>

          <View style={styles.receiptActionButtons}>
            <TouchableOpacity 
              style={styles.ratePassengerBtn} 
              activeOpacity={0.85}
              onPress={() => {
                setShowReceiptModal(false);
                setShowRatingModal(true);
              }}
            >
              <Ionicons name="star" size={18} color="#0F172A" style={{ marginRight: 6 }} />
              <Text style={styles.ratePassengerBtnText}>Avaliar Cliente</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.closeReceiptBtn} 
              activeOpacity={0.8}
              onPress={() => {
                setShowReceiptModal(false);
                resetDriverState();
              }}
            >
              <Text style={styles.closeReceiptBtnText}>Concluir e Voltar ao Mapa</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    {/* ⚙️ MODAL DE FILTROS */}
    <Modal visible={showFilterModal} transparent animationType="slide">
      <View style={styles.filterModalOverlay}>
        <View style={[styles.filterModalCard, { paddingBottom: Math.max((insets?.bottom || 0) + 24, Platform.OS === 'android' ? 36 : 20) }]}>
          <Text style={styles.filterModalTitle}>Preferências de Chamada</Text>
          <Text style={styles.filterModalSub}>Selecione os serviços que deseja receber:</Text>
          
          <View style={styles.filterRow}>
            <View style={styles.filterLabelContainer}>
              <Ionicons name="car-sport" size={18} color="#EAB308" />
              <Text style={styles.filterLabelText}>Corridas de Passageiro</Text>
            </View>
            <Switch value={serviceFilters.RIDE} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, RIDE: val }))} trackColor={{ false: '#334155', true: '#EAB308' }} />
          </View>
          <View style={styles.filterRow}>
            <View style={styles.filterLabelContainer}>
              <Ionicons name="cube" size={18} color="#3B82F6" />
              <Text style={styles.filterLabelText}>Entregas de Encomenda</Text>
            </View>
            <Switch value={serviceFilters.DELIVERY} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, DELIVERY: val }))} trackColor={{ false: '#334155', true: '#3B82F6' }} />
          </View>
          <View style={styles.filterRow}>
            <View style={styles.filterLabelContainer}>
              <Ionicons name="time" size={18} color="#7C3AED" />
              <Text style={styles.filterLabelText}>Aluguel</Text>
            </View>
            <Switch value={serviceFilters.RENTAL} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, RENTAL: val }))} trackColor={{ false: '#334155', true: '#7C3AED' }} />
          </View>

          <TouchableOpacity style={styles.closeFilterBtn} onPress={() => setShowFilterModal(false)} activeOpacity={0.85}>
            <Text style={styles.closeFilterText}>Salvar Preferências</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* 🧭 NAVEGAÇÃO TURBYTURN */}
    <TurnByTurnSheet 
      visible={showNavSheet} 
      onClose={() => setShowNavSheet(false)} 
      destination={navDestination} 
      isIntermediateStop={isNavigatingToStop} 
      onConfirmStop={() => setCurrentStopIndex(prev => prev + 1)} 
    />

    {/* 🔔 MODAL DE OFERTA DE CORRIDA */}
    <Modal visible={!!activeOffer} transparent animationType="fade">
      <View style={styles.newRequestOverlay}>
        <View style={styles.newRequestCard}>
          {isRideActive && (
            <View style={{ backgroundColor: '#3B82F6', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="layers-outline" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 12 }}>
                PRÓXIMA CORRIDA (ADICIONAR À FILA)
              </Text>
            </View>
          )}

          <View style={styles.newRequestHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={activeOffer?.serviceType === 'DELIVERY' ? 'cube' : 'car-sport'} size={18} color="#EAB308" />
              <Text style={styles.newRequestTitle}>
                {isRideActive ? 'Nova Oferta em Fila!' : 'Nova Corrida!'}
              </Text>
            </View>
            <View style={styles.newRequestPriceBadge}>
              <Text style={styles.newRequestPriceText}>{formatCurrency(activeOffer?.priceXof)} XOF</Text>
            </View>
          </View>

          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBarFill, { width: `${Math.max(0, (timeLeft / 15) * 100)}%` }]} />
          </View>
          <Text style={styles.timerText}>Tempo restante: {timeLeft}s</Text>

          <View style={styles.modalPassengerRow}>
            <View style={styles.passengerPhotoContainerSm}>
              {activeOffer?.passengerPhoto ? (
                <Image source={{ uri: formatImageUrl(activeOffer.passengerPhoto) }} style={{ width: '100%', height: '100%', borderRadius: 18 }} />
              ) : (
                <Ionicons name="person" size={16} color="#94A3B8" />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.modalPassengerName}>{activeOffer?.guestName || activeOffer?.passengerName || 'Passageiro'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Ionicons name="star" size={12} color="#EAB308" />
                <Text style={styles.modalPassengerRating}>{activeOffer?.passengerRating?.toFixed(1) || '5.0'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.routeTimelineContainer}>
            {/* EMBARQUE */}
            <View style={styles.timelineRow}>
              <Ionicons name="location" size={16} color="#10B981" />
              <View style={styles.timelineTextContainer}>
                <Text style={styles.timelineLabel}>BUSCAR EM:</Text>
                <Text style={styles.timelineAddress} numberOfLines={2}>
                  {activeOffer?.originAddress || 'Local de origem'}
                </Text>

                {Boolean((activeOffer as any)?.referencePoint) && (
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    borderWidth: 1,
                    borderColor: '#EAB308',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 6,
                    marginTop: 4
                  }}>
                    <Ionicons name="compass" size={14} color="#EAB308" style={{ marginRight: 4 }} />
                    <Text style={{ color: '#EAB308', fontSize: 12, fontWeight: '700', flex: 1 }}>
                      Ref: {(activeOffer as any)?.referencePoint}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* 🟢 PARADAS INTERMEDIÁRIAS EXIBIDAS NA TELA DE ACEITE (SOLICITAÇÃO) */}
            {formattedStops.length > 0 ? (
              formattedStops.map((stop: any, idx: number) => (
                <View key={`offer-stop-${idx}`} style={[styles.timelineRow, { backgroundColor: 'rgba(59, 130, 246, 0.08)', paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, marginVertical: 3 }]}>
                  <Ionicons name="navigate-circle" size={16} color="#3B82F6" />
                  <View style={styles.timelineTextContainer}>
                    <Text style={[styles.timelineLabel, { color: '#3B82F6', fontWeight: 'bold' }]}>
                      PARADA {idx + 1} DE {formattedStops.length}:
                    </Text>
                    <Text style={styles.timelineAddress} numberOfLines={2}>
                      {stop.address}
                    </Text>
                  </View>
                </View>
              ))
            ) : (activeOffer?.extraStopAddress || incomingRide?.extraStopAddress) ? (
              <View style={[styles.timelineRow, { backgroundColor: 'rgba(59, 130, 246, 0.08)', paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, marginVertical: 3 }]}>
                <Ionicons name="navigate-circle" size={16} color="#3B82F6" />
                <View style={styles.timelineTextContainer}>
                  <Text style={[styles.timelineLabel, { color: '#3B82F6', fontWeight: 'bold' }]}>PARADA INTERMEDIÁRIA:</Text>
                  <Text style={styles.timelineAddress} numberOfLines={2}>
                    {activeOffer?.extraStopAddress || incomingRide?.extraStopAddress}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* DESTINO */}
            <View style={styles.timelineRow}>
              <Ionicons name="flag" size={16} color="#EF4444" />
              <View style={styles.timelineTextContainer}>
                <Text style={styles.timelineLabel}>LEVAR PARA:</Text>
                <Text style={styles.timelineAddress} numberOfLines={2}>
                  {activeOffer?.destinationAddress || 'Local de destino'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.newRequestActions}>
            <TouchableOpacity 
              style={styles.rejectBtn} 
              onPress={() => { Vibration.cancel(); setQueuedOfferData(null); if (rideState === 'idle') setIncomingRide(null); }} 
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.rejectText}>Recusar</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.acceptBtn, isLoading && { opacity: 0.7 }]} 
              activeOpacity={0.85} 
              disabled={isLoading} 
              onPress={() => {
                if (isLoading) return;
                if (activeOffer?.rideId && driver?.id) {
                  const lat = Number(location?.coords?.latitude || BISSAU_CENTER_LAT);
                  const lng = Number(location?.coords?.longitude || BISSAU_CENTER_LNG);
                  acceptRide(activeOffer.rideId, driver.id, lat, lng);
                }
              }}
            >
              <Text style={styles.acceptText}>
                {isLoading ? 'Aceitando...' : (isRideActive ? 'Adicionar à Fila 🔄' : 'Aceitar Chamada')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    {/* 💬 CHAT INTERNO */}
    <ChatModal 
      visible={isChatVisible} 
      onClose={() => setIsChatVisible(false)} 
      socket={socket} 
      rideId={activeRideId || ''} 
      currentRole="driver" 
      currentUserPhoto={profileImageUrl} 
      otherUserName={displayPassengerName} 
      otherUserPhoto={formatImageUrl(incomingRide?.passengerPhoto)} 
    />

    <StartRideOtpModal visible={showOtpModal} onCancel={() => setShowOtpModal(false)} onSubmitOtp={handleStartRideWithOtp} />
    <CancelModal visible={showCancelModal} userType="DRIVER" isPenaltyApplicable={false} onClose={() => setShowCancelModal(false)} onConfirm={handleConfirmCancel} />
  </View>
);
}

// ---------------------------------------------------------------------------
// ESTILOS UNIFICADOS
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },

  // MARCADORES DO MAPA
  carMarkerContainer: {
    backgroundColor: '#EAB308',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#0F172A',
    elevation: 5,
  },
  markerPickup: {
    backgroundColor: '#10B981',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 5,
  },
  markerDestination: {
    backgroundColor: '#EF4444',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 5,
  },

  // HEADER SUPERIOR FLUTUANTE
  headerContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 15,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 6,
    borderWidth: 1,
  },
  pillOnline: {
    backgroundColor: '#EAB308',
    borderColor: '#CA8A04',
  },
  pillOffline: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotGreen: {
    backgroundColor: '#0F172A',
  },
  dotRed: {
    backgroundColor: '#EF4444',
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '800',
  },
  earningsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 6,
    gap: 6,
  },
  earningsPillText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '800',
  },
  filterPill: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 6,
  },
  profilePill: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
    elevation: 6,
  },
  headerProfileImage: {
    width: '100%',
    height: '100%',
  },
  lowBatteryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginTop: 8,
    gap: 6,
  },
  lowBatteryText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // BOTÕES FLUTUANTES LATERAIS
  floatingButtonsWrapper: {
    position: 'absolute',
    right: 16,
    bottom: 220,
    alignItems: 'flex-end',
    gap: 10,
    zIndex: 10,
  },
  recenterButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 6,
  },
  sosButton: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 6,
  },
  sosText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 12,
  },
  audioRecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
    elevation: 6,
  },
  audioRecordButtonActive: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  audioRecordText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },

  // SLIDING BOTTOM SHEET
  bottomSheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  bottomSheet: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 20,
    minHeight: 180,
  },
  dragHandleArea: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#475569',
    borderRadius: 3,
  },
  dragHintText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },

  // IDLE (LIVRE)
  idleContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  idleTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  idleSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  goOnlineBtn: {
    backgroundColor: '#EAB308',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
  },
  goOnlineText: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 15,
  },

  // CORRIDA ATIVA
  activeRideContainer: {
    paddingTop: 4,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  serviceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 6,
  },
  serviceTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  priceBadgeContainer: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  priceBadgeText: {
    color: '#EAB308',
    fontSize: 14,
    fontWeight: '900',
  },
  etaHeader: {
    marginBottom: 12,
  },
  rideStateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  waitTimerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  waitTimerText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '700',
  },

  // CARD DO PASSAGEIRO
  passengerProfileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  passengerPhotoContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 10,
  },
  passengerPhoto: {
    width: '100%',
    height: '100%',
  },
  passengerDetails: {
    flex: 1,
  },
  passengerName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ratingText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '700',
  },
  callIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAB308',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ENDEREÇOS E ROTA
  routeAddressesContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
    marginBottom: 12,
  },
  addressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addressTextWrapper: {
    flex: 1,
  },
  addressLabel: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  addressValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },

  // DETALHES DE ENTREGA
  deliveryDetailsCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  deliveryDetailsTitle: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  deliveryDetailsText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  deliveryNotes: { 
    color: '#94A3B8', 
    fontSize: 12, 
    fontStyle: 'italic',
  },

  // MARCADOR 3D DO VEÍCULO
  vehicle3DContainer: { 
    width: 44, 
    height: 44, 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: 'transparent',
  },
  vehicle3DRotator: { 
    width: 40, 
    height: 40, 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: 'transparent',
  },
  vehicle3DImage: { 
    width: 38, 
    height: 38, 
    resizeMode: 'contain', 
    backgroundColor: 'transparent',
  },

  // BOTÕES DE AÇÃO
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  actionButtonSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  actionButtonSecondaryText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  cancelButtonDanger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF4444',
    gap: 6,
  },
  cancelButtonText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  noShowBtnDanger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  noShowBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  actionBtnPrimary: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // MODAL FILTROS
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  filterModalCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  filterModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
  },
  filterModalSub: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 20,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0F172A',
  },
  filterLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterLabelText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  closeFilterBtn: {
    backgroundColor: '#EAB308',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  closeFilterText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },

  // MODAL NOVA SOLICITAÇÃO (POPUP)
  newRequestOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  newRequestCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#EAB308',
    elevation: 10,
  },
  newRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  newRequestTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '900',
  },
  newRequestPriceBadge: {
    backgroundColor: '#EAB308',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  newRequestPriceText: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 15,
  },
  progressBarContainer: {
    height: 6,
    backgroundColor: '#0F172A',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#EAB308',
  },
  timerText: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'right',
    marginBottom: 14,
    fontWeight: '700',
  },
  modalPassengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 14,
    marginBottom: 14,
  },
  passengerPhotoContainerSm: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPassengerName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  modalPassengerRating: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
  },
  routeTimelineContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 16,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  timelineTextContainer: {
    flex: 1,
  },
  timelineLabel: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
  },
  timelineAddress: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 1,
  },
  newRequestActions: {
    flexDirection: 'row',
    gap: 10,
  },
  rejectBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  rejectText: {
    color: '#94A3B8',
    fontWeight: '800',
  },
  acceptBtn: {
    flex: 2,
    backgroundColor: '#EAB308',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  acceptText: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 15,
  },

  // MODAL RECIBO
  receiptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
  },
  receiptCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    alignItems: 'center',
  },
  receiptHeader: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10B981',
    marginBottom: 4,
  },
  receiptSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    width: '100%',
    marginVertical: 16,
  },
  receiptLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  receiptAmount: {
    color: '#EAB308',
    fontSize: 28,
    fontWeight: '900',
    marginVertical: 4,
  },
  receiptDist: {
    color: '#64748B',
    fontSize: 11,
    marginBottom: 20,
  },
  closeReceiptBtn: {
    backgroundColor: '#EAB308',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  closeReceiptText: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 15,
  },
  // 🧾 ESTILOS DO MODAL DE RECIBO
 receiptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  receiptContainer: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 20,
    alignItems: 'center',
  },
  receiptHeaderIcon: {
    marginBottom: 10,
  },
  receiptTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  receiptSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 18,
  },
  paidOnlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 102, 0, 0.12)',
    borderWidth: 1,
    borderColor: '#FF6600',
    padding: 14,
    borderRadius: 16,
    width: '100%',
    marginBottom: 18,
  },
  paidOnlineTitle: {
    color: '#FF6600',
    fontWeight: '900',
    fontSize: 13,
  },
  paidOnlineSub: {
    color: '#F8FAFC',
    fontSize: 11,
    marginTop: 2,
  },
  collectCashBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: '#10B981',
    padding: 14,
    borderRadius: 16,
    width: '100%',
    marginBottom: 18,
  },
  collectCashTitle: {
    color: '#10B981',
    fontWeight: '900',
    fontSize: 13,
  },
  collectCashSub: {
    color: '#F8FAFC',
    fontSize: 11,
    marginTop: 2,
  },
  receiptValueContainer: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    marginBottom: 20,
  },
  receiptValueLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  receiptValueText: {
    color: '#EAB308',
    fontSize: 28,
    fontWeight: '900',
    marginVertical: 4,
  },
  receiptTrxId: {
    color: '#64748B',
    fontSize: 11,
  },
  receiptActionButtons: {
    width: '100%',
    gap: 10,
  },
  ratePassengerBtn: {
    backgroundColor: '#EAB308',
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratePassengerBtnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 15,
  },
  closeReceiptBtn: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
  },
  closeReceiptBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});