import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, Alert, 
  FlatList, Platform, StatusBar, BackHandler, Linking, 
  Share, AppState, KeyboardAvoidingView, Modal, TextInput, 
  ActivityIndicator, Image, Animated, PanResponder, Dimensions, ScrollView, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { initiateMobileMoneyPayment } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { 
  socket, 
  connectPassengerSocket, 
  requestRide as emitRequestRide,  
  cancelRideByPassenger, 
  rateDriver, 
  sendChatMessage 
} from '../services/passengerSocket';
import { CancelModal } from '../components/CancelModal';
import { RatingModal } from '../components/RatingModal';

// Token Mapbox
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_KEY || 'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZTRyc3NmMDBzMTJ5cTA1anJvYjFsOSJ9.pUAoGXwZS8FtYNr85VD1TA';
if (MAPBOX_ACCESS_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
}

const STORAGE_RIDE_KEY = '@bai245:active_ride_state';
const STORAGE_FAVORITES_KEY = '@bai245:favorite_places';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const BISSAU_CENTER = { latitude: 11.8636, longitude: -15.5977 };
const BISSAU_BBOX = '-15.75,11.70,-15.40,12.05';

type RideStatus = 'idle' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed';
type BookingStep = 'ADDRESS' | 'SERVICE_AND_PRICE' | 'PAYMENT' | 'SEARCHING';
type VehicleType = 'moto' | 'taxi' | 'moto-carro' | 'particular';
type ServiceType = 'viagem' | 'entrega' | 'aluguel';
type PaymentMethod = 'ORANGE_MONEY' | 'MTN_MOMO' | 'CASH';
type RegionType = 'BISSAU' | 'PRABIS' | 'QUINHAMEL' | 'SURU' | 'BAFATA' | 'GABU';

interface FavoritePlace {
  address: string;
  latitude: number;
  longitude: number;
}

interface ChatMessage { 
  id: string; 
  sender: 'passenger' | 'driver'; 
  text: string; 
  senderPhoto?: string;
}

interface DriverInfo { 
  id: string; 
  name: string; 
  photoUrl?: string; 
  profilePicture?: string;
  carModel?: string; 
  carColor?: string;
  vehicleType?: string; 
  licensePlate?: string; 
  rating?: number; 
  phone?: string; 
  startOtp?: string;
}

interface MapboxGeocodingFeature {
  id: string;
  description: string;
  latitude: number;
  longitude: number;
  isLocalBairro?: boolean;
}

