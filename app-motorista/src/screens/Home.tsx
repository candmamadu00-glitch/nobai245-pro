import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal, 
  KeyboardAvoidingView, Platform, StatusBar, Image, Vibration, Switch,
  Animated, PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Haptics from 'expo-haptics';
import * as Battery from 'expo-battery';
import { Ionicons } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

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

// 🛡️ BLINDAGEM 1: Token do Mapbox via Variável de Ambiente
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!MAPBOX_TOKEN) {
  console.warn('🚨 EXPO_PUBLIC_MAPBOX_TOKEN não configurado no .env!');
} else {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

// 🛡️ BLINDAGEM 2: URL da API Sanitizada
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
const CLEAN_BASE_URL = RAW_API_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const API_URL = `${CLEAN_BASE_URL}/api`;

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
const STORAGE_ACTIVE_RIDE_ID = '@nobai245:activeRideId';
const STORAGE_ACTIVE_RIDE_DATA = '@nobai245:activeRideData';
const STORAGE_ACTIVE_RIDE_STATE = '@nobai245:activeRideState';

// 🛡️ Dados geoespaciais fictícios para zonas de alta demanda (Bissau)
const demandZonesData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-15.5977, 11.8632] },
      properties: { name: 'Centro de Bissau' },
    },
  ],
};

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const { locations } = data;
  const location = locations[0];

  if (location) {
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
        speed: location.coords.speed || 0,
        heading: location.coords.heading || 0
      };

      const sendFallbackHttp = async (locPayload: any, authToken: string | null) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

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
        } catch (fetchErr) {
          console.log('❌ Fallback HTTP silencioso (Sem rede no momento)');
        }
      };

      if (socket && socket.connected) {
        socket.timeout(3000).emit('driver:location_update', payload, (err: any) => {
          if (err) sendFallbackHttp(payload, token);
        });
      } else {
        sendFallbackHttp(payload, token);
      }
    } catch (err) {
      console.warn('⚠️ [BACKGROUND TASK ERR]:', err);
    }
  }
});

type RideState = 'idle' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed';

interface IncomingRideData {
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
  stops?: any[]; 
}

interface CompletedRideInfo { fareXOF: number; distanceKm: number; transactionId: string; }

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

