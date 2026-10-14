import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal, 
  KeyboardAvoidingView, Platform, StatusBar, Dimensions, Image, Vibration, Switch,
  Animated, PanResponder, Easing, ScrollView
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
import * as Speech from 'expo-speech';
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

// 🛡️ Coordenadas de Bissau (Centro) como fallback padrão
const BISSAU_CENTER_LNG = -15.5977;
const BISSAU_CENTER_LAT = 11.8632;

// 🛡️ Zonas de demanda em Bissau
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

// 🛡️ TASK EM SEGUNDO PLANO BLINDADA
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const { locations } = data;
  const location = locations?.[0];

  if (location?.coords) {
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
        } catch {
          // Fallback silencioso sem travar a thread
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
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  
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
  // Guarde os passos da rota no estado do componente
const [routeSteps, setRouteSteps] = useState<any[]>([]);
const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
const lastSpokenInstructionRef = useRef<string>('');
  const incomingRideRef = useRef(incomingRide);
  const activeRideIdRef = useRef(activeRideId);
  const isOnlineRef = useRef(isOnline);
  const serviceFiltersRef = useRef(serviceFilters);

  useEffect(() => { incomingRideRef.current = incomingRide; }, [incomingRide]);
  useEffect(() => { activeRideIdRef.current = activeRideId; }, [activeRideId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { serviceFiltersRef.current = serviceFilters; }, [serviceFilters]);

  // 🎯 ANIMAÇÃO E LIMITE DE DESLOCAMENTO DO BOTTOM SHEET (BLINDADO)
  const panY = useRef(new Animated.Value(0)).current;
  const isExpandedRef = useRef(true);
  const [sheetHeight, setSheetHeight] = useState(380);

  // Calcula o limite para manter o painel visível sem cobrir o botão virtual do Android
  const maxCollapsedY = Math.max(100, sheetHeight - 90 - Math.max(insets.bottom, 20));
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

  const mapStyle = useMemo(() => {
    const hour = new Date().getHours();
    return (hour >= 19 || hour < 6) ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12';
  }, []);

  const navDestination = useMemo(() => {
    if (!incomingRide) return null;
    const isHeadingToDestination = rideState === 'in_progress';
    const destLat = Number(isHeadingToDestination ? incomingRide.destinationLat || BISSAU_CENTER_LAT : incomingRide.pickupLat || BISSAU_CENTER_LAT);
    const destLng = Number(isHeadingToDestination ? incomingRide.destinationLng || BISSAU_CENTER_LNG : incomingRide.pickupLng || BISSAU_CENTER_LNG);

    return {
      latitude: isNaN(destLat) ? BISSAU_CENTER_LAT : destLat,
      longitude: isNaN(destLng) ? BISSAU_CENTER_LNG : destLng,
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
      if (response?.data && isMountedRef.current) {
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
    if (!isMountedRef.current) return;
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

        if (storedRideId && storedRideData && storedRideState && isMountedRef.current) {
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
    // Adicionados: steps=true, voice_instructions=true, language=pt
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&steps=true&voice_instructions=true&banner_instructions=true&language=pt&access_token=${MAPBOX_TOKEN}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha requisição rota');
    const data = await response.json();

    if (data.routes && data.routes.length > 0 && isMountedRef.current) {
      const route = data.routes[0];
      setRouteCoordinates(route.geometry.coordinates);
      const eta = Math.ceil(route.duration / 60);
      setDriverEta(eta);

      // Extrai os passos/curvas da rota
      if (route.legs && route.legs[0]?.steps) {
        const steps = route.legs[0].steps;
        setRouteSteps(steps);
        setCurrentStepIndex(0);

        // Falar a primeira instrução assim que a rota é calculada
        if (steps.length > 0 && steps[0]?.maneuver?.instruction) {
          const firstInstruction = steps[0].maneuver.instruction;
          speakInstruction(firstInstruction);
        }
      }

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
    if (isMountedRef.current) {
      setRouteCoordinates([[startLng, startLat], [endLng, endLat]]);
      const distKm = calculateDirectDistance(startLat, startLng, endLat, endLng);
      setDriverEta(Math.max(1, Math.ceil((distKm / 30) * 60)));
    }
  }
};
// Função auxiliar para falar a instrução sem repetir o mesmo texto várias vezes
const speakInstruction = (text: string) => {
  if (!text || lastSpokenInstructionRef.current === text) return;
  
  lastSpokenInstructionRef.current = text;
  
  // Cancela fala anterior se houver e fala a nova instrução em português
  Speech.stop();
  Speech.speak(text, {
    language: 'pt-BR',
    pitch: 1.0,
    rate: 0.95, // Velocidade levemente pausada para facilitar o entendimento no trânsito
  });
};

// Monitora a posição GPS do motorista e compara com a próxima curva da rota
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

  const distMeters = distToStepKm * 1000;

  // Se o motorista está a menos de 40 metros do ponto da manobra, fala a próxima curva e avança
  if (distMeters <= 40) {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < routeSteps.length) {
      setCurrentStepIndex(nextIndex);
      const nextInstruction = routeSteps[nextIndex]?.maneuver?.instruction;
      if (nextInstruction) {
        speakInstruction(nextInstruction);
      }
    } else {
      speakInstruction('Você está se aproximando do seu destino.');
    }
  }
}, [location?.coords, routeSteps, currentStepIndex]);
// Função de tradução de instruções do Mapbox para Crioulo da Guiné-Bissau
const translateToKriol = (text: string): string => {
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
    .replace(/Você está se aproximando do seu destino/gi, 'Bu sta kuazi pa tchega na bu distinu lembranta passageiro de pega se objetos na veiculo tchabe telemovel');
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
      if (!isMountedRef.current) return;
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
      if (!isOnlineRef.current || !isMountedRef.current) return;
      
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
      if (!isMountedRef.current) return;
      setIsLoading(false);
      setRideState('in_progress');
      setShowOtpModal(false);
      snapToState(true);
      if (incomingRideRef.current && activeRideIdRef.current) persistActiveRideState(incomingRideRef.current, 'in_progress', activeRideIdRef.current);
    };

    const handleRideFinished = (data: any) => {
      if (!isMountedRef.current) return;
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
      if (!isMountedRef.current) return;
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
    if (incomingRide && rideState === 'idle' && timeLeft > 0) {
      timer = setInterval(() => {
        if (isMountedRef.current) setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && incomingRide && rideState === 'idle') { 
      Vibration.cancel(); 
      if (isMountedRef.current) setIncomingRide(null); 
    }
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
          if (!isMountedRef.current) return;
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
      if (isMountedRef.current) {
        setLocation(currentLoc);
        if (cameraRef.current) cameraRef.current.setCamera({ centerCoordinate: [currentLoc.coords.longitude, currentLoc.coords.latitude], zoomLevel: 16 });
      }
      if (socket && socket.connected) socket.emit('driver:online', { driverId: driver?.id, lat: currentLoc.coords.latitude, lng: currentLoc.coords.longitude });
      await startTrackingForState(rideState);
    } catch (e) {
      Alert.alert('Erro de Localização', 'Verifique o GPS do seu dispositivo.');
      if (isMountedRef.current) setIsOnline(false);
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
      if (!isMountedRef.current) return;
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
      if (isMountedRef.current) {
        Alert.alert('Modo Offline', 'Sua chegada foi registrada e será sincronizada assim que a rede voltar.');
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
      Alert.alert('Aviso de Rede', 'Conexão fraca. O cancelamento será sincronizado em breve.');
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
        Alert.alert('Modo Offline', 'Início de viagem gravado no aparelho.');
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
    const fallbackLat = Number(location?.coords?.latitude || incomingRide?.destinationLat || 11.8632);
    const fallbackLng = Number(location?.coords?.longitude || incomingRide?.destinationLng || -15.5977);
    const payload = { rideId: activeRideId, dropoffLat: fallbackLat, dropoffLng: fallbackLng };

    const processOfflineFinish = async () => {
      await saveActionToQueue('driver:finish_ride', payload);
      if (isMountedRef.current) {
        Alert.alert('Corrida Salva Offline 💾', 'Finalizada com sucesso no aparelho. A cobrança e recibo serão sincronizados assim que a rede voltar.');
        setFinishedRideId(activeRideId);
        setFinishedTargetName(displayPassengerName);
        setShowRatingModal(true);
        setIsLoading(false);
      }
    };

    if (socket && socket.connected) {
      socket.timeout(5000).emit('driver:finish_ride', payload, async (err: any, response: any) => {
        if (!isMountedRef.current) return;
        if (err) {
          await processOfflineFinish();
        } else if (response?.error) {
          Alert.alert('Erro', response.message || 'Não foi possível finalizar a corrida no servidor.');
          setIsLoading(false);
        } else {
          setFinishedRideId(activeRideId);
          setFinishedTargetName(displayPassengerName);
          setIsLoading(false);
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
    Alert.alert('Contato Protegido 🔒', 'Por motivos de segurança e privacidade, a comunicação deve ser feita exclusivamente pelo Chat.');
    setIsChatVisible(true);
  }

  function handleInaccessibleLocation() {
    if (!activeRideId || !socket || !socket.connected) return Alert.alert('Erro de Rede', 'Verifique sua conexão.');
    socket.emit('driver:alert_inaccessible_location', { 
      rideId: activeRideId, 
      title: 'Atenção do Motorista ⚠️', 
      message: 'O motorista informou que o local exato é de difícil acesso. Por favor, aproxime-se do ponto indicado no mapa.' 
    });
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

  const topHeaderInset = Math.max((insets?.top || 0) + 10, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 16);
  const bottomInset = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 24 : 16);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* MAPA DE NAVEGAÇÃO MAPBOX */}
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
            centerCoordinate: [Number(location?.coords.longitude || BISSAU_CENTER_LNG), Number(location?.coords.latitude || BISSAU_CENTER_LAT)],
            zoomLevel: 16,
          }}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {/* ZONAS DE DEMANDA */}
        {isOnline && (
          <Mapbox.ShapeSource id="demandZonesSource" shape={demandZonesData as any}>
            <Mapbox.CircleLayer id="demandZonesLayer" style={{ circleRadius: 40, circleColor: '#FF3300', circleOpacity: 0.2, circleBlur: 0.6 }} />
          </Mapbox.ShapeSource>
        )}

        {/* MARCADOR DO VEÍCULO */}
        {isOnline && location?.coords && (
          <Mapbox.PointAnnotation id="car-location" coordinate={[Number(location.coords.longitude), Number(location.coords.latitude)]}>
            <View style={styles.carMarkerContainer}>
              <Ionicons name="car" size={18} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* PONTO DE EMBARQUE */}
        {['accepted', 'arrived'].includes(rideState) && incomingRide && (
          <Mapbox.PointAnnotation id="pickup-location" coordinate={[Number(incomingRide.pickupLng), Number(incomingRide.pickupLat)]}>
            <View style={styles.markerPickup}>
              <Ionicons name="location" size={18} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* LINHA DA ROTA */}
        {routeCoordinates && routeCoordinates.length > 0 && (
          <Mapbox.ShapeSource id="routeSource" shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoordinates } }}>
            <Mapbox.LineLayer id="routeLine" style={{ lineColor: rideState === 'in_progress' ? '#3B82F6' : '#EAB308', lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
        )}

        {/* PARADAS INTERMEDIÁRIAS */}
        {stops && stops.map((stop: any, index: number) => {
          const isPassed = index < currentStopIndex;
          return (
            <Mapbox.PointAnnotation key={`stop-${index}`} id={`stop-${index}`} coordinate={[Number(stop.lng), Number(stop.lat)]}>
              <View style={[styles.carMarkerContainer, { backgroundColor: isPassed ? '#94A3B8' : '#3B82F6', padding: 4 }]}>
                <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>{index + 1}</Text>
              </View>
            </Mapbox.PointAnnotation>
          );
        })}

        {/* PONTO DE DESEMBARQUE */}
        {incomingRide?.destinationLng != null && incomingRide?.destinationLat != null && (
          <Mapbox.PointAnnotation id="dropoffMarker" coordinate={[Number(incomingRide.destinationLng), Number(incomingRide.destinationLat)]}>
            <View style={styles.markerDestination}>
              <Ionicons name="flag" size={18} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* HEADER SUPERIOR FLUTUANTE DE STATUS E GANHOS */}
      <View style={[styles.headerContainer, { top: topHeaderInset }]} pointerEvents="box-none">
        <View style={styles.headerRow}>
          <TouchableOpacity 
            style={[styles.statusPill, isOnline ? styles.pillOnline : styles.pillOffline]} 
            onPress={isOnline ? stopTracking : startTracking} 
            disabled={rideState !== 'idle' || isLoading}
            activeOpacity={0.85}
          >
            <View style={[styles.statusDot, isOnline ? styles.dotGreen : styles.dotRed]} />
            <Text style={[styles.statusPillText, { color: isOnline ? '#0F172A' : '#FFF' }]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.earningsPill} onPress={() => navigation.navigate('Earnings')} activeOpacity={0.85}>
            <Ionicons name="wallet-outline" size={15} color="#10B981" />
            <Text style={styles.earningsPillText}>{(todayEarnings || 0).toLocaleString('pt-BR')} XOF</Text>
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

        {isLowBattery && (
          <View style={styles.lowBatteryBanner}>
            <Ionicons name="battery-dead" size={13} color="#FFF" />
            <Text style={styles.lowBatteryText}>
              Bateria Fraca ({Math.round((batteryLevel || 0) * 100)}%) - Modo Economia
            </Text>
          </View>
        )}
      </View>

      {/* BOTÕES FLUTUANTES SOBRE O MAPA */}
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
            <Ionicons name={audioRecorder.isRecording ? 'mic' : 'mic-outline'} size={16} color="#FFF" />
            <Text style={styles.audioRecordText}>{audioRecorder.isRecording ? 'Gravando...' : 'Gravar Áudio'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* MODAIS DE SEGURANÇA E AVALIAÇÃO */}
      <DriverSOSModal visible={showSosModal} onClose={() => setShowSosModal(false)} currentRideId={activeRideId} />
      <RatingModal visible={showRatingModal} targetName={finishedTargetName} isDriverEvaluating={true} onClose={() => setShowRatingModal(false)} onSubmit={handleSubmitRating} />

      {/* PAINEL FLUTUANTE INFERIOR (BOTTOM SHEET DESLIZANTE) */}
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
          {/* BARRA DE ARRASTE TÁTIL */}
          <TouchableOpacity 
            activeOpacity={0.8}
            onPress={() => {
              if (typeof snapToState === 'function') {
                snapToState(!isExpandedRef.current);
              }
            }}
            style={styles.dragHandleArea} 
            {...panResponder.panHandlers}
          >
            <View style={styles.dragHandle} />
            <Text style={styles.dragHintText}>
              {isExpandedRef.current ? '▼ Arraste para recolher' : '▲ Toque ou arraste para expandir'}
            </Text>
          </TouchableOpacity>

          <ScrollView 
            nestedScrollEnabled 
            showsVerticalScrollIndicator={false} 
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
          >
            {/* MODO LIVRE (IDLE) */}
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

            {/* CORRIDA EM ANDAMENTO OU ACEITA */}
            {['accepted', 'arrived', 'in_progress'].includes(rideState) && incomingRide && (
              <View style={styles.activeRideContainer}>
                
                {/* CABEÇALHO RESUMIDO DA CORRIDA */}
                <View style={styles.compactHeaderRow}>
                  <View style={styles.serviceBadgeRow}>
                    {incomingRide.serviceType === 'DELIVERY' ? (
                      <View style={[styles.serviceTypeBadge, { backgroundColor: '#3B82F6' }]}>
                        <Ionicons name="cube" size={12} color="#FFF" />
                        <Text style={styles.serviceTypeBadgeText}>ENTREGA DE ENCOMENDA</Text>
                      </View>
                    ) : incomingRide.serviceType === 'RENTAL' ? (
                      <View style={[styles.serviceTypeBadge, { backgroundColor: '#7C3AED' }]}>
                        <Ionicons name="time" size={12} color="#FFF" />
                        <Text style={styles.serviceTypeBadgeText}>ALUGUEL POR HORA</Text>
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
                      <Text style={styles.priceBadgeText}>{incomingRide.priceXof.toLocaleString('pt-BR')} XOF</Text>
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

                  {rideState === 'arrived' && (
                    <View style={styles.waitTimerBox}>
                      <Ionicons name="timer-outline" size={14} color={canCancelNoShow ? '#EF4444' : '#EAB308'} />
                      <Text style={[styles.waitTimerText, canCancelNoShow && { color: '#EF4444' }]}>
                        {canCancelNoShow ? 'Tempo limite atingido!' : `Tempo grátis: ${formatWaitTime(waitTimeLeft)}`}
                      </Text>
                    </View>
                  )}
                </View>

                {/* PERFIL DO PASSAGEIRO */}
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

                {/* ENDEREÇOS E ROTA */}
                <View style={styles.routeAddressesContainer}>
                  <View style={styles.addressItem}>
                    <Ionicons name="location" size={16} color="#10B981" />
                    <View style={styles.addressTextWrapper}>
                      <Text style={styles.addressLabel}>Buscar em:</Text>
                      <Text style={styles.addressValue} numberOfLines={1}>{incomingRide?.originAddress || 'Endereço de origem'}</Text>
                    </View>
                  </View>

                  {incomingRide?.extraStopAddress ? (
                    <View style={styles.addressItem}>
                      <Ionicons name="flag" size={15} color="#EAB308" />
                      <View style={styles.addressTextWrapper}>
                        <Text style={[styles.addressLabel, { color: '#EAB308' }]}>Parada Intermediária:</Text>
                        <Text style={styles.addressValue} numberOfLines={1}>{incomingRide.extraStopAddress}</Text>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.addressItem}>
                    <Ionicons name="flag" size={16} color="#EF4444" />
                    <View style={styles.addressTextWrapper}>
                      <Text style={styles.addressLabel}>Levar para:</Text>
                      <Text style={styles.addressValue} numberOfLines={1}>{incomingRide?.destinationAddress || 'Endereço de destino'}</Text>
                    </View>
                  </View>
                </View>

                {/* DETALHES DA ENCOMENDA (SE FOR ENTREGA) */}
                {incomingRide.serviceType === 'DELIVERY' && (
                  <View style={styles.deliveryDetailsCard}>
                    <Text style={styles.deliveryDetailsTitle}>📦 Instruções da Encomenda:</Text>
                    <Text style={styles.deliveryDetailsText}>Destinatário: {incomingRide.recipientName || 'Não especificado'}</Text>
                    {incomingRide.deliveryNotes ? <Text style={styles.deliveryNotes}>Nota: {incomingRide.deliveryNotes}</Text> : null}
                  </View>
                )}

                {/* BARRA DE AÇÕES (CHAT, GPS, LIGAR, CANCELAR) */}
                {rideState !== 'in_progress' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => setIsChatVisible(true)}>
                      <Ionicons name="chatbubbles-outline" size={16} color="#EAB308" />
                      <Text style={styles.actionButtonSecondaryText}>Chat</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => setShowNavSheet(true)}>
                      <Ionicons name="navigate-outline" size={16} color="#3B82F6" />
                      <Text style={styles.actionButtonSecondaryText}>GPS</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.actionButtonSecondary} onPress={handleCallPassenger}>
                      <Ionicons name="call-outline" size={16} color="#10B981" />
                      <Text style={[styles.actionButtonSecondaryText, { color: '#10B981' }]}>Ligar</Text>
                    </TouchableOpacity>

                    {canCancelNoShow ? (
                      <TouchableOpacity style={styles.noShowBtnDanger} onPress={handleNoShowCancel}>
                        <Ionicons name="alert-circle" size={16} color="#FFF" />
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

                {/* BOTÃO PRINCIPAL DE AVANÇO DE ETAPA */}
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

      {/* MODAL PREFERÊNCIAS DE CHAMADA */}
      <Modal visible={showFilterModal} transparent animationType="slide">
        <View style={styles.filterModalOverlay}>
          <View style={[
            styles.filterModalCard,
            { paddingBottom: Math.max((insets?.bottom || 0) + 24, Platform.OS === 'android' ? 36 : 20) }
          ]}>
            <Text style={styles.filterModalTitle}>Preferências de Chamada</Text>
            <Text style={styles.filterModalSub}>Selecione os serviços que você deseja receber:</Text>
            
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
                <Text style={styles.filterLabelText}>Aluguel por Hora</Text>
              </View>
              <Switch value={serviceFilters.RENTAL} onValueChange={(val) => setServiceFilters(prev => ({ ...prev, RENTAL: val }))} trackColor={{ false: '#334155', true: '#7C3AED' }} />
            </View>

            <TouchableOpacity style={styles.closeFilterBtn} onPress={() => setShowFilterModal(false)} activeOpacity={0.85}>
              <Text style={styles.closeFilterText}>Salvar Preferências</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* NAVEGAÇÃO PASSOS A PASSO */}
      <TurnByTurnSheet 
        visible={showNavSheet} 
        onClose={() => setShowNavSheet(false)} 
        destination={navDestination} 
        isIntermediateStop={isNavigatingToStop} 
        onConfirmStop={() => setCurrentStopIndex(prev => prev + 1)} 
      />

      {/* MODAL DE NOVA SOLICITAÇÃO */}
      <Modal visible={rideState === 'idle' && !!incomingRide} transparent animationType="fade">
        <View style={styles.newRequestOverlay}>
          <View style={styles.newRequestCard}>
            <View style={styles.newRequestHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={incomingRide?.serviceType === 'DELIVERY' ? 'cube' : 'car-sport'} size={18} color="#EAB308" />
                <Text style={styles.newRequestTitle}>Nova Corrida!</Text>
              </View>
              <View style={styles.newRequestPriceBadge}>
                <Text style={styles.newRequestPriceText}>
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
                  <Image source={{ uri: formatImageUrl(incomingRide.passengerPhoto) }} style={{ width: '100%', height: '100%', borderRadius: 16 }} />
                ) : (
                  <Ionicons name="person" size={16} color="#94A3B8" />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.modalPassengerName}>{displayPassengerName}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Ionicons name="star" size={12} color="#EAB308" />
                  <Text style={styles.modalPassengerRating}>{incomingRide?.passengerRating?.toFixed(1) || '5.0'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.routeTimelineContainer}>
              <View style={styles.timelineRow}>
                <Ionicons name="location" size={16} color="#10B981" />
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineLabel}>BUSCAR EM:</Text>
                  <Text style={styles.timelineAddress} numberOfLines={2}>{incomingRide?.originAddress || 'Local de origem'}</Text>
                </View>
              </View>

              <View style={styles.timelineRow}>
                <Ionicons name="flag" size={16} color="#EF4444" />
                <View style={styles.timelineTextContainer}>
                  <Text style={[styles.timelineLabel, { color: '#EF4444' }]}>LEVAR PARA:</Text>
                  <Text style={styles.timelineAddress} numberOfLines={2}>{incomingRide?.destinationAddress || 'Endereço de destino'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.newRequestActions}>
              <TouchableOpacity 
                style={styles.rejectBtn} 
                onPress={() => { Vibration.cancel(); setIncomingRide(null); }} 
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
                  if (incomingRide?.rideId && driver?.id) {
                    const lat = Number(location?.coords?.latitude || BISSAU_CENTER_LAT);
                    const lng = Number(location?.coords?.longitude || BISSAU_CENTER_LNG);
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

      {/* CHAT INTERNO */}
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

      {/* MODAL RECIBO */}
      <Modal visible={showReceiptModal} transparent animationType="slide">
        <View style={styles.receiptOverlay}>
          <View style={[
            styles.receiptCard,
            { paddingBottom: Math.max((insets?.bottom || 0) + 20, Platform.OS === 'android' ? 32 : 20) }
          ]}>
            <Text style={styles.receiptHeader}>✅ Serviço Concluído</Text>
            <Text style={styles.receiptSub}>Obrigado por mais um serviço finalizado com sucesso.</Text>
            <View style={styles.divider} />
            <Text style={styles.receiptLabel}>Total Ganho:</Text>
            <Text style={styles.receiptAmount}>
              {(completedInfo?.fareXOF || 0).toLocaleString('pt-BR')} XOF
            </Text>
            <Text style={styles.receiptDist}>ID da Transação: {completedInfo?.transactionId || 'N/A'}</Text>
            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity style={styles.closeReceiptBtn} onPress={() => { setShowReceiptModal(false); setShowRatingModal(true); }} activeOpacity={0.85}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  carMarkerContainer: { backgroundColor: '#EAB308', padding: 8, borderRadius: 20, borderWidth: 2, borderColor: '#0F172A', elevation: 4 },
  markerPickup: { backgroundColor: '#10B981', padding: 8, borderRadius: 20, borderWidth: 2, borderColor: '#0F172A' },
  markerDestination: { backgroundColor: '#EF4444', padding: 8, borderRadius: 20, borderWidth: 2, borderColor: '#0F172A' },
  
  headerContainer: { position: 'absolute', left: 16, right: 16, zIndex: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, elevation: 6 },
  pillOnline: { backgroundColor: '#EAB308', borderColor: '#EAB308' },
  pillOffline: { backgroundColor: '#1E293B', borderColor: '#334155' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotGreen: { backgroundColor: '#0F172A' },
  dotRed: { backgroundColor: '#EF4444' },
  statusPillText: { fontSize: 13, fontWeight: '800' },
  earningsPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155', gap: 6, elevation: 6 },
  earningsPillText: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  filterPill: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155', elevation: 6 },
  profilePill: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155', elevation: 6, overflow: 'hidden' },
  headerProfileImage: { width: '100%', height: '100%' },
  lowBatteryBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, marginTop: 8, gap: 6 },
  lowBatteryText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  floatingButtonsWrapper: { position: 'absolute', right: 16, bottom: 230, zIndex: 9, alignItems: 'flex-end', gap: 10 },
  recenterButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#334155', elevation: 6 },
  sosButton: { backgroundColor: '#EF4444', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, elevation: 6 },
  sosText: { color: '#FFF', fontWeight: '900', fontSize: 12 },
  audioRecordButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#334155', gap: 6 },
  audioRecordButtonActive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  audioRecordText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  bottomSheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  bottomSheet: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    minHeight: 180,
    maxHeight: Dimensions.get('window').height * 0.78,
  },
  dragHandleArea: { width: '100%', alignItems: 'center', paddingVertical: 10 },
  dragHandle: { width: 40, height: 5, backgroundColor: '#475569', borderRadius: 3, marginBottom: 4 },
  dragHintText: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },

  idleContainer: { alignItems: 'center', paddingVertical: 14 },
  idleTitle: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  idleSub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  goOnlineBtn: { backgroundColor: '#EAB308', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, width: '100%', alignItems: 'center' },
  goOnlineText: { color: '#0F172A', fontWeight: '800', fontSize: 15 },

  activeRideContainer: { gap: 12 },
  compactHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  serviceBadgeRow: { flexDirection: 'row', gap: 6 },
  serviceTypeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6 },
  serviceTypeBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  priceBadgeContainer: { backgroundColor: 'rgba(234, 179, 8, 0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#EAB308' },
  priceBadgeText: { color: '#EAB308', fontWeight: '900', fontSize: 15 },

  etaHeader: { gap: 4 },
  rideStateTitle: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  waitTimerBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitTimerText: { color: '#EAB308', fontSize: 13, fontWeight: '700' },

  passengerProfileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#334155' },
  passengerPhotoContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  passengerPhoto: { width: '100%', height: '100%' },
  passengerDetails: { flex: 1, marginLeft: 12 },
  passengerName: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { color: '#EAB308', fontSize: 12, fontWeight: '700' },
  callIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EAB308', alignItems: 'center', justifyContent: 'center' },

  routeAddressesContainer: { backgroundColor: '#0F172A', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#334155', gap: 10 },
  addressItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addressTextWrapper: { flex: 1 },
  addressLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '700', textTransform: 'uppercase' },
  addressValue: { fontSize: 13, color: '#FFF', fontWeight: '600' },

  deliveryDetailsCard: { backgroundColor: '#0F172A', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#3B82F6', gap: 4 },
  deliveryDetailsTitle: { color: '#3B82F6', fontWeight: '800', fontSize: 13 },
  deliveryDetailsText: { color: '#FFF', fontSize: 13 },
  deliveryNotes: { color: '#94A3B8', fontSize: 12, italic: true },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionButtonSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155', gap: 6 },
  actionButtonSecondaryText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  noShowBtnDanger: { backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  noShowBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  cancelButtonDanger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#EF4444', gap: 4 },
  cancelButtonText: { color: '#EF4444', fontWeight: '700', fontSize: 12 },

  actionBtnPrimary: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4, elevation: 4 },
  actionBtnText: { color: '#FFF', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },

  filterModalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.75)', justifyContent: 'flex-end' },
  filterModalCard: { backgroundColor: '#1E293B', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderWidth: 1, borderColor: '#334155' },
  filterModalTitle: { fontSize: 18, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  filterModalSub: { fontSize: 13, color: '#94A3B8', marginBottom: 16 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  filterLabelContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterLabelText: { fontSize: 14, color: '#FFF', fontWeight: '600' },
  closeFilterBtn: { backgroundColor: '#EAB308', paddingVertical: 14, borderRadius: 16, alignItems: 'center', marginTop: 20 },
  closeFilterText: { color: '#0F172A', fontWeight: '800', fontSize: 14 },

  newRequestOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'center', padding: 20 },
  newRequestCard: { backgroundColor: '#1E293B', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#EAB308' },
  newRequestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  newRequestTitle: { fontSize: 18, fontWeight: '800', color: '#FFF' },
  newRequestPriceBadge: { backgroundColor: '#EAB308', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  newRequestPriceText: { color: '#0F172A', fontWeight: '900', fontSize: 15 },
  progressBarContainer: { height: 6, backgroundColor: '#0F172A', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: '100%', backgroundColor: '#EAB308' },
  timerText: { fontSize: 12, color: '#94A3B8', fontWeight: '700', textAlign: 'right', marginBottom: 14 },
  modalPassengerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', padding: 12, borderRadius: 16, marginBottom: 14 },
  passengerPhotoContainerSm: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' },
  modalPassengerName: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  modalPassengerRating: { color: '#EAB308', fontSize: 12, fontWeight: '700', marginLeft: 4 },
  routeTimelineContainer: { backgroundColor: '#0F172A', padding: 12, borderRadius: 16, gap: 12, marginBottom: 20 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  timelineTextContainer: { flex: 1 },
  timelineLabel: { fontSize: 10, color: '#10B981', fontWeight: '800' },
  timelineAddress: { fontSize: 13, color: '#FFF', fontWeight: '600', marginTop: 2 },
  newRequestActions: { flexDirection: 'row', gap: 10 },
  rejectBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#0F172A', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  rejectText: { color: '#94A3B8', fontWeight: '800', fontSize: 14 },
  acceptBtn: { flex: 1.5, paddingVertical: 14, borderRadius: 14, backgroundColor: '#EAB308', alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#0F172A', fontWeight: '900', fontSize: 14 },

  receiptOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', justifyContent: 'flex-end' },
  receiptCard: { backgroundColor: '#1E293B', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, alignItems: 'center' },
  receiptHeader: { fontSize: 20, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  receiptSub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginBottom: 16 },
  divider: { height: 1, backgroundColor: '#334155', width: '100%', marginBottom: 16 },
  receiptLabel: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
  receiptAmount: { fontSize: 28, fontWeight: '900', color: '#10B981', marginVertical: 4 },
  receiptDist: { fontSize: 12, color: '#64748B', marginBottom: 20 },
  closeReceiptBtn: { backgroundColor: '#EAB308', paddingVertical: 14, borderRadius: 16, width: '100%', alignItems: 'center' },
  closeReceiptText: { color: '#0F172A', fontWeight: '800', fontSize: 15 },
});