// Catálogo ampliado e preciso de Bairros, Setores e Pontos de Referência de Guiné-Bissau
const GUINEA_BISSAU_BAIRROS: MapboxGeocodingFeature[] = [
  { id: 'b_bandim_1', description: 'Bandim 1, Bissau', latitude: 11.8580, longitude: -15.5800, isLocalBairro: true },
  { id: 'b_bandim_2', description: 'Bandim 2, Bissau', latitude: 11.8595, longitude: -15.5785, isLocalBairro: true },
  { id: 'b_militar', description: 'Bairro Militar, Bissau', latitude: 11.8750, longitude: -15.6100, isLocalBairro: true },
  { id: 'b_cupelum_cima', description: 'Cupelum de Cima, Bissau', latitude: 11.8680, longitude: -15.6020, isLocalBairro: true },
  { id: 'b_cupelum_baixo', description: 'Cupelum de Baixo, Bissau', latitude: 11.8660, longitude: -15.6050, isLocalBairro: true },
  { id: 'b_pessaque', description: 'Pessaque, Bissau', latitude: 11.8620, longitude: -15.5900, isLocalBairro: true },
  { id: 'b_mindara', description: 'Mindará, Bissau', latitude: 11.8650, longitude: -15.5850, isLocalBairro: true },
  { id: 'b_sintra', description: 'Sintra, Bissau', latitude: 11.8590, longitude: -15.5920, isLocalBairro: true },
  { id: 'b_enterramentos', description: 'Enterramentos, Bissau', latitude: 11.8710, longitude: -15.5980, isLocalBairro: true },
  { id: 'b_cuntum_1', description: 'Cuntum 1, Bissau', latitude: 11.8690, longitude: -15.5780, isLocalBairro: true },
  { id: 'b_cuntum_2', description: 'Cuntum 2, Bissau', latitude: 11.8710, longitude: -15.5740, isLocalBairro: true },
  { id: 'b_santaluzia', description: 'Santa Luzia, Bissau', latitude: 11.8720, longitude: -15.5890, isLocalBairro: true },
  { id: 'b_quelele', description: 'Quelelé, Bissau', latitude: 11.8810, longitude: -15.6010, isLocalBairro: true },
  { id: 'b_plaquinte', description: 'Plaquinté, Bissau', latitude: 11.8760, longitude: -15.5880, isLocalBairro: true },
  { id: 'b_antula_bono', description: 'Antula Bono, Bissau', latitude: 11.8880, longitude: -15.5820, isLocalBairro: true },
  { id: 'b_antula_aberte', description: 'Antula Aberte, Bissau', latitude: 11.8910, longitude: -15.5790, isLocalBairro: true },
  { id: 'b_luanda', description: 'Bairro Luanda, Bissau', latitude: 11.8730, longitude: -15.6060, isLocalBairro: true },
  { id: 'b_bor', description: 'Bor, Bissau', latitude: 11.8950, longitude: -15.5910, isLocalBairro: true },
  { id: 'b_bra', description: 'Brá, Bissau', latitude: 11.8800, longitude: -15.5700, isLocalBairro: true },
  { id: 'b_chao_pepel', description: 'Chão de Pepel, Bissau', latitude: 11.8640, longitude: -15.6080, isLocalBairro: true },
  { id: 'b_praca_herois', description: 'Praça dos Heróis Nacionais (Império), Bissau', latitude: 11.8600, longitude: -15.5830, isLocalBairro: true },
  { id: 'b_ajuda', description: 'Bairro de Ajuda, Bissau', latitude: 11.8670, longitude: -15.6130, isLocalBairro: true },
  { id: 'b_belem', description: 'Bairro de Belém, Bissau', latitude: 11.8610, longitude: -15.6010, isLocalBairro: true },
  { id: 'b_penha', description: 'Penha, Bissau', latitude: 11.8780, longitude: -15.6170, isLocalBairro: true },
  { id: 'b_alto_bandim', description: 'Alto Bandim, Bissau', latitude: 11.8540, longitude: -15.5760, isLocalBairro: true },
  { id: 'b_gamboa', description: 'Gamboa, Bissau', latitude: 11.8520, longitude: -15.5870, isLocalBairro: true },
  { id: 'b_hafia', description: 'Hafia, Bissau', latitude: 11.8665, longitude: -15.5960, isLocalBairro: true },
  { id: 'b_cassaca', description: 'Cassaca, Bissau', latitude: 11.8630, longitude: -15.5880, isLocalBairro: true },
  { id: 'b_rossio', description: 'Rossio / Centro da Cidade, Bissau', latitude: 11.8585, longitude: -15.5840, isLocalBairro: true },
  { id: 'p_aeroporto', description: 'Aeroporto Internacional Osvaldo Vieira, Bissau', latitude: 11.8900, longitude: -15.6530, isLocalBairro: true },
  { id: 'p_hospital_simao', description: 'Hospital Nacional Simão Mendes, Bissau', latitude: 11.8615, longitude: -15.5865, isLocalBairro: true },
  { id: 'p_porto_bissau', description: 'Porto de Bissau (Pidjiguiti), Bissau', latitude: 11.8530, longitude: -15.5820, isLocalBairro: true },
  { id: 'p_mercado_caracol', description: 'Mercado de Caracol, Bissau', latitude: 11.8715, longitude: -15.6040, isLocalBairro: true },
  { id: 'p_mercado_bandim', description: 'Mercado de Bandim, Bissau', latitude: 11.8575, longitude: -15.5790, isLocalBairro: true },
  { id: 'r_safim', description: 'Safim', latitude: 11.9540, longitude: -15.6510, isLocalBairro: true },
  { id: 'r_prabis', description: 'Prabis', latitude: 11.8020, longitude: -15.7390, isLocalBairro: true },
  { id: 'r_quinhamel', description: 'Quinhamel', latitude: 11.8840, longitude: -15.8450, isLocalBairro: true },
  { id: 'r_cumura', description: 'Cumura', latitude: 11.8210, longitude: -15.6620, isLocalBairro: true },
];