export function Home() {
  const { driver } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const audioRecorder = useAudioRecorder();
  const route = useRoute<any>();
  
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  
  const [incomingRide, setIncomingRide] = useState<IncomingRideData | null>(null);
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
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showNavSheet, setShowNavSheet] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);

  const [todayEarnings, setTodayEarnings] = useState<number>(0);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [serviceFilters, setServiceFilters] = useState({ RIDE: true, DELIVERY: true, RENTAL: true });

  const incomingRideRef = useRef(incomingRide);
  const activeRideIdRef = useRef(activeRideId);
  const isOnlineRef = useRef(isOnline);
  const serviceFiltersRef = useRef(serviceFilters);

  useEffect(() => { incomingRideRef.current = incomingRide; }, [incomingRide]);
  useEffect(() => { activeRideIdRef.current = activeRideId; }, [activeRideId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { serviceFiltersRef.current = serviceFilters; }, [serviceFilters]);

  // 🎯 ANIMAÇÃO E LIMITE DE DESLOCAMENTO DO BOTTOM SHEET
  const panY = useRef(new Animated.Value(0)).current;
  const isExpandedRef = useRef(true);
  const [sheetHeight, setSheetHeight] = useState(380);

  // Calcula o limite exato para deixar sempre a barra superior visível
  const maxCollapsedY = Math.max(100, sheetHeight - 85 - Math.max(insets.bottom, 10));
  const maxCollapsedYRef = useRef(maxCollapsedY);
  useEffect(() => {
    maxCollapsedYRef.current = maxCollapsedY;
  }, [maxCollapsedY]);

  const snapToState = useCallback((toExpanded: boolean) => {
    isExpandedRef.current = toExpanded;
    const targetY = toExpanded ? 0 : maxCollapsedYRef.current;
    Animated.spring(panY, {
      toValue: targetY,
      useNativeDriver: true,
      bounciness: 4,
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

  const mapStyle = useMemo(() => {
    const hour = new Date().getHours();
    return (hour >= 19 || hour < 6) ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';
  }, []);

  const navDestination = useMemo(() => {
    if (!incomingRide) return null;
    const isHeadingToDestination = rideState === 'in_progress';
    const destLat = Number(isHeadingToDestination ? incomingRide.destinationLat || 11.8632 : incomingRide.pickupLat || 11.8632);
    const destLng = Number(isHeadingToDestination ? incomingRide.destinationLng || -15.5977 : incomingRide.pickupLng || -15.5977);

    return {
      latitude: isNaN(destLat) ? 11.8632 : destLat,
      longitude: isNaN(destLng) ? -15.5977 : destLng,
      title: isHeadingToDestination ? 'Destino Final' : 'Local de Embarque',
      address: isHeadingToDestination ? incomingRide.destinationAddress : incomingRide.originAddress,
    };
  }, [incomingRide, rideState]);
  
  const [timeLeft, setTimeLeft] = useState(15);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const acceptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCameraUpdateRef = useRef<number>(0);
  
  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${CLEAN_BASE_URL}${cleanPath}`;
  };

  const profileImageUrl = formatImageUrl(driver?.profilePicture || undefined);

  const fetchTodayEarnings = useCallback(async () => {
    try {
      if (!api || typeof api.get !== 'function') return;
      const response = await api.get('/drivers/finance');
      if (response?.data) {
        setTodayEarnings(Number(response.data.todayEarned ?? response.data.totalEarned ?? 0));
      }
    } catch (err) {
      console.warn('⚠️ Erro ao carregar ganhos diários:', err);
    }
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
          if (level !== null && level >= 0) {
            setBatteryLevel(level);
            setIsLowBattery(level > 0 && level <= 0.15);
          }
        }
        if (typeof Battery?.addBatteryLevelListener === 'function') {
          sub = Battery.addBatteryLevelListener(({ batteryLevel: lvl }) => {
            setBatteryLevel(lvl);
            setIsLowBattery(lvl > 0 && lvl <= 0.15);
          });
        }
      } catch (e) { console.warn('⚠️ Falha bateria', e); }
    }
    checkBattery();
    return () => { if (sub?.remove) sub.remove(); };
  }, []);

  useEffect(() => { if (route.params?.openChat) setIsChatVisible(true); }, [route.params]); 

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (rideState === 'arrived') {
      interval = setInterval(() => {
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
    if (incomingRide && rideState === 'idle') {
      Vibration.vibrate([0, 1000, 500, 1000], true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else Vibration.cancel();
    return () => Vibration.cancel();
  }, [incomingRide, rideState]);

  useEffect(() => {
    let syncInterval: NodeJS.Timeout;
    if (['accepted', 'arrived', 'in_progress'].includes(rideState) && activeRideId) {
      syncInterval = setInterval(() => {
        if (socket && socket.connected) {
          socket.timeout(5000).emit('driver:request_state', (err: any) => {
            if (err) console.warn('Falha ping socket.');
          }); 
        } else if (socket) socket.connect();
      }, 10000);
    }
    return () => clearInterval(syncInterval);
  }, [rideState, activeRideId]);

  const updateCameraThrottled = useCallback((lng: number, lat: number) => {
    if (!isMapReady || !cameraRef.current) return;
    const now = Date.now();
    if (now - lastCameraUpdateRef.current > 3000) {
      lastCameraUpdateRef.current = now;
      try {
        cameraRef.current.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 16, animationDuration: 1000 });
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
    } catch (err) { console.error('❌ Erro estado local:', err); }
  };

  const resetDriverState = useCallback(async () => {
    Vibration.cancel();
    if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
    await AsyncStorage.multiRemove([STORAGE_ACTIVE_RIDE_ID, STORAGE_ACTIVE_RIDE_DATA, STORAGE_ACTIVE_RIDE_STATE]);
    setRideState('idle'); 
    setActiveRideId(null);
    setIncomingRide(null); 
    setCompletedInfo(null);
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

        if (storedRideId && storedRideData && storedRideState) {
          setActiveRideId(storedRideId);
          setIncomingRide(JSON.parse(storedRideData));
          setRideState(storedRideState as RideState);
        }
      } catch (err) {}
    }
    restoreLocalState();
  }, []);

  const fetchMapboxRoute = async (startLng: number, startLat: number, endLng: number, endLat: number) => {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Falha requisição rota');
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        setRouteCoordinates(data.routes[0].geometry.coordinates);
        const eta = Math.ceil(data.routes[0].duration / 60);
        setDriverEta(eta);

        if ((activeRideId || incomingRide?.rideId) && driver?.id && location?.coords && socket.connected) {
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
      setRouteCoordinates([[startLng, startLat], [endLng, endLat]]);
      const distKm = calculateDirectDistance(startLat, startLng, endLat, endLng);
      setDriverEta(Math.max(1, Math.ceil((distKm / 30) * 60)));
    }
  };

  useEffect(() => {
    if (!location?.coords || !incomingRide) return;
    if (rideState === 'accepted') fetchMapboxRoute(location.coords.longitude, location.coords.latitude, incomingRide.pickupLng, incomingRide.pickupLat);
    else if (rideState === 'in_progress' && incomingRide.destinationLat && incomingRide.destinationLng) fetchMapboxRoute(location.coords.longitude, location.coords.latitude, incomingRide.destinationLng, incomingRide.destinationLat);
    else if (rideState === 'idle' || rideState === 'arrived') setRouteCoordinates(null);
    persistActiveRideState(incomingRide, rideState, activeRideId);
  }, [rideState, activeRideId]);

  useEffect(() => {
    const handleConnect = async () => {
      if (driver?.id) {
        await processOfflineQueue(socket);
        socket.emit('driver:request_state');
        if (isOnlineRef.current && location?.coords) {
          socket.emit('driver:online', { driverId: driver.id, lat: location.coords.latitude, lng: location.coords.longitude });
        }
      }
    };

    const handleRideAccepted = async (data: any) => {
      Vibration.cancel();
      if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
      setIsLoading(false);
      if (data.driverId === driver?.id) {
        setActiveRideId(data.rideId);
        setRideState('accepted');
        snapToState(true);
        if (incomingRideRef.current) persistActiveRideState(incomingRideRef.current, 'accepted', data.rideId);
      } else {
        setIncomingRide(null);
        Alert.alert('Corrida Indisponível', 'Outro motorista aceitou esta corrida.');
      }
    };

    const handleNewRideRequest = (data: IncomingRideData) => {
      if (!isOnlineRef.current) return;
      
      const rawType = (data.serviceType || 'RIDE').toString().toUpperCase();
      let normalizedService: 'RIDE' | 'DELIVERY' | 'RENTAL' = 'RIDE';
      if (['ENTREGA', 'DELIVERY'].includes(rawType)) normalizedService = 'DELIVERY';
      if (['ALUGUEL', 'RENTAL'].includes(rawType)) normalizedService = 'RENTAL';

      if (serviceFiltersRef.current && serviceFiltersRef.current[normalizedService] === false) return;

      const rawPrice = (data as any).fareXOF ?? data.priceXof ?? 0;
      const stopsArray = Array.isArray(data.stops) && data.stops.length > 0 ? data.stops : ((data as any).extraStopAddress ? [{ address: (data as any).extraStopAddress }] : []);

      setRideState('idle'); 
      setTimeLeft(15);
      setIncomingRide({
        ...data,
        passengerName: data.passengerName || 'Passageiro',
        passengerRating: data.passengerRating || 5.0,
        serviceType: normalizedService,
        paymentMethod: data.paymentMethod || 'CASH',
        priceXof: typeof rawPrice === 'string' ? parseFloat(rawPrice) : Number(rawPrice),
        stops: stopsArray,
        extraStopAddress: (data as any).extraStopAddress || (stopsArray[0]?.address || undefined),
      });
    };

    const handleRideStarted = () => {
      setIsLoading(false);
      setRideState('in_progress');
      setShowOtpModal(false);
      snapToState(true);
      if (incomingRideRef.current && activeRideIdRef.current) persistActiveRideState(incomingRideRef.current, 'in_progress', activeRideIdRef.current);
    };

    const handleRideFinished = (data: any) => {
      setIsLoading(false);
      setRideState('completed');
      setCompletedInfo({ fareXOF: data.fareXOF, distanceKm: data.distanceKm, transactionId: data.transactionId });
      setShowReceiptModal(true);
      setShowNavSheet(false);
      stopBackgroundLocation();
      persistActiveRideState(null, 'idle', null);
      fetchTodayEarnings();
    };

    const handleRideCancelled = (data: { cancelledBy?: string }) => {
      setIsLoading(false);
      if (data.cancelledBy === 'PASSENGER') Alert.alert('Corrida Cancelada ⚠️', 'O passageiro cancelou a viagem.');
      resetDriverState();
    };

    socket.on('connect', handleConnect);
    socket.on('ride:new_request', handleNewRideRequest);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:cancelled', handleRideCancelled);

    return () => {
      Vibration.cancel();
      socket.off('connect', handleConnect);
      socket.off('ride:new_request', handleNewRideRequest);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:cancelled', handleRideCancelled);
      stopTracking();
    };
  }, [driver?.id, resetDriverState, snapToState]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (incomingRide && rideState === 'idle' && timeLeft > 0) timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    else if (timeLeft === 0 && incomingRide && rideState === 'idle') { Vibration.cancel(); setIncomingRide(null); }
    return () => clearInterval(timer);
  }, [incomingRide, rideState, timeLeft]);

  async function stopBackgroundLocation() {
    const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (hasTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  const startTrackingForState = async (currentState: RideState) => {
    if (locationWatcherRef.current) { locationWatcherRef.current.remove(); locationWatcherRef.current = null; }

    const isActiveRide = ['accepted', 'arrived', 'in_progress'].includes(currentState);
    let timeInterval = isActiveRide ? 3000 : 8000;
    let distanceInterval = isActiveRide ? 5 : 15;

    if (isLowBattery) {
      timeInterval = isActiveRide ? 6000 : 15000;
      distanceInterval = isActiveRide ? 10 : 30;
    }

    try {
      locationWatcherRef.current = await Location.watchPositionAsync(
        { accuracy: isActiveRide ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced, timeInterval, distanceInterval },
        (newLocation) => {
          setLocation(newLocation);
          updateCameraThrottled(newLocation.coords.longitude, newLocation.coords.latitude);
          if (driver?.id && socket.connected) {
            socket.emit('driver:location_update', {
              driverId: driver.id, rideId: activeRideIdRef.current || undefined,
              latitude: newLocation.coords.latitude, longitude: newLocation.coords.longitude,
              speed: newLocation.coords.speed || 0, heading: newLocation.coords.heading || 0
            });
          }
        }
      );
    } catch (e) { console.warn('⚠️ Erro watchPositionAsync:', e); }
  };

  async function startTracking() {
    if (driver?.status !== 'APPROVED') return Alert.alert('Conta em Análise', 'Aguarde aprovação de documentos.');
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return Alert.alert('Permissão Necessária', 'Permita o acesso à localização para ficar online.');

    setIsOnline(true);
    await connectDriverSocket();
    try {
      const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(currentLoc);
      if (cameraRef.current) cameraRef.current.setCamera({ centerCoordinate: [currentLoc.coords.longitude, currentLoc.coords.latitude], zoomLevel: 16 });
      if (socket && socket.connected) socket.emit('driver:online', { driverId: driver?.id, lat: currentLoc.coords.latitude, lng: currentLoc.coords.longitude });
      await startTrackingForState(rideState);
    } catch (e) {
      Alert.alert('Erro de Localização', 'Verifique o GPS.');
      setIsOnline(false);
    }
  }

  function stopTracking() {
    if (driver?.id && socket && socket.connected) {
      socket.timeout(2000).emit('driver:offline', { driverId: driver.id }, (err: any) => {
        if (err) console.log('Offline forçado (Rede instável)');
      });
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

    if (!socket || !socket.connected) {
      setIsLoading(false);
      return Alert.alert('Sem Conexão', 'Sinal de internet insuficiente. Verifique sua rede e tente novamente.');
    }

    socket.timeout(8000).emit('driver:accept_ride', { 
      rideId, driverId, driverLat: currentLat, driverLng: currentLng 
    }, (err: any, response: any) => {
      setIsLoading(false);
      if (err) return Alert.alert('Sinal Fraco 📡', 'Não foi possível confirmar a corrida a tempo. Tente novamente.');
      
      if (response?.error) {
        setIncomingRide(null); 
        return Alert.alert('Aviso', response.message);
      }
      
      setActiveRideId(rideId);
      setRideState('accepted');
      snapToState(true);
      if (incomingRide) persistActiveRideState(incomingRide, 'accepted', rideId);
    });
  }

  async function handleArrived() {
    if (!activeRideId) return;
    setIsLoading(true);
    const payload = { rideId: activeRideId };

    const processOffline = async () => {
      await saveActionToQueue('driver:arrived', payload);
      Alert.alert('Modo Offline', 'Sua chegada foi registrada no aparelho e será sincronizada assim que a rede voltar.');
      setRideState('arrived');
      if (incomingRide) persistActiveRideState(incomingRide, 'arrived', activeRideId);
      setDriverEta(null);
      setIsLoading(false);
    };

    if (socket && socket.connected) {
      socket.timeout(4000).emit('driver:arrived', payload, async (err: any) => {
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
      Alert.alert('Aviso de Rede', 'Conexão fraca. O cancelamento será sincronizado em breve.');
    }
  }

  async function handleStartRideWithOtp(otp: string) {
    if (!activeRideId) return;
    setIsLoading(true);
    const payload = { rideId: activeRideId, otp };

    const processOfflineStart = async () => {
      await saveActionToQueue('driver:start_ride', payload);
      setRideState('in_progress');
      setShowOtpModal(false);
      if (incomingRide) persistActiveRideState(incomingRide, 'in_progress', activeRideId);
      Alert.alert('Modo Offline', 'Início de viagem gravado no aparelho.');
      setIsLoading(false);
    };

    if (socket && socket.connected) {
      socket.timeout(5000).emit('driver:start_ride', payload, async (err: any, response: any) => {
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
    const fallbackLat = Number(location?.coords?.latitude || incomingRide?.destinationLat || 11.8632);
    const fallbackLng = Number(location?.coords?.longitude || incomingRide?.destinationLng || -15.5977);
    const payload = { rideId: activeRideId, dropoffLat: fallbackLat, dropoffLng: fallbackLng };

    const processOfflineFinish = async () => {
      await saveActionToQueue('driver:finish_ride', payload);
      Alert.alert('Corrida Salva Offline', 'Finalizada com sucesso no aparelho. A cobrança será sincronizada ao recuperar a rede.');
      setFinishedRideId(activeRideId);
      setFinishedTargetName(displayPassengerName);
      setShowRatingModal(true);
      setIsLoading(false);
    };

    if (socket && socket.connected) {
      socket.timeout(5000).emit('driver:finish_ride', payload, async (err: any, response: any) => {
        if (err) {
          await processOfflineFinish();
        } else if (response?.error) {
          Alert.alert('Erro', response.message || 'Não foi possível finalizar a corrida no servidor.');
          setIsLoading(false);
        } else {
          setFinishedRideId(activeRideId);
          setFinishedTargetName(displayPassengerName);
        }
      });
    } else {
      await processOfflineFinish();
    }
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
      socket.emit('ride:rate', { rideId: rideToRate, reviewerId: driver?.id, reviewerType: 'DRIVER', receiverId: incomingRide.passengerId, stars, tags, comment });
    }
    setShowRatingModal(false);
    setFinishedRideId(null);
    resetDriverState();
  }

  function handleCallPassenger() {
    Alert.alert('Contato Protegido 🔒', 'Por motivos de segurança e privacidade, a comunicação deve ser feita exclusivamente pelo Chat.');
    setIsChatVisible(true);
  }

  function handleInaccessibleLocation() {
    if (!activeRideId || !socket || !socket.connected) return Alert.alert('Erro de Rede', 'Verifique sua conexão.');
    socket.emit('driver:alert_inaccessible_location', { rideId: activeRideId, title: 'Atenção do Motorista ⚠️', message: 'O motorista informou que o local exato é de difícil acesso. Por favor, aproxime-se do ponto indicado no mapa.' });
    Alert.alert('Alerta Enviado! 📢', 'O passageiro foi notificado.');
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
    if (audioRecorder.isRecording) {
      await audioRecorder.stopRecording();
      Alert.alert('Gravação Encerrada', 'O áudio de segurança foi gravado e salvo localmente.');
    } else {
      await audioRecorder.startRecording();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const formatWaitTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      <Mapbox.MapView 
        style={styles.map} 
        styleURL={mapStyle}
        logoEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        onDidFinishLoadingMap={() => setIsMapReady(true)}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [Number(location?.coords.longitude || -15.5977), Number(location?.coords.latitude || 11.8632)],
            zoomLevel: 16,
          }}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {isOnline && (
          <Mapbox.ShapeSource id="demandZonesSource" shape={demandZonesData as any}>
            <Mapbox.CircleLayer id="demandZonesLayer" style={{ circleRadius: 40, circleColor: '#FF3300', circleOpacity: 0.25, circleBlur: 0.6 }} />
          </Mapbox.ShapeSource>
        )}

        {isOnline && location?.coords && (
          <Mapbox.PointAnnotation id="car-location" coordinate={[Number(location.coords.longitude), Number(location.coords.latitude)]}>
            <View style={styles.carMarkerContainer}>
              <Ionicons name="car" size={24} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {['accepted', 'arrived'].includes(rideState) && incomingRide && (
          <Mapbox.PointAnnotation id="pickup-location" coordinate={[Number(incomingRide.pickupLng), Number(incomingRide.pickupLat)]}>
            <View style={styles.markerPickup}><Ionicons name="location" size={24} color="#FFF" /></View>
          </Mapbox.PointAnnotation>
        )}

        {routeCoordinates && routeCoordinates.length > 0 && (
          <Mapbox.ShapeSource id="routeSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoordinates } }}>
            <Mapbox.LineLayer id="routeLine" style={{ lineColor: rideState === 'in_progress' ? '#0284C7' : '#1A202C', lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
        )}

        {stops && stops.map((stop: any, index: number) => {
          const isPassed = index < currentStopIndex;
          return (
            <Mapbox.PointAnnotation key={`stop-${index}`} id={`stop-${index}`} coordinate={[Number(stop.lng), Number(stop.lat)]}>
              <View style={[styles.carMarkerContainer, { backgroundColor: isPassed ? '#9CA3AF' : '#3B82F6', padding: 4 }]}><Text style={{ color: '#FFF', fontSize: 10, fontWeight: 'bold' }}>{index + 1}</Text></View>
            </Mapbox.PointAnnotation>
          );
        })}

        {incomingRide?.destinationLng != null && incomingRide?.destinationLat != null && (
          <Mapbox.PointAnnotation id="dropoffMarker" coordinate={[Number(incomingRide.destinationLng), Number(incomingRide.destinationLat)]}>
            <View style={styles.markerDestination}><Ionicons name="flag" size={24} color="#FFF" /></View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      <SafeAreaView style={styles.headerContainer} pointerEvents="box-none">
        <View style={styles.headerRow}>
          <TouchableOpacity style={[styles.statusPill, isOnline ? styles.pillOnline : styles.pillOffline]} onPress={isOnline ? stopTracking : startTracking} disabled={rideState !== 'idle' || isLoading}>
            <View style={[styles.statusDot, isOnline ? styles.dotGreen : styles.dotRed]} />
            <Text style={[styles.statusPillText, { color: isOnline ? '#1A202C' : '#FFF' }]}>{isOnline ? 'Online' : 'Offline'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.earningsPill} onPress={() => navigation.navigate('Earnings')}>
            <Ionicons name="cash" size={16} color="#16A34A" />
            <Text style={styles.earningsPillText}>{(todayEarnings || 0).toLocaleString('pt-BR')} XOF</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.filterPill} onPress={() => setShowFilterModal(true)}>
            <Ionicons name="options" size={18} color="#1A202C" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.statusPill, { paddingHorizontal: 8, paddingVertical: 6 }]} onPress={() => navigation.navigate('Profile')}>
            {profileImageUrl ? <Image source={{ uri: profileImageUrl }} style={styles.headerProfileImage} /> : <Ionicons name="person-circle-outline" size={24} color="#1A202C" />}
          </TouchableOpacity>
        </View>

        {isLowBattery && (
          <View style={styles.lowBatteryBanner}>
            <Ionicons name="battery-dead" size={16} color="#FFF" />
            <Text style={styles.lowBatteryText}>Bateria Fraca ({Math.round((batteryLevel || 0) * 100)}%) - Modo Economia Ativo</Text>
          </View>
        )}
      </SafeAreaView>

      <TouchableOpacity style={styles.recenterButton} onPress={handleRecenterMap}>
        <Ionicons name="locate" size={24} color="#1A202C" />
      </TouchableOpacity>

      {isOnline && (
        <TouchableOpacity style={styles.sosButton} onPress={() => setShowSosModal(true)}>
          <Text style={styles.sosText}>🚨 SOS</Text>
        </TouchableOpacity>
      )}

      {rideState === 'in_progress' && (
        <TouchableOpacity style={[styles.audioRecordButton, audioRecorder.isRecording && styles.audioRecordButtonActive]} onPress={toggleAudioRecording}>
          <Ionicons name={audioRecorder.isRecording ? 'mic' : 'mic-outline'} size={22} color="#FFF" />
          <Text style={styles.audioRecordText}>{audioRecorder.isRecording ? 'Gravando Áudio...' : 'Gravar Áudio'}</Text>
        </TouchableOpacity>
      )}

      {['accepted', 'arrived', 'in_progress'].includes(rideState) && (
        <TouchableOpacity style={styles.gpsFloatingButton} onPress={() => setShowNavSheet(true)}>
          <Ionicons name="navigate" size={22} color="#FFF" />
          <Text style={styles.gpsFloatingText}>GPS</Text>
        </TouchableOpacity>
      )}

      <DriverSOSModal visible={showSosModal} onClose={() => setShowSosModal(false)} currentRideId={activeRideId} />
      <RatingModal visible={showRatingModal} targetName={finishedTargetName} isDriverEvaluating={true} onClose={() => setShowRatingModal(false)} onSubmit={handleSubmitRating} />

      <KeyboardAvoidingView style={styles.bottomSheetWrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
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
              paddingBottom: Math.max(insets.bottom + 16, 24),
              transform: [{ translateY: panY }] 
            }
          ]}
        >
          <TouchableOpacity 
            activeOpacity={0.9}
            onPress={() => {
              if (!isExpandedRef.current) snapToState(true);
            }}
            style={styles.dragHandleArea} 
            {...panResponder.panHandlers}
          >
            <View style={styles.dragHandle} />
            <Text style={styles.dragHintText}>
              {isExpandedRef.current ? '▼ Arraste para recolher' : '▲ Toque ou arraste para expandir'}
            </Text>
          </TouchableOpacity>

          {rideState === 'idle' && (
            <View style={styles.idleContainer}>
              <Text style={styles.idleTitle}>{isOnline ? 'Buscando solicitações...' : 'Pronto para dirigir?'}</Text>
              <Text style={styles.idleSub}>{isOnline ? 'Mantenha o app aberto para receber chamados.' : 'Fique online para receber solicitações.'}</Text>
              {!isOnline && (
                <TouchableOpacity style={styles.goOnlineBtn} onPress={startTracking}>
                  <Text style={styles.goOnlineText}>Ficar Online</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {['accepted', 'arrived', 'in_progress'].includes(rideState) && incomingRide && (
            <View style={styles.activeRideContainer}>
              <View style={styles.serviceBadgeRow}>
                {incomingRide.serviceType === 'DELIVERY' ? (
                  <View style={[styles.serviceTypeBadge, { backgroundColor: '#0284C7' }]}><Ionicons name="cube" size={14} color="#FFF" /><Text style={styles.serviceTypeBadgeText}>ENTREGA DE ENCOMENDA</Text></View>
                ) : incomingRide.serviceType === 'RENTAL' ? (
                  <View style={[styles.serviceTypeBadge, { backgroundColor: '#7C3AED' }]}><Ionicons name="time" size={14} color="#FFF" /><Text style={styles.serviceTypeBadgeText}>ALUGUEL POR HORA</Text></View>
                ) : (
                  <View style={[styles.serviceTypeBadge, { backgroundColor: '#FF6600' }]}><Ionicons name="car-sport" size={14} color="#FFF" /><Text style={styles.serviceTypeBadgeText}>CORRIDA DE PASSAGEIRO</Text></View>
                )}
              </View>

              {incomingRide?.priceXof ? (
                <View style={{ backgroundColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: 'center', marginBottom: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0F172A' }}>Valor: {incomingRide.priceXof.toLocaleString('pt-BR')} XOF</Text>
                </View>
              ) : null}
              
              <View style={styles.etaHeader}>
                <Text style={styles.rideStateTitle}>
                  {rideState === 'accepted' ? (driverEta ? `Chegando em ${driverEta} min` : 'Indo ao local') : rideState === 'arrived' ? 'Aguardando Cliente' : (driverEta ? `Chegando ao destino em ${driverEta} min` : 'Viagem em Andamento')}
                </Text>

                {rideState === 'arrived' && (
                  <View style={styles.waitTimerBox}>
                    <Ionicons name="timer-outline" size={16} color={canCancelNoShow ? '#DC2626' : '#FF6600'} />
                    <Text style={[styles.waitTimerText, canCancelNoShow && { color: '#DC2626' }]}>{canCancelNoShow ? 'Tempo limite atingido!' : `Tempo grátis restante: ${formatWaitTime(waitTimeLeft)}`}</Text>
                  </View>
                )}
                <Text style={styles.rideStateSub}>{rideState === 'accepted' ? 'Siga a rota até o local de embarque/coleta.' : rideState === 'arrived' ? 'O cliente foi notificado da sua chegada.' : 'Siga a rota até o destino final.'}</Text>
              </View>

              <View style={styles.passengerProfileRow}>
                <View style={styles.passengerPhotoContainer}>
                  {incomingRide.passengerPhoto ? (
                    <Image source={{ uri: formatImageUrl(incomingRide.passengerPhoto) }} style={styles.passengerPhoto} />
                  ) : (
                    <Ionicons name="person" size={24} color="#A0AEC0" />
                  )}
                </View>
                <View style={styles.passengerDetails}>
                  <Text style={styles.passengerName}>{displayPassengerName}</Text>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={14} color="#FF6600" />
                    <Text style={styles.ratingText}>{incomingRide.passengerRating?.toFixed(1) || '5.0'}</Text>
                  </View>
                </View>
                {(incomingRide.passengerPhone || incomingRide.guestPhone) && (
                  <TouchableOpacity style={styles.callIconBtn} onPress={handleCallPassenger}><Ionicons name="call" size={18} color="#FFF" /></TouchableOpacity>
                )}
              </View>

              <View style={[styles.routeAddressesContainer, { marginTop: 10, marginBottom: 5, padding: 10, backgroundColor: '#F8FAFC', borderRadius: 10 }]}>
                <View style={styles.addressItem}>
                  <Ionicons name="location" size={18} color="#059669" />
                  <View style={styles.addressTextWrapper}>
                    <Text style={styles.addressLabel}>Buscar em:</Text>
                    <Text style={styles.addressValue} numberOfLines={2}>{incomingRide?.originAddress || 'Endereço de origem'}</Text>
                  </View>
                </View>

                {incomingRide?.extraStopAddress ? (
                  <View style={styles.addressItem}>
                    <Ionicons name="flag" size={16} color="#D97706" />
                    <View style={styles.addressTextWrapper}>
                      <Text style={[styles.addressLabel, { color: '#D97706' }]}>Parada Intermediária:</Text>
                      <Text style={styles.addressValue} numberOfLines={2}>{incomingRide.extraStopAddress}</Text>
                    </View>
                  </View>
                ) : null}

                {incomingRide?.stops && incomingRide.stops.length > 0 && !incomingRide.extraStopAddress ? (
                  incomingRide.stops.map((stop: any, index: number) => (
                    <View key={`active-stop-${index}`} style={styles.addressItem}>
                      <Ionicons name="flag" size={16} color="#D97706" />
                      <View style={styles.addressTextWrapper}>
                        <Text style={[styles.addressLabel, { color: '#D97706' }]}>Parada {index + 1}:</Text>
                        <Text style={styles.addressValue} numberOfLines={2}>{stop.address || stop.originAddress || `Parada ${index + 1}`}</Text>
                      </View>
                    </View>
                  ))
                ) : null}

                <View style={styles.addressItem}>
                  <Ionicons name="flag" size={18} color="#DC2626" />
                  <View style={styles.addressTextWrapper}>
                    <Text style={styles.addressLabel}>Levar para:</Text>
                    <Text style={styles.addressValue} numberOfLines={2}>{incomingRide?.destinationAddress || 'Endereço de destino'}</Text>
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
                    <Ionicons name="chatbubbles" size={18} color="#0284C7" />
                    <Text style={styles.actionButtonSecondaryText}>Chat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => setShowNavSheet(true)}>
                    <Ionicons name="compass" size={18} color="#EA4335" />
                    <Text style={[styles.actionButtonSecondaryText, { color: '#EA4335' }]}>GPS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButtonSecondary} onPress={handleCallPassenger}>
                    <Ionicons name="call" size={18} color="#16A34A" />
                    <Text style={[styles.actionButtonSecondaryText, { color: '#16A34A' }]}>Ligar</Text>
                  </TouchableOpacity>
                  {rideState === 'accepted' && (
                    <TouchableOpacity style={styles.actionButtonSecondary} onPress={handleInaccessibleLocation}>
                      <Ionicons name="warning" size={18} color="#F59E0B" />
                      <Text style={[styles.actionButtonSecondaryText, { color: '#F59E0B' }]}>Acesso</Text>
                    </TouchableOpacity>
                  )}
                  {canCancelNoShow ? (
                    <TouchableOpacity style={styles.noShowBtnDanger} onPress={handleNoShowCancel}>
                      <Ionicons name="alert-circle" size={18} color="#FFF" />
                      <Text style={styles.noShowBtnText}>No-Show</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.cancelButtonDanger} onPress={() => setShowCancelModal(true)}><Ionicons name="close-circle" size={18} color="#DC2626" /></TouchableOpacity>
                  )}
                </View>
              )}

              {rideState === 'accepted' && (
                <TouchableOpacity style={[styles.actionBtnBlue, isLoading && { opacity: 0.7 }]} onPress={handleArrived} disabled={isLoading}>
                  <Text style={styles.actionBtnText}>{isLoading ? 'Enviando...' : 'Cheguei ao Local'}</Text>
                </TouchableOpacity>
              )}
              {rideState === 'arrived' && (
                <TouchableOpacity style={styles.actionBtnGreen} onPress={() => setShowOtpModal(true)}>
                  <Text style={styles.actionBtnText}>Inserir PIN / Iniciar Viagem</Text>
                </TouchableOpacity>
              )}
              {rideState === 'in_progress' && (
                <TouchableOpacity style={[styles.actionBtnOrange, isLoading && { opacity: 0.7 }]} onPress={handleFinishRide} disabled={isLoading}>
                  <Text style={styles.actionBtnText}>{isLoading ? 'Processando...' : 'Finalizar e Cobrar'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>

      <Modal visible={showFilterModal} transparent animationType="slide">
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalCard}>
            <Text style={styles.filterModalTitle}>Preferências de Chamada</Text>
            <Text style={styles.filterModalSub}>Selecione quais serviços você deseja receber no momento:</Text>
            
            <View style={styles.filterRow}>
              <View style={styles.filterLabelContainer}><Ionicons name="car-sport" size={20} color="#FF6600" /><Text style={styles.filterLabelText}>Corridas de Passageiro</Text></View>
              <Switch value={serviceFilters.RIDE} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, RIDE: val }))} trackColor={{ false: '#CBD5E1', true: '#FF6600' }} />
            </View>
            <View style={styles.filterRow}>
              <View style={styles.filterLabelContainer}><Ionicons name="cube" size={20} color="#0284C7" /><Text style={styles.filterLabelText}>Entregas de Encomenda</Text></View>
              <Switch value={serviceFilters.DELIVERY} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, DELIVERY: val }))} trackColor={{ false: '#CBD5E1', true: '#0284C7' }} />
            </View>
            <View style={styles.filterRow}>
              <View style={styles.filterLabelContainer}><Ionicons name="time" size={20} color="#7C3AED" /><Text style={styles.filterLabelText}>Aluguel por Hora</Text></View>
              <Switch value={serviceFilters.RENTAL} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, RENTAL: val }))} trackColor={{ false: '#CBD5E1', true: '#7C3AED' }} />
            </View>

            <TouchableOpacity style={styles.closeFilterBtn} onPress={() => setShowFilterModal(false)}><Text style={styles.closeFilterText}>Salvar Preferências</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TurnByTurnSheet 
        visible={showNavSheet} 
        onClose={() => setShowNavSheet(false)} 
        destination={navDestination} 
        isIntermediateStop={isNavigatingToStop} 
        onConfirmStop={() => setCurrentStopIndex(prev => prev + 1)} 
      />

      <Modal visible={rideState === 'idle' && !!incomingRide} transparent animationType="fade">
        <View style={styles.newRequestOverlay}>
          <View style={styles.newRequestCard}>
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={incomingRide?.serviceType === 'DELIVERY' ? 'cube' : 'car-sport'} size={20} color="#2563EB" />
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#0F172A' }}>Nova Corrida!</Text>
              </View>
              <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#86EFAC' }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#15803D' }}>
                  {Number(incomingRide?.priceXof || 0).toLocaleString('pt-BR')} XOF
                </Text>
              </View>
            </View>

            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${Math.max(0, (timeLeft / 15) * 100)}%` }]} />
            </View>
            <Text style={styles.timerText}>Tempo restante: {timeLeft}s</Text>

            <View style={styles.modalPassengerRow}>
              <View style={styles.passengerPhotoContainerSm}>
                {incomingRide?.passengerPhoto ? (
                  <Image source={{ uri: formatImageUrl(incomingRide.passengerPhoto) }} style={{ width: '100%', height: '100%', borderRadius: 18 }} />
                ) : (
                  <Ionicons name="person" size={18} color="#94A3B8" />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.modalPassengerName}>{displayPassengerName}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Ionicons name="star" size={12} color="#F59E0B" />
                  <Text style={styles.modalPassengerRating}>{incomingRide?.passengerRating?.toFixed(1) || '5.0'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.routeTimelineContainer}>
              <View style={styles.timelineRow}>
                <Ionicons name="location" size={18} color="#16A34A" />
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineLabel}>BUSCAR EM:</Text>
                  <Text style={styles.timelineAddress} numberOfLines={2}>{incomingRide?.originAddress || 'Local de origem'}</Text>
                </View>
              </View>

              {incomingRide?.stops && incomingRide.stops.length > 0 ? (
                incomingRide.stops.map((stop: any, index: number) => (
                  <View key={`modal-stop-${index}`} style={styles.timelineRow}>
                    <Ionicons name="flag" size={16} color="#D97706" />
                    <View style={styles.timelineTextContainer}>
                      <Text style={[styles.timelineLabel, { color: '#D97706' }]}>
                        PARADA {incomingRide.stops!.length > 1 ? index + 1 : ''}:
                      </Text>
                      <Text style={styles.timelineAddress} numberOfLines={2}>{stop.address || stop.originAddress || stop}</Text>
                    </View>
                  </View>
                ))
              ) : incomingRide?.extraStopAddress ? (
                <View style={styles.timelineRow}>
                  <Ionicons name="flag" size={16} color="#D97706" />
                  <View style={styles.timelineTextContainer}>
                    <Text style={[styles.timelineLabel, { color: '#D97706' }]}>PARADA INTERMEDIÁRIA:</Text>
                    <Text style={styles.timelineAddress} numberOfLines={2}>{incomingRide.extraStopAddress}</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.timelineRow}>
                <Ionicons name="flag" size={18} color="#DC2626" />
                <View style={styles.timelineTextContainer}>
                  <Text style={[styles.timelineLabel, { color: '#DC2626' }]}>LEVAR PARA (DESTINO FINAL):</Text>
                  <Text style={styles.timelineAddress} numberOfLines={2}>{incomingRide?.destinationAddress || 'Endereço de destino'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.newRequestActions}>
              <TouchableOpacity 
                style={styles.rejectBtn} 
                onPress={() => { Vibration.cancel(); setIncomingRide(null); }} 
                disabled={isLoading}
              >
                <Text style={styles.rejectText}>Recusar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.acceptBtn, isLoading && { opacity: 0.7 }]} 
                activeOpacity={0.8} 
                disabled={isLoading} 
                onPress={() => {
                  if (isLoading) return;
                  if (incomingRide?.rideId && driver?.id) {
                    const lat = Number(location?.coords?.latitude || 11.8632);
                    const lng = Number(location?.coords?.longitude || -15.5977);
                    acceptRide(incomingRide.rideId, driver.id, lat, lng);
                  }
                }}
              >
                <Text style={styles.acceptText}>{isLoading ? 'Aceitando...' : 'Aceitar Chamada'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

      <Modal visible={showReceiptModal} transparent animationType="slide">
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptCard}>
            <Text style={styles.receiptHeader}>✅ Serviço Concluído</Text>
            <Text style={styles.receiptSub}>Obrigado por mais um serviço finalizado.</Text>
            <View style={styles.divider} />
            <Text style={styles.receiptLabel}>Total Ganho:</Text>
            <Text style={styles.receiptAmount}>
              {(completedInfo?.fareXOF || 0).toLocaleString('pt-BR')} XOF
            </Text>
            <Text style={styles.receiptDist}>ID da Transação: {completedInfo?.transactionId || 'N/A'}</Text>
            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity style={styles.closeReceiptBtn} onPress={() => { setShowReceiptModal(false); setShowRatingModal(true); }}>
                <Text style={styles.closeReceiptText}>Avaliar Cliente</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <StartRideOtpModal visible={showOtpModal} onCancel={() => setShowOtpModal(false)} onSubmitOtp={handleStartRideWithOtp} />
      <CancelModal visible={showCancelModal} userType="DRIVER" isPenaltyApplicable={false} onClose={() => setShowCancelModal(false)} onConfirm={handleConfirmCancel} />
    </View>
  );
}

const floatingShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  android: {
    elevation: 6,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAFC' },
  map: { flex: 1, width: '100%', height: '100%', position: 'absolute' },
  carMarkerContainer: { backgroundColor: '#0284C7', padding: 8, borderRadius: 20, borderWidth: 2, borderColor: '#FFF', ...floatingShadow },
  markerPickup: { backgroundColor: '#FF6600', padding: 6, borderRadius: 20, borderWidth: 2, borderColor: '#FFF', ...floatingShadow },
  markerDestination: { backgroundColor: '#0284C7', padding: 6, borderRadius: 20, borderWidth: 2, borderColor: '#FFF', ...floatingShadow },
  headerContainer: { position: 'absolute', top: 0, width: '100%', zIndex: 10, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 45 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingHorizontal: 16 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 30, ...floatingShadow },
  pillOnline: { backgroundColor: '#FFF' },
  pillOffline: { backgroundColor: '#2D3748' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  dotGreen: { backgroundColor: '#38A169' },
  dotRed: { backgroundColor: '#FC8181' },
  statusPillText: { fontSize: 13, fontWeight: 'bold' },
  earningsPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 30, gap: 6, ...floatingShadow },
  earningsPillText: { fontSize: 13, fontWeight: '900', color: '#1A202C' },
  filterPill: { backgroundColor: '#FFF', padding: 10, borderRadius: 25, ...floatingShadow },
  headerProfileImage: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#059669' },
  lowBatteryBanner: { backgroundColor: '#DC2626', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 6, marginTop: 8 },
  lowBatteryText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  recenterButton: { position: 'absolute', top: 125, left: 20, backgroundColor: '#FFF', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', zIndex: 99, ...floatingShadow },
  sosButton: { position: 'absolute', top: 125, right: 20, backgroundColor: '#DC2626', width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', zIndex: 99, ...floatingShadow },
  sosText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  audioRecordButton: { position: 'absolute', top: 185, left: 20, backgroundColor: '#475569', flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 25, justifyContent: 'center', alignItems: 'center', zIndex: 99, gap: 6, ...floatingShadow },
  audioRecordButtonActive: { backgroundColor: '#DC2626' },
  audioRecordText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  gpsFloatingButton: { position: 'absolute', top: 185, right: 20, backgroundColor: '#2563EB', flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 25, justifyContent: 'center', alignItems: 'center', zIndex: 99, gap: 6, ...floatingShadow },
  gpsFloatingText: { color: '#FFF', fontWeight: '900', fontSize: 13 },
  bottomSheetWrapper: { flex: 1, justifyContent: 'flex-end' },
  bottomSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 8, elevation: 15, ...floatingShadow },
  dragHandleArea: { width: '100%', alignItems: 'center', paddingVertical: 8 },
  dragHandle: { width: 44, height: 5, backgroundColor: '#CBD5E1', borderRadius: 3, marginBottom: 4 },
  dragHintText: { fontSize: 11, color: '#64748B', fontWeight: '700' },
  idleContainer: { alignItems: 'center', paddingVertical: 10 },
  idleTitle: { fontSize: 22, fontWeight: '900', color: '#1A202C', marginBottom: 8 },
  idleSub: { fontSize: 15, color: '#718096', marginBottom: 20, textAlign: 'center' },
  goOnlineBtn: { backgroundColor: '#FF6600', width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center', ...floatingShadow },
  goOnlineText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  activeRideContainer: { width: '100%' },
  serviceBadgeRow: { alignItems: 'center', marginBottom: 8 },
  serviceTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  serviceTypeBadgeText: { color: '#FFF', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  etaHeader: { alignItems: 'center', marginBottom: 12 },
  rideStateTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A202C', marginBottom: 2 },
  waitTimerBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 4, backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  waitTimerText: { fontSize: 12, fontWeight: 'bold', color: '#D97706' },
  rideStateSub: { fontSize: 13, color: '#718096' },
  passengerProfileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
  passengerPhotoContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDF2F7', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  passengerPhoto: { width: '100%', height: '100%' },
  passengerDetails: { flex: 1, justifyContent: 'center' },
  passengerName: { fontSize: 16, fontWeight: '700', color: '#1A202C' },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingText: { fontSize: 13, fontWeight: '600', color: '#4A5568', marginLeft: 4 },
  callIconBtn: { padding: 10, backgroundColor: '#25D366', borderRadius: 22, ...floatingShadow },
  deliveryDetailsCard: { backgroundColor: '#F0F9FF', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#BAE6FD', marginBottom: 12 },
  deliveryDetailsTitle: { fontSize: 13, fontWeight: 'bold', color: '#0369A1' },
  deliveryDetailsText: { fontSize: 13, color: '#0C4A6E', marginTop: 2 },
  deliveryNotes: { fontSize: 12, color: '#0284C7', fontStyle: 'italic', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionButtonSecondary: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0F9FF', paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: '#BAE6FD' },
  actionButtonSecondaryText: { color: '#0284C7', fontWeight: '800', fontSize: 13, marginLeft: 4 },
  cancelButtonDanger: { paddingHorizontal: 14, backgroundColor: '#FEF2F2', borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FECACA' },
  noShowBtnDanger: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, backgroundColor: '#DC2626', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  noShowBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },
  actionBtnBlue: { backgroundColor: '#0284C7', padding: 18, borderRadius: 16, width: '100%', alignItems: 'center', ...floatingShadow },
  actionBtnGreen: { backgroundColor: '#16A34A', padding: 18, borderRadius: 16, width: '100%', alignItems: 'center', ...floatingShadow },
  actionBtnOrange: { backgroundColor: '#FF6600', padding: 18, borderRadius: 16, width: '100%', alignItems: 'center', ...floatingShadow },
  actionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 16, textTransform: 'uppercase' },
  filterModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  filterModalCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, ...floatingShadow },
  filterModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A202C', marginBottom: 4 },
  filterModalSub: { fontSize: 13, color: '#64748B', marginBottom: 20 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10 },
  filterLabelContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterLabelText: { fontSize: 15, fontWeight: '600', color: '#1E293B' },
  closeFilterBtn: { backgroundColor: '#FF6600', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20, ...floatingShadow },
  closeFilterText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  newRequestOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  newRequestCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, ...floatingShadow },
  progressBarContainer: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, marginVertical: 8, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#FF6600' },
  timerText: { textAlign: 'center', color: '#718096', fontSize: 13, marginBottom: 12, fontWeight: '600' },
  modalPassengerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  passengerPhotoContainerSm: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EDF2F7', justifyContent: 'center', alignItems: 'center', marginRight: 8, overflow: 'hidden' },
  modalPassengerName: { fontSize: 15, fontWeight: '700', color: '#1A202C' },
  modalPassengerRating: { fontSize: 13, fontWeight: '600', color: '#4A5568', marginLeft: 2 },
  newRequestActions: { flexDirection: 'row', gap: 12 },
  rejectBtn: { flex: 1, backgroundColor: '#EDF2F7', paddingVertical: 14, borderRadius: 12, alignItems: 'center', ...floatingShadow },
  rejectText: { color: '#4A5568', fontWeight: 'bold', fontSize: 15 },
  acceptBtn: { flex: 2, backgroundColor: '#16A34A', paddingVertical: 14, borderRadius: 12, alignItems: 'center', ...floatingShadow },
  acceptText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  receiptOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  receiptCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, alignItems: 'center' },
  receiptHeader: { fontSize: 20, fontWeight: 'bold', color: '#16A34A', marginBottom: 4 },
  receiptSub: { fontSize: 13, color: '#718096', marginBottom: 16 },
  divider: { width: '100%', height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },
  receiptLabel: { fontSize: 14, color: '#A0AEC0', marginBottom: 4 },
  receiptAmount: { fontSize: 32, fontWeight: '900', color: '#1A202C', marginBottom: 8 },
  receiptDist: { fontSize: 12, color: '#A0AEC0', marginBottom: 20 },
  closeReceiptBtn: { backgroundColor: '#FF6600', width: '100%', paddingVertical: 14, borderRadius: 12, alignItems: 'center', ...floatingShadow },
  closeReceiptText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  routeAddressesContainer: { marginVertical: 12, paddingHorizontal: 8, gap: 12 },
  addressItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  addressTextWrapper: { flex: 1 },
  addressLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 2 },
  addressValue: { fontSize: 14, fontWeight: 'bold', color: '#1F2937' },
  routeTimelineContainer: { marginVertical: 12, gap: 12 },
  timelineRow: { flexDirection: 'row', gap: 10 },
  timelineTextContainer: { flex: 1 },
  timelineLabel: { fontSize: 10, fontWeight: '800', color: '#16A34A', marginBottom: 2 },
  timelineAddress: { fontSize: 13, fontWeight: '600', color: '#1E293B' },
});