const LANGUAGES = [
  { code: 'pt', label: 'Português 🇵🇹' },
  { code: 'cri', label: 'Crioulo (Guiné-Bissau) 🇬🇼' },
  { code: 'fr', label: 'Français 🇫🇷' },
  { code: 'en', label: 'English 🇺🇸' },
  { code: 'es', label: 'Español 🇪🇸' },
  { code: 'ru', label: 'Русский 🇷🇺' },
];

const formatPhotoUrl = (path?: string) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

function calculateVehiclePrice(type: VehicleType, distanceKm: number | null): number | null {
  if (distanceKm === null || distanceKm <= 0 || isNaN(distanceKm) || !isFinite(distanceKm)) return null;

  const VEHICLE_RATES: Record<VehicleType, { base: number; perKm: number }> = {
    moto: { base: 300, perKm: 150 },
    'moto-carro': { base: 400, perKm: 180 },
    taxi: { base: 500, perKm: 220 },
    particular: { base: 600, perKm: 250 },
  };

  const rate = VEHICLE_RATES[type] || VEHICLE_RATES.particular;
  const calculatedPrice = rate.base + (distanceKm * rate.perKm);
  return Math.round(calculatedPrice / 50) * 50;
}

const getVehicleIcon = (type?: string) => {
  if (!type) return 'car';
  const cleanType = type.toLowerCase().replace('-', '_').trim();
  if (cleanType.includes('moto') && !cleanType.includes('carro')) return 'motorbike';
  if (cleanType.includes('moto_carro') || cleanType.includes('motocarro')) return 'rickshaw';
  if (cleanType.includes('taxi')) return 'taxi';
  return 'car';
};

const getVehicleColorHex = (colorName?: string) => {
  if (!colorName) return '#0F172A';
  if (colorName.startsWith('#')) return colorName;
  const c = colorName.toLowerCase().trim();
  
  if (c.includes('vermelh') || c.includes('vinho') || c.includes('red')) return '#EF4444';
  if (c.includes('pret') || c.includes('black')) return '#18181B';
  if (c.includes('branc') || c.includes('white')) return '#FFFFFF';
  if (c.includes('prat') || c.includes('cinza') || c.includes('silver') || c.includes('grey')) return '#94A3B8';
  if (c.includes('amarel') || c.includes('yellow')) return '#EAB308';
  if (c.includes('azul') || c.includes('blue')) return '#2563EB';
  if (c.includes('verd') || c.includes('green')) return '#16A34A';
  if (c.includes('laranj') || c.includes('orange')) return '#EA580C';
  if (c.includes('marrom') || c.includes('brown')) return '#78350F';
  
  return '#0F172A';
};

const getHaversineDistance = (p1: any, p2: any) => {
  if (!p1?.latitude || !p1?.longitude || !p2?.latitude || !p2?.longitude) return 0;
  const R = 6371; 
  const dLat = (p2.latitude - p1.latitude) * (Math.PI / 180);
  const dLon = (p2.longitude - p1.longitude) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
    Math.cos(p1.latitude * (Math.PI / 180)) * Math.cos(p2.latitude * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const safeA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));
  const dist = R * c * 1.3;
  return isNaN(dist) ? 0 : dist; 
};

// Identifica o bairro mais próximo em Bissau para evitar o texto genérico "Guiné Bissau"
const findNearestLocalBairro = (lat: number, lng: number) => {
  let minDistance = Infinity;
  let nearest: MapboxGeocodingFeature | null = null;
  for (const bairro of GUINEA_BISSAU_BAIRROS) {
    const dist = getHaversineDistance({ latitude: lat, longitude: lng }, { latitude: bairro.latitude, longitude: bairro.longitude });
    if (dist < minDistance) {
      minDistance = dist;
      nearest = bairro;
    }
  }
  if (nearest && minDistance <= 2.5) {
    return nearest.description;
  }
  return null;
};

export function Home() {
  const { user, signOut } = useAuth();
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const isMountedRef = useRef(true);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const chatFlatListRef = useRef<FlatList>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRideIdRef = useRef<string | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const isInaccessibleAlertShowingRef = useRef(false);
  const isManualPickupRef = useRef(false);
  const route = useRoute<any>();

  const [bookingStep, setBookingStep] = useState<BookingStep>('ADDRESS');
  const [rideStatus, setRideStatus] = useState<RideStatus>('idle');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [startOtp, setStartOtp] = useState<string>('');
  const [acceptedAt, setAcceptedAt] = useState<Date | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [passengerLocation, setPassengerLocation] = useState<Location.LocationObject | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number; heading?: number } | null>(null);
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  
  const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState(t('pickup_location', 'Local de partida'));
  
  const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState('');
  
  // MÚLTIPLAS PARADAS
  const [extraStopCoords, setExtraStopCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [extraStopAddress, setExtraStopAddress] = useState('');
  const [showExtraStop, setShowExtraStop] = useState(false);

  // CORRIDA PARA TERCEIROS
  const [isForAnotherPerson, setIsForAnotherPerson] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [isGuestModalVisible, setIsGuestModalVisible] = useState(false);

  const [referencePoint, setReferencePoint] = useState('');
  const [driverEta, setDriverEta] = useState<number | null>(null);

  const [vehicleType, setVehicleType] = useState<VehicleType>('particular');
  const [serviceType, setServiceType] = useState<ServiceType>('viagem');
  const [selectedRegion] = useState<RegionType>('BISSAU');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ORANGE_MONEY');
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
  const [searchType, setSearchType] = useState<'pickup' | 'dropoff' | 'extraStop'>('dropoff');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MapboxGeocodingFeature[]>([]);
  const [isSearchingMapbox, setIsSearchingMapbox] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');

  const [homeLocation, setHomeLocation] = useState<FavoritePlace | null>(null);
  const [workLocation, setWorkLocation] = useState<FavoritePlace | null>(null);
  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);
  const [paymentPhone, setPaymentPhone] = useState((user as any)?.phone || '955000000');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const [, setIsConnected] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocationSettingsVisible, setIsLocationSettingsVisible] = useState(false);
  const [langModalVisible, setLangModalVisible] = useState(false);

  const [routeGeometry, setRouteGeometry] = useState<any>(null);

  const VEHICLE_OPTIONS = [
    { id: 'moto' as VehicleType, title: 'Moto', subtitle: t('moto_subtitle', 'Rápido e econômico'), image: require('../assets/vehicles/moto.png') },
    { id: 'particular' as VehicleType, title: t('standard_vehicle', 'Particular'), subtitle: t('particular_subtitle', 'Viagem exclusiva'), image: require('../assets/vehicles/carro_white.png') },
    { id: 'taxi' as VehicleType, title: 'Táxi', subtitle: t('taxi_subtitle', 'Conforto e tradição'), image: require('../assets/vehicles/taxi_yellow.png') },
    { id: 'moto-carro' as VehicleType, title: 'Moto-carro', subtitle: t('motocarro_subtitle', 'Ideal para bagagens leves'), image: require('../assets/vehicles/motocarro.jpg') },
  ];

  const RENTAL_PRICES: Record<RegionType, { price: number | null; label: string; description: string }> = {
    BISSAU: { price: 13000, label: 'Bissau (Setor Autónomo)', description: t('bissau_rental_desc', 'Diária completa dentro da região de Bissau') },
    PRABIS: { price: null, label: 'Prabis', description: t('on_request', 'Preço sob consulta prévia') },
    QUINHAMEL: { price: null, label: 'Quinhamel', description: t('on_request', 'Preço sob consulta prévia') },
    SURU: { price: null, label: 'Suru / Varela', description: t('on_request', 'Preço sob consulta prévia') },
    BAFATA: { price: null, label: 'Bafatá / Gabú', description: t('on_request', 'Preço sob consulta prévia') },
    GABU: { price: null, label: 'Bafatá / Gabú', description: t('on_request', 'Preço sob consulta prévia') },
  };

  const changeLanguage = useCallback((code: string) => {
    i18n.changeLanguage(code);
    setLangModalVisible(false);
  }, [i18n]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0 || gestureState.dy > -150) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80) {
          Animated.spring(translateY, { toValue: 120, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const calculateEstimate = useCallback((pickup: any, dropoff: any, extra?: any) => {
    if (
      typeof pickup?.latitude !== 'number' || typeof pickup?.longitude !== 'number' ||
      typeof dropoff?.latitude !== 'number' || typeof dropoff?.longitude !== 'number'
    ) return;

    let totalDist = getHaversineDistance(pickup, extra || dropoff);
    if (extra && typeof extra.latitude === 'number' && typeof extra.longitude === 'number') {
      totalDist += getHaversineDistance(extra, dropoff);
    }

    if (isNaN(totalDist) || totalDist <= 0 || totalDist > 1500) return;

    if (isMountedRef.current) {
      setEstimatedDistance(totalDist);
      setEstimatedPrice(calculateVehiclePrice(vehicleType, totalDist));
    }
  }, [vehicleType]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      translateY.stopAnimation();
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [translateY]);

  useEffect(() => {
    activeRideIdRef.current = activeRideId;
  }, [activeRideId]);

  useEffect(() => {
    if ((user as any)?.phone) {
      setPaymentPhone((user as any).phone);
    }
  }, [user]);

  const isNightTimeForPin = useCallback(() => {
    const currentHour = new Date().getHours();
    return currentHour >= 18 || currentHour < 6;
  }, []);

  const persistRideState = async (rideId: string | null, status: RideStatus) => {
    try {
      if (rideId && status !== 'idle' && status !== 'completed') {
        await AsyncStorage.setItem(STORAGE_RIDE_KEY, JSON.stringify({ rideId, status }));
      } else {
        await AsyncStorage.removeItem(STORAGE_RIDE_KEY);
      }
    } catch (e) {
      console.error('Erro ao salvar estado local:', e);
    }
  };

  const fitMapBounds = useCallback((coordsArray: Array<{ latitude: number; longitude: number }>) => {
    if (!cameraRef.current || !coordsArray || coordsArray.length < 2) return;
    
    const validCoords = coordsArray.filter(
      c => c && typeof c.latitude === 'number' && typeof c.longitude === 'number' && !isNaN(c.latitude) && !isNaN(c.longitude)
    );
    if (validCoords.length < 2) return;

    const lats = validCoords.map(c => c.latitude);
    const lngs = validCoords.map(c => c.longitude);
    
    const ne = [Math.max(...lngs), Math.max(...lats)];
    const sw = [Math.min(...lngs), Math.min(...lats)];

    try {
      cameraRef.current.fitBounds(ne, sw, [120, 60, 360, 60], 1000);
    } catch (err) {
      console.warn('Erro ao ajustar enquadramento do mapa Mapbox:', err);
    }
  }, []);

  const fetchMapboxRoute = useCallback(async (
    origin: { latitude: number; longitude: number }, 
    destination: { latitude: number; longitude: number }, 
    extra?: { latitude: number; longitude: number } | null
  ) => {
    if (!MAPBOX_ACCESS_TOKEN) return;

    if (isNaN(origin.latitude) || isNaN(origin.longitude) || isNaN(destination.latitude) || isNaN(destination.longitude)) {
      console.warn('Coordenadas inválidas fornecidas para rota.');
      return;
    }

    try {
      let coordinatesString = `${origin.longitude},${origin.latitude}`;
      if (extra && !isNaN(extra.latitude) && !isNaN(extra.longitude)) {
        coordinatesString += `;${extra.longitude},${extra.latitude}`;
      }
      coordinatesString += `;${destination.longitude},${destination.latitude}`;

      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesString}?geometries=geojson&overview=full&access_token=${MAPBOX_ACCESS_TOKEN}`;
      const res = await fetch(url);
      
      if (!res.ok) return;

      const data = await res.json();
      
      if (data.routes && data.routes.length > 0 && isMountedRef.current) {
        const route = data.routes[0];
        
        setRouteGeometry({
          type: 'Feature',
          properties: {},
          geometry: route.geometry,
        });

        const distanceKm = route.distance / 1000;
        const durationMin = Math.ceil(route.duration / 60);

        setDriverEta(durationMin);
        if (rideStatus === 'idle' || rideStatus === 'searching') {
          setEstimatedDistance(distanceKm);
          setEstimatedPrice(calculateVehiclePrice(vehicleType, distanceKm));
        }
      }
    } catch (error) {
      console.warn('Erro ao buscar rota no Mapbox:', error);
    }
  }, [rideStatus, vehicleType]);

  const handleMapboxSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text || text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const normalizedQuery = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const localMatches = GUINEA_BISSAU_BAIRROS.filter(item => {
      const normDesc = item.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return normDesc.includes(normalizedQuery);
    });

    setIsSearchingMapbox(true);

    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?country=gw&bbox=${BISSAU_BBOX}&proximity=${BISSAU_CENTER.longitude},${BISSAU_CENTER.latitude}&types=neighborhood,locality,place,address,poi&autocomplete=true&language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;
      const res = await fetch(url);

      let apiResults: MapboxGeocodingFeature[] = [];

      if (res.ok) {
        const data = await res.json();
        if (data?.features && Array.isArray(data.features)) {
          apiResults = data.features.map((f: any) => ({
            id: f.id,
            description: f.place_name,
            longitude: f.center[0],
            latitude: f.center[1],
            isLocalBairro: false,
          }));
        }
      }

      if (isMountedRef.current) {
        const combined = [...localMatches, ...apiResults];
        const uniqueResults = combined.filter((v, i, a) => a.findIndex(t => t.description.toLowerCase() === v.description.toLowerCase()) === i);
        setSearchResults(uniqueResults);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setSearchResults(localMatches);
      }
    } finally {
      if (isMountedRef.current) {
        setIsSearchingMapbox(false);
      }
    }
  };

  const getCurrentLocationWithFallback = useCallback(async () => {
    try {
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        if (isMountedRef.current) {
          setIsLocationSettingsVisible(true);
          setLocationError(t('gps_disabled_msg', 'O serviço de localização (GPS) está desativado no aparelho.'));
        }
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (isMountedRef.current) {
          setIsLocationSettingsVisible(true);
          setLocationError(t('gps_permission_denied', 'Permissão de localização negada pelo usuário.'));
        }
        return;
      }

      if (isMountedRef.current) {
        setIsLocationSettingsVisible(false);
        setLocationError(null);
      }

      let location;
      try {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      } catch (err) {
        location = await Location.getLastKnownPositionAsync();
        if (!location) {
          location = {
            coords: {
              latitude: BISSAU_CENTER.latitude,
              longitude: BISSAU_CENTER.longitude,
              altitude: 0, accuracy: 0, altitudeAccuracy: 0, heading: 0, speed: 0
            },
            timestamp: Date.now()
          } as Location.LocationObject;
        }
      }

      if (!isMountedRef.current || !location) return;

      setPassengerLocation(location);
      setPickupCoords({ latitude: location.coords.latitude, longitude: location.coords.longitude });

      const localName = findNearestLocalBairro(location.coords.latitude, location.coords.longitude);
      if (localName) {
        setPickupAddress(localName);
      } else if (MAPBOX_ACCESS_TOKEN && isMountedRef.current) {
        try {
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${location.coords.longitude},${location.coords.latitude}.json?language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data?.features?.length > 0 && isMountedRef.current) {
              const placeName = data.features[0].place_name || '';
              const parts = placeName.split(',')
                .map((p: string) => p.trim())
                .filter((p: string) => p && !p.toLowerCase().includes('guiné'));
              const cleanAddress = parts.length > 0 ? parts.slice(0, 2).join(', ') : 'Bissau, Centro';
              setPickupAddress(cleanAddress);
            }
          }
        } catch (gErr) {
          console.warn('Geocodificação reversa falhou:', gErr);
          setPickupAddress('Bissau, Centro');
        }
      }
    } catch (error) {
      if (isMountedRef.current) {
        setIsLocationSettingsVisible(true);
        setLocationError(t('getting_location_error', 'Não foi possível obter a localização exata.'));
      }
    }
  }, [t]);

  const handleInaccessibleLocationAlert = useCallback((data: any) => {
    if (isInaccessibleAlertShowingRef.current) return;
    isInaccessibleAlertShowingRef.current = true;

    Alert.alert(
      data?.title || t('warning_title', 'Atenção ⚠️'), 
      data?.message || t('inaccessible_location_msg', 'O motorista pediu para você se aproximar, pois o local é de difícil acesso.'),
      [
        {
          text: 'OK',
          onPress: () => {
            isInaccessibleAlertShowingRef.current = false;
          }
        }
      ],
      {
        cancelable: false,
        onDismiss: () => {
          isInaccessibleAlertShowingRef.current = false;
        }
      }
    );
  }, [t]);

  useEffect(() => {
    async function loadFavorites() {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_FAVORITES_KEY);
        if (saved && isMountedRef.current) {
          const { home, work } = JSON.parse(saved);
          if (home) setHomeLocation(home);
          if (work) setWorkLocation(work);
        }
      } catch (e) {
        console.error('Erro ao carregar favoritos:', e);
      }
    }
    loadFavorites();
  }, []);

  const handleFavoritePress = (type: 'home' | 'work') => {
    const favorite = type === 'home' ? homeLocation : workLocation;
    if (favorite && typeof favorite.latitude === 'number' && typeof favorite.longitude === 'number') {
      setDropoffAddress(favorite.address);
      setDropoffCoords({ latitude: favorite.latitude, longitude: favorite.longitude });
      setBookingStep('SERVICE_AND_PRICE');
    } else {
      setSearchType('dropoff');
      setIsSearchModalVisible(true);
    }
  };

  useEffect(() => {
    const onBackPress = () => {
      if (isMenuVisible) { setIsMenuVisible(false); return true; }
      if (isChatVisible) { setIsChatVisible(false); return true; }
      if (isSearchModalVisible) { setIsSearchModalVisible(false); return true; }
      if (showCancelModal) { setShowCancelModal(false); return true; }
      if (showRatingModal) { setShowRatingModal(false); return true; }

      if (rideStatus === 'idle') {
        if (bookingStep === 'PAYMENT') { setBookingStep('SERVICE_AND_PRICE'); return true; }
        if (bookingStep === 'SERVICE_AND_PRICE') { setBookingStep('ADDRESS'); return true; }
      }
      return false;
    };

    const backHandlerSubscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandlerSubscription.remove();
  }, [isMenuVisible, isChatVisible, isSearchModalVisible, showCancelModal, showRatingModal, bookingStep, rideStatus]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        getCurrentLocationWithFallback();
        
        if (!socket.connected) {
          connectPassengerSocket();
        } else {
          socket.emit('passenger:request_state');
        }
      }
    });
    return () => subscription.remove();
  }, [getCurrentLocationWithFallback]);

  const resetRideState = useCallback(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    persistRideState(null, 'idle');
    setRideStatus('idle');
    setBookingStep('ADDRESS');
    setActiveRideId(null);
    activeRideIdRef.current = null;
    setDriverLocation(null);
    setDriverInfo(null);
    setStartOtp('');
    setAcceptedAt(null);
    setDropoffAddress('');
    setDropoffCoords(null);
    setExtraStopAddress('');
    setExtraStopCoords(null);
    setShowExtraStop(false);
    setIsForAnotherPerson(false);
    setReferencePoint('');
    setMessages([]); 
    setDriverEta(null);
    setRouteGeometry(null);
    isManualPickupRef.current = false;
  }, []);

  useEffect(() => {
    async function initAppAndPermissions() {
      await getCurrentLocationWithFallback();
      try {
        const savedState = await AsyncStorage.getItem(STORAGE_RIDE_KEY);
        if (savedState && isMountedRef.current) {
          const { rideId, status: savedStatus } = JSON.parse(savedState);
          setActiveRideId(rideId);
          setRideStatus(savedStatus);
        }
      } catch (err) {
        console.error('Erro ao recuperar corrida salva:', err);
      }
    }

    initAppAndPermissions();
    connectPassengerSocket();

    const handleConnect = () => {
      if (isMountedRef.current) setIsConnected(true);
      socket.emit('passenger:request_state');
    };

    const handleDisconnect = () => {
      if (isMountedRef.current) setIsConnected(false);
    };

    const handleStateRecovered = async (data: any) => {
      if (!isMountedRef.current || !data) return;
      try {
        if (!data?.hasActiveRide) {
          setRideStatus((currentStatus) => {
            if (currentStatus === 'searching') return 'searching';
            return 'idle';
          });

          await persistRideState(null, 'idle');
          setActiveRideId(null);
          return;
        }

        if (data?.hasActiveRide && data?.ride) {
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
          setActiveRideId(data.ride.id);

          if (typeof data.ride.originLat === 'number' && typeof data.ride.originLng === 'number') {
            const lat = Number(data.ride.originLat);
            const lng = Number(data.ride.originLng);
            if (!isNaN(lat) && !isNaN(lng)) setPickupCoords({ latitude: lat, longitude: lng });
            if (data.ride.originAddress) setPickupAddress(data.ride.originAddress);
          }

          if (typeof data.ride.destinationLat === 'number' && typeof data.ride.destinationLng === 'number') {
            const lat = Number(data.ride.destinationLat);
            const lng = Number(data.ride.destinationLng);
            if (!isNaN(lat) && !isNaN(lng)) setDropoffCoords({ latitude: lat, longitude: lng });
            if (data.ride.destinationAddress) setDropoffAddress(data.ride.destinationAddress);
          }
          
          if (data.ride.driverId) {
            const otpCode = String(data.ride.startOtp || data.ride.otpPin || data.ride.pin || '');
            setStartOtp(otpCode);
            setDriverInfo({ 
              id: data.ride.driverId, 
              name: data.ride.driverName || 'Motorista',
              photoUrl: formatPhotoUrl(data.ride.driverPhoto), 
              profilePicture: formatPhotoUrl(data.ride.driverPhoto),
              carModel: data.ride.carModel || data.ride.vehicleModel || t('standard_vehicle', 'Veículo Padrão'),
              carColor: data.ride.carColor || data.ride.vehicleColor || t('color_not_specified', 'Cor não informada'), 
              vehicleType: data.ride.vehicleType || data.ride.vehicle_type,
              licensePlate: data.ride.licensePlate || data.ride.plate,
              rating: data.ride.driverRating || 5.0,
              phone: data.ride.driverPhone,
              startOtp: otpCode,
            });
          }

          const statusMap: Record<string, RideStatus> = {
            'SEARCHING': 'searching',
            'ACCEPTED': 'accepted',
            'ARRIVED': 'arrived',
            'IN_PROGRESS': 'in_progress'
          };
          
          if (data.ride.status && statusMap[data.ride.status]) {
            const newStatus = statusMap[data.ride.status];
            setRideStatus(newStatus);
            persistRideState(data.ride.id, newStatus);
          }
          
          socket.emit('passenger:rejoin_ride', { rideId: data.ride.id, driverId: data.ride.driverId });
        }
      } catch (err) {
        console.error('Erro ao processar recuperação de estado:', err);
      }
    };

    const handleDriverPosition = (data: any) => {
      if (!isMountedRef.current || !data || data.latitude == null || data.longitude == null) return;
      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      if (isNaN(lat) || isNaN(lng)) return;
      
      setDriverLocation({ latitude: lat, longitude: lng, heading: data.heading || 0 });
      if (data.durationMinutes !== undefined && data.durationMinutes !== null) {
        setDriverEta(Math.ceil(data.durationMinutes));
      }
    };

    const handleRideAccepted = (data: any) => {
      if (!isMountedRef.current || !data) return;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

      const otpCode = String(data.startOtp || data.otpPin || data.pin || '');
      setStartOtp(otpCode); 
      setActiveRideId(data.rideId);
      setDriverInfo({ 
        id: data.driverId, 
        name: data.driverName || 'Motorista',
        photoUrl: formatPhotoUrl(data.driverPhoto), 
        profilePicture: formatPhotoUrl(data.driverPhoto),
        carModel: data.carModel || data.vehicleModel || t('standard_vehicle', 'Veículo Padrão'),
        carColor: data.carColor || data.vehicleColor || t('color_not_specified', 'Cor não informada'), 
        vehicleType: data.vehicleType || data.vehicle_type,
        licensePlate: data.licensePlate || data.plate,
        rating: data.driverRating || 5.0,
        phone: data.driverPhone,
        startOtp: otpCode,
      });
      setAcceptedAt(new Date());
      setRideStatus('accepted');
      persistRideState(data.rideId, 'accepted');

      Alert.alert(t('ride_accepted_title', 'Corrida Aceita! 🚗'), `${data.driverName || 'O motorista'} ${t('ride_accepted_msg', 'aceitou sua viagem e está a caminho.')}`);
    };