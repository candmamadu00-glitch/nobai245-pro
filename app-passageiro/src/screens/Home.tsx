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

    const handleDriverArrived = () => {
      if (!isMountedRef.current) return;
      setRideStatus('arrived');
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'arrived');
      Alert.alert(t('driver_arrived_title', 'Motorista no Local! 📍'), t('driver_arrived_alert_msg', 'Seu motorista chegou ao ponto de partida e está te aguardando.'));
    };

    const handleRideStarted = () => { 
      if (!isMountedRef.current) return;
      setRideStatus('in_progress'); 
      setIsChatVisible(false); 
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'in_progress');
    };

    const handleRideFinished = () => { 
      if (!isMountedRef.current) return;
      setRideStatus('completed');
      setShowRatingModal(true); 
    };

    const handleRideCancelled = (data: any) => {
      if (!isMountedRef.current) return;
      
      if (data?.cancelledBy === 'DRIVER') {
        Alert.alert(t('warning_title', 'Aviso ⚠️'), t('driver_cancelled_msg', 'O motorista cancelou a corrida. Por favor, solicite um novo veículo.'));
      } else {
        Alert.alert(t('cancelled_title', 'Cancelado'), data?.appliedPenalty ? `${t('cancellation_fee', 'Taxa de cancelamento:')} ${data.penaltyAmount} XOF.` : t('ride_cancelled_msg', 'Sua corrida foi cancelada.'));
      }
      
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      persistRideState(null, 'idle');
      setActiveRideId(null);
      setRideStatus('idle');
      setDriverInfo(null);
      setDriverLocation(null);
      setStartOtp('');
      
      if (activeRideIdRef.current) activeRideIdRef.current = null;
      resetRideState();
    };
   
    const handleReceiveMessage = (messageData: any) => {
      if (!isMountedRef.current || !messageData?.text) return;
      setMessages(prev => {
        const messageId = messageData.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        if (prev.some(msg => msg.id === messageId)) return prev;
        return [...prev, { id: messageId, sender: 'driver', text: String(messageData.text) }];
      });
    };

    const handleNoDriversFound = () => {
      if (!isMountedRef.current) return;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      Alert.alert(t('search_ended_title', 'Busca Encerrada'), t('no_drivers_found_msg', 'Não encontramos motoristas disponíveis na sua região. Tente novamente.'));
      resetRideState();
    };
    
    const handlePriceCalculated = (data: any) => {
      if (!isMountedRef.current || !data) return;
      if (typeof data.price === 'number') setEstimatedPrice(data.price);
      if (typeof data.distance === 'number') setEstimatedDistance(data.distance);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('passenger:state_recovered', handleStateRecovered);
    socket.on('driver:position', handleDriverPosition);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:driver_arrived', handleDriverArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:cancelled', handleRideCancelled);
    socket.on('chat:receive_message', handleReceiveMessage);
    socket.on('ride:no_drivers_found', handleNoDriversFound);
    socket.on('ride:price_calculated', handlePriceCalculated);
    socket.on('ride:inaccessible_location', handleInaccessibleLocationAlert);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('passenger:state_recovered', handleStateRecovered);
      socket.off('driver:position', handleDriverPosition);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:driver_arrived', handleDriverArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:cancelled', handleRideCancelled);
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('ride:no_drivers_found', handleNoDriversFound);
      socket.off('ride:price_calculated', handlePriceCalculated);
      socket.off('ride:inaccessible_location', handleInaccessibleLocationAlert);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [getCurrentLocationWithFallback, handleInaccessibleLocationAlert, resetRideState, t]);

  useEffect(() => {
    let origin = pickupCoords;
    let destination = dropoffCoords;
    let extra = extraStopCoords;

    if (rideStatus === 'accepted' && driverLocation) {
      origin = driverLocation;
      destination = pickupCoords;
      extra = null;
    } else if (rideStatus === 'in_progress' && driverLocation) {
      origin = driverLocation;
      destination = dropoffCoords;
      extra = extraStopCoords;
    }

    if (origin && destination) {
      let fitPoints = [origin, destination];
      if (extra) fitPoints.push(extra);
      
      fitMapBounds(fitPoints);
      fetchMapboxRoute(origin, destination, extra);
    }
  }, [pickupCoords, dropoffCoords, extraStopCoords, driverLocation, rideStatus, fitMapBounds, fetchMapboxRoute]);

  useEffect(() => {
    if (route.params?.openChat) {
      setIsChatVisible(true);
      navigation.setParams({ openChat: undefined });
    }
  }, [route.params?.openChat, navigation]);

  useEffect(() => {
    if (pickupCoords && dropoffCoords) {
      setEstimatedPrice(null); 
      calculateEstimate(pickupCoords, dropoffCoords, extraStopCoords);
    }
  }, [pickupCoords, dropoffCoords, extraStopCoords, serviceType, vehicleType, calculateEstimate]);

  async function handleInitialRequestRide() {
    const needsDropoff = serviceType !== 'aluguel';
    if (!pickupCoords || (needsDropoff && !dropoffCoords) || !user?.id) {
      Alert.alert(
        t('warning_title', 'Aviso ⚠️'), 
        t('select_origin_destination_msg', 'Selecione a origem e o destino antes de solicitar.')
      );
      return;
    }

    if (paymentMethod === 'CASH') {
      executeRideRequest();
    } else {
      if (!paymentPhone && user?.phone) {
        setPaymentPhone(user.phone);
      }
      setIsPaymentModalVisible(true);
    }
  }

  async function confirmPaymentAndRide() {
    if (!user?.id) {
      Alert.alert(t('error_title', 'Erro'), t('missing_user_data', 'Dados de usuário não encontrados.'));
      return;
    }

    let cleanPhone = paymentPhone.replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('245') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.substring(3);
    }
    
    const isGwPhoneValid = /^9[567]\d{7}$/.test(cleanPhone);
    
    if (!cleanPhone || !isGwPhoneValid) {
      Alert.alert(
        t('error_title', 'Erro de Formato'), 
        t('invalid_phone_msg', 'Por favor, informe um número válido de 9 dígitos da conta Orange Money ou MTN (ex: 95XXXXXXX, 96XXXXXXX ou 97XXXXXXX).')
      );
      return;
    }

    setIsProcessingPayment(true);

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000);

      const paymentResponse = await initiateMobileMoneyPayment({
        phone: cleanPhone,
        amount: estimatedPrice || 1000,
        provider: paymentMethod as 'ORANGE_MONEY' | 'MTN_MOMO',
        passengerId: user.id,
      }, { signal: abortController.signal });

      clearTimeout(timeoutId);

      if (paymentResponse?.success) {
        if (isMountedRef.current) {
          setIsProcessingPayment(false);
          setIsPaymentModalVisible(false);
        }

        Alert.alert(
          'Solicitação Enviada 📲',
          'Confirme a transação inserindo o seu PIN no prompt USSD que apareceu na tela do seu celular.',
          [
            { text: 'OK, já confirmei', onPress: () => executeRideRequest() }
          ]
        );
      } else {
        throw new Error(paymentResponse?.message || 'Falha ao processar pagamento.');
      }
    } catch (error: unknown) {
      if (isMountedRef.current) {
        setIsProcessingPayment(false);
      }
      const err = error as { name?: string; response?: { data?: { message?: string } } };
      const isTimeout = err.name === 'AbortError';
      Alert.alert(
        t('error_title', 'Aviso no Pagamento'), 
        isTimeout 
          ? 'A operadora está demorando para responder. Tente novamente ou use dinheiro.' 
          : err?.response?.data?.message || 'Não foi possível autorizar o débito. Verifique o saldo ou o número e tente novamente.'
      );
    }
  }

  function executeRideRequest() {
    if (!user?.id || !pickupCoords) {
      Alert.alert(t('warning_title', 'Aviso ⚠️'), t('missing_data_msg', 'Dados insuficientes para iniciar a corrida. Verifique sua localização.'));
      return;
    }

    try {
      if (!socket.connected) connectPassengerSocket();

      setRideStatus('searching');
      
      const mappedServiceType = serviceType === 'viagem' ? 'RIDE' : serviceType === 'entrega' ? 'DELIVERY' : 'RENTAL';
      const mappedVehicleType = vehicleType === 'particular' ? 'PARTICULAR' : vehicleType === 'moto-carro' ? 'MOTO_CARRO' : vehicleType.toUpperCase();
      const regionLabel = RENTAL_PRICES[selectedRegion]?.label || selectedRegion;

      emitRequestRide({
        passengerId: user.id,
        passengerName: (user as any)?.name || user.fullName,
        passengerRating: Number((user as any)?.rating || user.ratingAverage || 5.0),
        pickupLat: pickupCoords.latitude,
        pickupLng: pickupCoords.longitude,
        originAddress: pickupAddress,
        destinationLat: dropoffCoords?.latitude || pickupCoords.latitude,
        destinationLng: dropoffCoords?.longitude || pickupCoords.longitude,
        destinationAddress: serviceType === 'aluguel' ? `Aluguel Toca-Toca (${regionLabel})` : dropoffAddress,
        referencePoint: referencePoint.trim(),
        serviceType: mappedServiceType,
        vehicleType: mappedVehicleType,
        paymentMethod: paymentMethod,
        estimatedPrice: estimatedPrice,
        priceXof: estimatedPrice,
        guestName: isForAnotherPerson ? guestName : undefined,
        guestPhone: isForAnotherPerson ? guestPhone : undefined,
        stops: (extraStopCoords?.latitude && extraStopCoords?.longitude) ? [
          {
            address: extraStopAddress || '',
            lat: extraStopCoords.latitude,
            lng: extraStopCoords.longitude,
            status: 'PENDING'
          }
        ] : [],
        extraStopLat: extraStopCoords?.latitude,
        extraStopLng: extraStopCoords?.longitude,
        extraStopAddress: extraStopAddress || undefined,
      });

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          Alert.alert(
            t('no_response_title', 'Sem resposta'), 
            t('no_driver_accepted_msg', 'Nenhum motorista aceitou no momento. Tente novamente.')
          );
          resetRideState();
        }
      }, 60000);

    } catch (error) {
      Alert.alert(
        t('error_title', 'Erro'), 
        t('server_error_msg', 'Ocorreu um problema ao comunicar com os servidores.')
      );
    }
  }

  function checkPenaltyApplicable() {
    if (!acceptedAt) return false;
    return (new Date().getTime() - acceptedAt.getTime()) > 2 * 60 * 1000;
  }

  const handleCloseCancelModal = useCallback(() => setShowCancelModal(false), []);

  const handleConfirmCancel = useCallback((reason: string) => {
    if (!activeRideId || !user?.id) {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      resetRideState();
      return;
    }
    
    cancelRideByPassenger(activeRideId, user.id, reason);
    setShowCancelModal(false);
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    persistRideState(null, 'idle');
    setActiveRideId(null);
    setRideStatus('idle');
    setDriverInfo(null);
    setDriverLocation(null);
    setStartOtp('');
    
    if (activeRideIdRef.current) activeRideIdRef.current = null;
    resetRideState();
  }, [activeRideId, user?.id, resetRideState]);

  const onMapRegionDidChange = useCallback(async (feature: any) => {
    setIsMapMoving(false);
    if (rideStatus !== 'idle' || bookingStep !== 'ADDRESS') return;

    const coords = feature?.geometry?.coordinates;
    if (!coords || !Array.isArray(coords) || coords.length < 2) return;

    const [lng, lat] = coords;
    if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) return;

    if (isManualPickupRef.current) {
      isManualPickupRef.current = false;
      return;
    }

    setPickupCoords({ latitude: lat, longitude: lng });

    const localName = findNearestLocalBairro(lat, lng);
    if (localName) {
      setPickupAddress(localName);
      return;
    }

    if (MAPBOX_ACCESS_TOKEN) {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;
        const res = await fetch(url);

        if (!res.ok) return;

        const data = await res.json();
        
        if (data?.features?.length > 0) {
          const placeName = data.features[0].place_name || '';
          const parts = placeName.split(',')
            .map((p: string) => p.trim())
            .filter((p: string) => p && !p.toLowerCase().includes('guiné'));
          const cleanAddress = parts.length > 0 ? parts.slice(0, 2).join(', ') : 'Bissau, Centro';
          setPickupAddress(cleanAddress);
        }
      } catch (err) {
        console.warn('Geocodificação Mapbox falhou no arraste:', err);
        setPickupAddress('Bissau, Centro');
      }
    }
  }, [rideStatus, bookingStep]);

  const handleSubmitRating = useCallback((stars: number, tags: string[], comment: string) => {
    if (activeRideId && driverInfo && user?.id) {
      rateDriver({ 
        rideId: activeRideId, 
        reviewerId: user.id, 
        reviewerType: 'PASSENGER', 
        receiverId: driverInfo.id, 
        stars, 
        tags,
        comment 
      });
    }
    setShowRatingModal(false);
    resetRideState();
  }, [activeRideId, driverInfo, user?.id, resetRideState]);
  
  const handleCallDriver = () => {
    setIsChatVisible(true);
    Alert.alert(
      t('contact_protected_title', 'Contato Protegido 🔒'),
      t('contact_protected_msg', 'Por motivos de segurança e privacidade, a comunicação deve ser feita exclusivamente pelo Chat do aplicativo.')
    );
  };

  const handleShareTrip = async () => {
    try {
      if (!driverInfo || !dropoffAddress || !activeRideId) {
        Alert.alert(t('warning_title', 'Aviso ⚠️'), t('wait_trip_data', 'Aguarde os dados da corrida carregarem para compartilhar.'));
        return;
      }

      const trackingUrl = `https://nobai245.com/track/${activeRideId}`;

      const mensagem = `🚕 Acompanhe minha viagem no Nobai245!\n\n` +
        `👤 Motorista: ${driverInfo.name}\n` +
        `🚘 Veículo: ${driverInfo.carModel || 'Veículo'} (${driverInfo.carColor || 'Cor N/A'}) - Placa: ${driverInfo.licensePlate || 'N/A'}\n` +
        `📍 Destino: ${dropoffAddress}\n` +
        `${driverEta ? `⏳ Previsão de chegada: ${driverEta} minutos\n` : ''}` +
        `🌐 Acompanhe em tempo real pelo navegador: ${trackingUrl}`;

      await Share.share({ message: mensagem, title: 'Detalhes da minha corrida' });
    } catch (error) {
      Alert.alert(t('error_title', 'Erro'), t('share_error_msg', 'Não foi possível abrir o menu de compartilhamento.'));
    }
  };

  function sendMessage() {
    if (!inputText.trim() || !activeRideId) return;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const passengerName = (user as any)?.name || user?.fullName || t('passenger', 'Passageiro');

    setMessages(prev => [...prev, { id: uniqueId, sender: 'passenger', text: inputText.trim() }]);
    sendChatMessage(activeRideId, passengerName, inputText.trim());
    setInputText('');
  }

  function openSearchModal(type: 'pickup' | 'dropoff' | 'extraStop') {
    setSearchType(type);
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchModalVisible(true);
  }
const handleSosPress = () => {
  Alert.alert(
    t('emergency_sos', 'SOS / Emergência 🚨'),
    t('choose_emergency_service', 'Selecione o serviço de emergência que deseja contactar:'),
    [
      { 
        text: '🚨 Central de Segurança (112)', 
        onPress: () => Linking.openURL('tel:112').catch(() => {}) 
      },
      { 
        text: '🚒 Bombeiros (1313)', 
        onPress: () => Linking.openURL('tel:1313').catch(() => {}) 
      },
      { 
        text: '🚑 Saúde / Ambulância (1919)', 
        onPress: () => Linking.openURL('tel:1919').catch(() => {}) 
      },
      { 
        text: t('back_btn', 'Cancelar'), 
        style: 'cancel' 
      },
    ],
    { cancelable: true }
  );
};
  if (!passengerLocation) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError || t('getting_location', 'Obtendo localização exata...')}</Text>
        {locationError && (
          <TouchableOpacity 
            style={styles.retryLocationBtn} 
            onPress={getCurrentLocationWithFallback}
          >
            <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>{t('try_again', 'Tentar Novamente')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const activeOtpPin = String(startOtp || driverInfo?.startOtp || '');
  return (
    <View style={styles.container}>
      <View style={styles.floatingHeader}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.headerUserInfo} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Profile')}
          >
            <View style={styles.avatarPlaceholder}>
              {user?.profilePicture ? (
                <Image 
                  source={{ uri: formatPhotoUrl(user.profilePicture) }} 
                  style={{ width: '100%', height: '100%', borderRadius: 50 }} 
                />
              ) : (
                <Ionicons name="person" size={16} color="#0F172A" />
              )}
            </View>
            <Text style={styles.greetingText}>
              {t('greeting', 'Olá')}, {user?.fullName ? user.fullName.split(' ')[0] : t('passenger', 'Passageiro')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.langHeaderBtn} 
            onPress={() => setLangModalVisible(true)}
          >
            <Text style={styles.langHeaderBtnText}>{i18n.language?.toUpperCase() || 'PT'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuIcon} activeOpacity={0.7} onPress={() => setIsMenuVisible(true)}>
            <Ionicons name="menu" size={22} color="#0F172A" />
          </TouchableOpacity>
        </View>
      </View>

      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
        onCameraChanged={(e) => {
          if (e.gestures.isGestureActive) {
            setIsMapMoving(true);
          }
        }}
        onMapIdle={onMapRegionDidChange}
      >
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={14}
          centerCoordinate={[
            passengerLocation?.coords?.longitude || BISSAU_CENTER.longitude,
            passengerLocation?.coords?.latitude || BISSAU_CENTER.latitude,
          ]}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {/* ROTA MAPBOX */}
        {routeGeometry?.type === 'Feature' && routeGeometry?.geometry?.coordinates && (
          <Mapbox.ShapeSource id="routeSource" shape={routeGeometry}>
            <Mapbox.LineLayer
              id="routeLine"
              style={{
                lineColor: '#0F172A',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* PONTO DE EMBARQUE */}
        {pickupCoords?.latitude != null && pickupCoords?.longitude != null && rideStatus !== 'idle' && (
          <Mapbox.PointAnnotation
            id="pickupMarker"
            coordinate={[Number(pickupCoords.longitude), Number(pickupCoords.latitude)]}
          >
            <View style={styles.carMarker}>
              <Ionicons name="location" size={18} color="#0F172A" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* PARADA EXTRA */}
        {extraStopCoords?.latitude != null && extraStopCoords?.longitude != null && (
          <Mapbox.PointAnnotation
            id="extraStopMarker"
            coordinate={[Number(extraStopCoords.longitude), Number(extraStopCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#3B82F6', borderColor: '#FFF' }]}>
              <Ionicons name="location" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* DESTINO FINAL */}
        {dropoffCoords?.latitude != null && dropoffCoords?.longitude != null && (
          <Mapbox.PointAnnotation
            id="dropoffMarker"
            coordinate={[Number(dropoffCoords.longitude), Number(dropoffCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#0F172A' }]}>
              <Ionicons name="flag" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* MOTORISTA */}
        {driverLocation?.latitude != null && driverLocation?.longitude != null && (
          <Mapbox.PointAnnotation
            id="driverMarker"
            coordinate={[Number(driverLocation.longitude), Number(driverLocation.latitude)]}
          >
            <View 
              style={[
                styles.driverMarkerContainer, 
                { 
                  backgroundColor: getVehicleColorHex(driverInfo?.carColor),
                  borderWidth: 2,
                  borderColor: driverInfo?.carColor?.toLowerCase().includes('branc') ? '#94A3B8' : '#FFFFFF'
                }
              ]}
            >
              <MaterialCommunityIcons 
                name={getVehicleIcon(driverInfo?.vehicleType || vehicleType) as any} 
                size={20} 
                color={driverInfo?.carColor?.toLowerCase().includes('branc') ? '#0F172A' : '#FFFFFF'} 
              />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* PINO CENTRAL FLUTUANTE */}
      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.centerPinContainer} pointerEvents="none">
          <Animated.View style={[styles.centerPin, isMapMoving && { transform: [{ translateY: -10 }] }]}>
            <Ionicons name="location" size={36} color="#0F172A" />
          </Animated.View>
          <View style={styles.pinShadow} />
        </View>
      )}

      <TouchableOpacity 
        style={styles.recenterButton} 
        activeOpacity={0.85}
        onPress={() => {
          if (passengerLocation?.coords && cameraRef.current) {
            cameraRef.current.setCamera({
              centerCoordinate: [passengerLocation.coords.longitude, passengerLocation.coords.latitude],
              zoomLevel: 15,
              animationDuration: 800,
            });
          }
        }}
      >
        <Ionicons name="locate" size={20} color="#0F172A" />
      </TouchableOpacity>

      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.favoritesContainer}>
          <TouchableOpacity style={styles.favoriteButton} activeOpacity={0.8} onPress={() => handleFavoritePress('home')}>
            <View style={styles.favoriteIconBg}>
              <Ionicons name="home" size={14} color="#0F172A" />
            </View>
            <Text style={styles.favoriteText} numberOfLines={1}>
              {homeLocation ? homeLocation.address : t('save_home', 'Salvar Casa')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.favoriteButton} activeOpacity={0.8} onPress={() => handleFavoritePress('work')}>
            <View style={styles.favoriteIconBg}>
              <Ionicons name="briefcase" size={14} color="#0F172A" />
            </View>
            <Text style={styles.favoriteText} numberOfLines={1}>
              {workLocation ? workLocation.address : t('save_work', 'Salvar Trabalho')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isNightTimeForPin() && Boolean(activeOtpPin) && ['accepted', 'arrived'].includes(rideStatus) && (
        <View style={styles.pinSecurityBadge}>
          <Ionicons name="shield-checkmark" size={20} color="#B45309" />
          <View style={styles.pinSecurityTextContainer}>
            <Text style={styles.pinSecurityTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
            <Text style={styles.pinSecuritySub}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
          </View>
          <View style={styles.pinCodeBox}>
            <Text style={styles.pinCodeText}>{activeOtpPin}</Text>
          </View>
        </View>
      )}

      {/* KEYBOARD AVOIDING VIEW - PAINEL PRINCIPAL */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.bottomSheetWrapper} pointerEvents="box-none">
        <Animated.View style={[styles.bottomSheet, { transform: [{ translateY }] }]}>
          
          <View style={styles.dragHandlerArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicator} />
          </View>

          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}>
            
            {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
              <View style={{ width: '100%', paddingTop: 4 }}>
                <Text style={styles.sheetTitle}>{t('where_to', 'Para onde vamos?')}</Text>
                
                <TouchableOpacity style={styles.mainSearchInput} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                  <Ionicons name="search" size={20} color="#EAB308" style={{ marginRight: 12 }} />
                  <Text style={styles.mainSearchText} numberOfLines={1} ellipsizeMode="tail">
                    {dropoffAddress || t('enter_destination_placeholder', 'Digite seu destino...')}
                  </Text>
                </TouchableOpacity>

                {dropoffCoords ? (
                  <TouchableOpacity style={styles.requestButton} activeOpacity={0.85} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.requestButtonText}>{t('next_btn', 'Avançar')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.requestButton, { backgroundColor: '#F1F5F9' }]} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                    <Text style={[styles.requestButtonText, { color: '#64748B' }]}>{t('where_do_you_want_to_go', 'Aonde você quer ir?')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'SERVICE_AND_PRICE' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>{t('service_type', 'Tipo de Serviço')}</Text>
                <View style={styles.serviceTypesContainer}>
                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'viagem' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('viagem')}
                  >
                    <Ionicons name="car-outline" size={18} color={serviceType === 'viagem' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'viagem' && styles.serviceTypeTextActive]}>{t('ride_service', 'Viagem')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'entrega' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('entrega')}
                  >
                    <Ionicons name="cube-outline" size={18} color={serviceType === 'entrega' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'entrega' && styles.serviceTypeTextActive]}>{t('delivery_service', 'Entrega')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'aluguel' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('aluguel')}
                  >
                    <Ionicons name="key-outline" size={18} color={serviceType === 'aluguel' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'aluguel' && styles.serviceTypeTextActive]}>{t('rental_service', 'Aluguel')}</Text>
                  </TouchableOpacity>
                </View>

                {serviceType === 'aluguel' ? (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.sectionLabel}>{t('select_coverage_region', 'Selecione a Região de Cobertura')}</Text>
                    <TouchableOpacity style={[styles.categoryCard, styles.categoryCardActive, { borderColor: '#EAB308', borderWidth: 2 }]} activeOpacity={0.9}>
                      <View style={{ backgroundColor: '#FEF08A', padding: 8, borderRadius: 8, marginRight: 12 }}>
                        <Ionicons name="map-outline" size={24} color="#0F172A" />
                      </View>
                      <View style={styles.categoryTextWrapper}>
                        <Text style={[styles.categoryTitle, styles.categoryTextActive]}>{RENTAL_PRICES[selectedRegion]?.label || 'Bissau'}</Text>
                        <Text style={styles.categorySubtitle}>{RENTAL_PRICES[selectedRegion]?.description}</Text>
                      </View>
                      <Text style={[styles.categoryPriceText, styles.categoryPriceTextActive, { color: '#15803D' }]}>
                        {RENTAL_PRICES[selectedRegion]?.price ? `${RENTAL_PRICES[selectedRegion].price?.toLocaleString('pt-BR')} XOF` : t('on_request', 'Sob Consulta')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.sectionLabel}>{t('vehicle_options', 'Opções de Veículo')}</Text>
                    <View style={styles.vehicleCategoryContainer}>
                      {VEHICLE_OPTIONS.map((item) => {
                        const isSelected = vehicleType === item.id;
                        const price = calculateVehiclePrice(item.id, estimatedDistance);
                        return (
                          <TouchableOpacity 
                            key={item.id} 
                            style={[styles.categoryCard, isSelected && styles.categoryCardActive]}
                            activeOpacity={0.8}
                            onPress={() => setVehicleType(item.id)}
                          >
                            <Image source={item.image} style={styles.vehicleImage} resizeMode="contain" />
                            <View style={styles.categoryTextWrapper}>
                              <Text style={[styles.categoryTitle, isSelected && styles.categoryTextActive]}>{item.title}</Text>
                              <Text style={styles.categorySubtitle}>{item.subtitle}</Text>
                            </View>
                            <Text style={[styles.categoryPriceText, isSelected && styles.categoryPriceTextActive]}>
                              {price ? `${price} XOF` : t('calculating', 'Calculando...')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                <Text style={styles.sectionLabel}>{t('reference_point', 'Ponto de Referência (Opcional)')}</Text>
                <View style={styles.referenceContainer}>
                  <TextInput
                    style={styles.referenceInput}
                    placeholder={t('reference_placeholder', 'Ex: Próximo à farmácia, casa azul...')}
                    placeholderTextColor="#94A3B8"
                    value={referencePoint}
                    onChangeText={setReferencePoint}
                  />
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('ADDRESS')}>
                    <Text style={styles.cancelButtonOutlineText}>{t('back_btn', 'Voltar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={() => setBookingStep('PAYMENT')}>
                    <Text style={styles.requestButtonText}>{t('continue_btn', 'Continuar')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'PAYMENT' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>{t('payment_method', 'Forma de Pagamento')}</Text>
                <View style={styles.paymentOptionsContainer}>
                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('ORANGE_MONEY')}
                  >
                    <Ionicons name="phone-portrait-outline" size={18} color={paymentMethod === 'ORANGE_MONEY' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnTextActive]}>Orange Money</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'MTN_MOMO' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('MTN_MOMO')}
                  >
                    <Ionicons name="phone-portrait-outline" size={18} color={paymentMethod === 'MTN_MOMO' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'MTN_MOMO' && styles.paymentBtnTextActive]}>MTN MoMo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'CASH' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('CASH')}
                  >
                    <Ionicons name="cash-outline" size={18} color={paymentMethod === 'CASH' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'CASH' && styles.paymentBtnTextActive]}>{t('cash', 'Dinheiro')}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.cancelButtonOutlineText}>{t('back_btn', 'Voltar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={handleInitialRequestRide}>
                    <Text style={styles.requestButtonText}>{t('request_now_btn', 'Pedir Agora')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {(rideStatus === 'accepted' || rideStatus === 'arrived') && Boolean(activeOtpPin) && (
              <View style={styles.pinCardContainer}>
                <View style={styles.pinHeader}>
                  <Ionicons name="shield-checkmark-sharp" size={18} color="#10B981" />
                  <Text style={styles.pinTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
                </View>
                <Text style={styles.pinSubtitle}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
                <View style={styles.pinDigitsRow}>
                  {activeOtpPin.split('').map((digit, index) => (
                    <View key={index} style={styles.pinDigitBox}>
                      <Text style={styles.pinDigitText}>{digit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {rideStatus === 'searching' && (
              <View style={styles.statusBox}>
                <ActivityIndicator size="large" color="#EAB308" style={{ marginBottom: 12 }} />
                <Text style={styles.statusTitle}>{t('searching_drivers_title', 'Buscando motoristas...')}</Text>
                <Text style={styles.statusSub}>{t('locating_nearest_vehicle', 'Localizando o veículo mais próximo de você.')}</Text>
                <TouchableOpacity style={[styles.cancelButtonOutline, { marginTop: 16 }]} onPress={() => setShowCancelModal(true)}>
                  <Text style={styles.cancelButtonOutlineText}>{t('cancel_search_btn', 'Cancelar Busca')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {driverInfo && rideStatus !== 'searching' && (
              <View style={styles.driverCardContainer}>
                <View style={styles.driverMainInfo}>
                  {driverInfo?.photoUrl ? (
                    <Image source={{ uri: driverInfo.photoUrl }} style={styles.driverAvatarProfile} />
                  ) : (
                    <View style={styles.driverAvatarProfile}>
                      <Ionicons name="person" size={24} color="#94A3B8" />
                    </View>
                  )}
                  
                  <View style={styles.driverDetails}>
                    <Text style={styles.driverName}>{driverInfo?.name || 'Motorista'}</Text>
                    <View style={styles.driverRatingBadge}>
                      <Ionicons name="star" size={14} color="#EAB308" />
                      <Text style={styles.driverRatingText}>{driverInfo?.rating || 5.0}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.dividerLight} />

                <View style={styles.vehicleShowcase}>
                  <Image 
                    source={
                      VEHICLE_OPTIONS.find(v => 
                        v.id.toLowerCase() === (driverInfo?.vehicleType || 'particular').toLowerCase().replace('_', '-')
                      )?.image || require('../assets/vehicles/carro_white.png')
                    } 
                    style={styles.showcaseVehicleImg} 
                    resizeMode="contain" 
                  />
                  
                  <View style={styles.vehicleDetailsCol}>
                    <Text style={styles.vehicleModelText} numberOfLines={1}>
                      {driverInfo?.carModel || t('standard_vehicle', 'Veículo Padrão')}
                    </Text>
                    
                    <View style={styles.colorAndPlateRow}>
                      <View style={[styles.modernColorChip, { backgroundColor: getVehicleColorHex(driverInfo?.carColor) }]} />
                      <Text style={styles.vehicleColorText}>{driverInfo?.carColor || t('color_not_specified', 'Cor não informada')}</Text>
                      
                      <View style={styles.dotSeparator} />
                      
                      <View style={styles.modernPlateBadge}>
                        <Text style={styles.modernPlateText}>{driverInfo?.licensePlate?.toUpperCase() || t('no_license_plate', 'SEM PLACA')}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {['accepted', 'arrived', 'in_progress'].includes(rideStatus) && driverInfo && (
              <View style={{ width: '100%' }}>
                <View style={styles.statusBanner}>
                  <Text style={styles.statusBannerText}>
                    {rideStatus === 'accepted' 
                      ? (driverEta ? `${t('arriving_in', 'Chegando em')} ${driverEta} min` : t('driver_on_way', 'Motorista a caminho')) :
                     rideStatus === 'arrived' 
                      ? t('driver_arrived', 'O motorista chegou!') : 
                     (driverEta ? `${t('destination_in', 'Destino em')} ${driverEta} min` : t('ride_in_progress', 'Viagem em andamento'))}
                  </Text>
                  <TouchableOpacity onPress={handleShareTrip} style={styles.shareButton}>
                    <Ionicons name="share-social-outline" size={18} color="#0F172A" />
                  </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity 
                    style={[styles.iconCircleButton, styles.sosButton]} 
                    onPress={handleSosPress}
                  >
                    <Ionicons name="shield-checkmark" size={18} color="#EF4444" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.iconCircleButton} onPress={handleCallDriver}>
                    <Ionicons name="call" size={18} color="#0F172A" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setShowCancelModal(true)}>
                    <Text style={styles.cancelButtonOutlineText}>{t('cancel_ride', 'Cancelar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 6 }]} onPress={() => setIsChatVisible(true)}>
                    <Ionicons name="chatbubble-ellipses" size={16} color="#0F172A" style={{ marginRight: 6 }} />
                    <Text style={styles.requestButtonText}>Chat</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE IDIOMAS */}
      <Modal visible={langModalVisible} transparent animationType="slide" onRequestClose={() => setLangModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>{t('select_language', 'Selecione o Idioma')}</Text>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={styles.langOption}
                onPress={() => changeLanguage(lang.code)}
              >
                <Text style={styles.langOptionText}>{lang.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={() => setLangModalVisible(false)}
            >
              <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>{t('back_btn', 'Fechar')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE PERMISSÃO DE GPS */}
      <Modal visible={isLocationSettingsVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.locationModalCard}>
            <View style={styles.locationIconBg}>
              <Ionicons name="location" size={32} color="#EAB308" />
            </View>
            <Text style={styles.locationModalTitle}>{t('location_needed_title', 'Localização Necessária')}</Text>
            <Text style={styles.locationModalText}>
              {locationError || t('location_needed_desc', 'Para encontrar motoristas rapidamente e garantir sua segurança, precisamos que ative o GPS e permita o acesso no seu celular.')}
            </Text>
            
            <TouchableOpacity 
              style={[styles.requestButton, { width: '100%', marginBottom: 12 }]} 
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.requestButtonText}>{t('open_settings', 'Abrir Configurações')}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.cancelButtonOutline} 
              onPress={getCurrentLocationWithFallback}
            >
              <Text style={styles.cancelButtonOutlineText}>{t('try_again', 'Já ativei / Tentar novamente')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* KEYBOARD AVOIDING VIEW - MODAL DE CONVIDADO / TERCEIROS */}
      <Modal visible={isGuestModalVisible} transparent animationType="slide" onRequestClose={() => setIsGuestModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.locationModalCard}>
              <Text style={styles.locationModalTitle}>Para quem é a corrida?</Text>
              <TextInput
                style={[styles.referenceInput, { width: '100%', marginBottom: 12 }]}
                placeholder="Nome do passageiro"
                placeholderTextColor="#94A3B8"
                value={guestName}
                onChangeText={setGuestName}
              />
              <TextInput
                style={[styles.referenceInput, { width: '100%', marginBottom: 20 }]}
                placeholder="Telefone (Opcional)"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={guestPhone}
                onChangeText={setGuestPhone}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => { setIsForAnotherPerson(false); setIsGuestModalVisible(false); }}>
                  <Text style={styles.cancelButtonOutlineText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={() => { setIsForAnotherPerson(true); setIsGuestModalVisible(false); }}>
                  <Text style={styles.requestButtonText}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

{/* KEYBOARD AVOIDING VIEW - MODAL DE PAGAMENTO MOBILE MONEY */}
      <Modal visible={isPaymentModalVisible} transparent animationType="slide" onRequestClose={() => !isProcessingPayment && setIsPaymentModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.paymentModalCard}>
              <View style={[styles.operatorHeader, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#FFCC00' }]}>
                <Ionicons name="phone-portrait-sharp" size={24} color={paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000'} />
                <Text style={[styles.operatorTitle, { color: paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000' }]}>
                  {paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : 'MTN Mobile Money'}
                </Text>
              </View>

              <ScrollView style={styles.paymentModalBody} contentContainerStyle={{ paddingBottom: 10 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.paymentModalSubtitle}>
                  {t('ussd_push_instruction', 'Confirme seu número. Você receberá um alerta seguro da operadora no seu celular para digitar seu PIN.')}
                </Text>

                <View style={styles.amountBadge}>
                  <Text style={styles.amountTextLabel}>{t('total_amount', 'Valor Total:')}</Text>
                  <Text style={styles.amountValue}>
                    {estimatedPrice ? `${estimatedPrice.toLocaleString('pt-GW')} XOF` : t('calculating', 'Calculando...')}
                  </Text>
                </View>

                <Text style={styles.inputLabel}>{t('mobile_money_account', 'Número da Conta Mobile Money')}</Text>
                <View style={styles.phoneInputContainer}>
                  <Text style={styles.countryCode}>+245</Text>
                  <TextInput
                    style={styles.phoneInput}
                    value={paymentPhone ? String(paymentPhone).replace(/^\+?245/, '').replace(/\D/g, '') : ''}
                    onChangeText={(text) => {
                      const cleanNumber = text.replace(/^\+?245/, '').replace(/\D/g, '');
                      setPaymentPhone(cleanNumber);
                    }}
                    keyboardType="phone-pad"
                    editable={!isProcessingPayment}
                    placeholder="955219149"
                  />
                </View>

                <View style={styles.modalActionsRow}>
                  <TouchableOpacity style={styles.cancelModalBtn} disabled={isProcessingPayment} onPress={() => setIsPaymentModalVisible(false)}>
                    <Text style={styles.cancelModalBtnText}>{t('back_btn', 'Cancelar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.confirmModalBtn, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#004F9F' }]}
                    disabled={isProcessingPayment}
                    onPress={confirmPaymentAndRide}
                  >
                    {isProcessingPayment ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.confirmModalBtnText}>{t('confirm_payment_btn', 'Confirmar Solicitação')}</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MENU LATERAL */}
      <Modal visible={isMenuVisible} animationType="fade" transparent onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <View style={styles.menuDrawer}>
            <View style={styles.menuHeader}>
              <View style={styles.avatarPlaceholderLarge}>
                {user?.profilePicture ? (
                  <Image source={{ uri: formatPhotoUrl(user.profilePicture) }} style={{ width: '100%', height: '100%', borderRadius: 30 }} />
                ) : (
                  <Ionicons name="person" size={32} color="#0F172A" />
                )}
              </View>
              <Text style={styles.menuUserName}>{user?.fullName || t('passenger', 'Passageiro')}</Text>
              <Text style={styles.menuUserPhone}>{user?.phone || ''}</Text>
            </View>

            <View style={styles.menuItems}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('Profile'); }}>
                <Ionicons name="person-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_profile', 'Meu Perfil')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('RideHistory'); }}>
                <Ionicons name="time-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_rides', 'Minhas Corridas')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('EmergencyContacts'); }}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('HelpCenter'); }}>
                <Ionicons name="help-buoy-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('help_center', 'Central de Ajuda')}</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); signOut(); }}>
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{t('logout', 'Sair da Conta')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - CHAT INTERNO */}
      <Modal visible={isChatVisible} animationType="slide" transparent onRequestClose={() => setIsChatVisible(false)}>
        <KeyboardAvoidingView 
          style={styles.chatOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'android' ? 10 : 0}
        >
          <View style={styles.chatContainer}>
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderUserInfo}>
                {driverInfo?.profilePicture ? (
                  <Image source={{ uri: formatPhotoUrl(driverInfo.profilePicture) }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarPlaceholder}>
                    <Ionicons name="person" size={18} color="#64748B" />
                  </View>
                )}
                <Text style={styles.chatTitle}>
                  {t('chat_with', 'Chat com')} {driverInfo?.name || 'Motorista'}
                </Text>
              </View>

              <TouchableOpacity onPress={() => setIsChatVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#0F172A" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={chatFlatListRef}
              data={messages}
              keyExtractor={(item, index) => item.id || `msg-${index}`}
              contentContainerStyle={styles.chatList}
              onContentSizeChange={() => chatFlatListRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => {
                const isPassenger = item.sender === 'passenger';
                const photoUrl = formatPhotoUrl(item.senderPhoto || (isPassenger ? user?.profilePicture : driverInfo?.profilePicture));

                return (
                  <View style={[styles.messageRow, isPassenger ? styles.rowPassenger : styles.rowDriver]}>
                    {!isPassenger && (
                      photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.chatBubbleAvatar} />
                      ) : (
                        <View style={styles.chatBubbleAvatarPlaceholder}>
                          <Ionicons name="person" size={12} color="#64748B" />
                        </View>
                      )
                    )}

                    <View style={[styles.messageBubble, isPassenger ? styles.messagePassenger : styles.messageDriver]}>
                      <Text style={[styles.messageText, isPassenger ? styles.textPassenger : styles.textDriver]}>
                        {item.text}
                      </Text>
                    </View>

                    {isPassenger && (
                      photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.chatBubbleAvatar} />
                      ) : (
                        <View style={styles.chatBubbleAvatarPlaceholder}>
                          <Ionicons name="person" size={12} color="#64748B" />
                        </View>
                      )
                    )}
                  </View>
                );
              }}
            />

            <View style={[styles.chatInputContainer, { paddingBottom: Platform.OS === 'android' ? 16 : 12 }]}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('type_something', 'Escreva algo...')}
                placeholderTextColor="#94A3B8"
              />
              <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage}>
                <Ionicons name="send" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE BUSCA DE ENDEREÇO MAPBOX */}
      <Modal visible={isSearchModalVisible} animationType="slide" transparent={false} onRequestClose={() => setIsSearchModalVisible(false)}>
        <SafeAreaView style={styles.searchModalContainer}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.searchHeader}>
              <TouchableOpacity onPress={() => setIsSearchModalVisible(false)} style={styles.backButton}>
                <Ionicons name="arrow-back" size={22} color="#0F172A" />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.passengerSelector} onPress={() => setIsGuestModalVisible(true)}>
                <Ionicons name="person" size={13} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.passengerSelectorText}>
                  {isForAnotherPerson ? (guestName || 'Outra Pessoa') : t('for_me', 'Para mim')}
                </Text>
              </TouchableOpacity>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.modalBody}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, paddingHorizontal: 10 }}>
                
                <View style={{ alignItems: 'center', marginRight: 15 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#94A3B8' }} />
                  <View style={{ width: 1, height: showExtraStop ? 45 : 35, backgroundColor: '#E2E8F0', marginVertical: 4 }} />
                  {showExtraStop && (
                     <>
                       <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3B82F6' }} />
                       <View style={{ width: 1, height: 45, backgroundColor: '#E2E8F0', marginVertical: 4 }} />
                     </>
                  )}
                  <View style={{ width: 8, height: 8, backgroundColor: '#0F172A' }} />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={[styles.mapboxSearchInputWrapper, searchType === 'pickup' ? { borderColor: '#EAB308', borderWidth: 1 } : { marginBottom: 10, borderWidth: 0 }]}>
                    <TextInput
                      style={styles.mapboxSearchInput}
                      placeholder={t('pickup_location', 'Local de Partida')}
                      placeholderTextColor="#94A3B8"
                      value={searchType === 'pickup' ? searchQuery : pickupAddress}
                      onFocus={() => { setSearchType('pickup'); setSearchQuery(pickupAddress); }}
                      onChangeText={handleMapboxSearch}
                    />
                    {isSearchingMapbox && searchType === 'pickup' && <ActivityIndicator size="small" color="#EAB308" />}
                  </View>

                  {showExtraStop && (
                     <View style={[styles.mapboxSearchInputWrapper, searchType === 'extraStop' ? { borderColor: '#3B82F6', borderWidth: 1 } : { marginBottom: 10, borderWidth: 0 }]}>
                       <TextInput
                         style={styles.mapboxSearchInput}
                         placeholder="Adicionar parada..."
                         placeholderTextColor="#94A3B8"
                         value={searchType === 'extraStop' ? searchQuery : extraStopAddress}
                         onFocus={() => { setSearchType('extraStop'); setSearchQuery(extraStopAddress); }}
                         onChangeText={handleMapboxSearch}
                       />
                       <TouchableOpacity onPress={() => { setShowExtraStop(false); setExtraStopAddress(''); setExtraStopCoords(null); }}>
                          <Ionicons name="close-circle" size={20} color="#94A3B8" />
                       </TouchableOpacity>
                     </View>
                  )}

                  <View style={[styles.mapboxSearchInputWrapper, searchType === 'dropoff' ? { borderColor: '#EAB308', borderWidth: 1 } : { borderWidth: 0 }]}>
                    <TextInput
                      style={styles.mapboxSearchInput}
                      placeholder={t('where_to', 'Para onde vamos?')}
                      placeholderTextColor="#94A3B8"
                      value={searchType === 'dropoff' ? searchQuery : dropoffAddress}
                      onFocus={() => { setSearchType('dropoff'); setSearchQuery(dropoffAddress); }}
                      onChangeText={handleMapboxSearch}
                      autoFocus
                    />
                    {isSearchingMapbox && searchType === 'dropoff' && <ActivityIndicator size="small" color="#EAB308" />}
                  </View>

                  {!showExtraStop && (
                    <TouchableOpacity style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }} onPress={() => { setShowExtraStop(true); setSearchType('extraStop'); setSearchQuery(''); }}>
                      <Ionicons name="add" size={16} color="#3B82F6" />
                      <Text style={{ color: '#3B82F6', fontWeight: '600', marginLeft: 4, fontSize: 13 }}>Adicionar parada</Text>
                    </TouchableOpacity>
                  )}

                </View>
              </View>

              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={{ marginTop: 5 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => {
                      if (searchType === 'pickup') {
                        isManualPickupRef.current = true;
                        setPickupAddress(item.description);
                        setPickupCoords({ latitude: item.latitude, longitude: item.longitude });
                        if (cameraRef.current) {
                          cameraRef.current.setCamera({
                            centerCoordinate: [item.longitude, item.latitude],
                            zoomLevel: 15,
                            animationDuration: 800,
                          });
                        }
                        setSearchType(showExtraStop && !extraStopCoords ? 'extraStop' : 'dropoff');
                        setSearchQuery('');
                        setSearchResults([]);
                      } else if (searchType === 'extraStop') {
                        setExtraStopAddress(item.description);
                        setExtraStopCoords({ latitude: item.latitude, longitude: item.longitude });
                        setSearchType('dropoff');
                        setSearchQuery('');
                        setSearchResults([]);
                      } else {
                        setDropoffAddress(item.description);
                        setDropoffCoords({ latitude: item.latitude, longitude: item.longitude });
                        setIsSearchModalVisible(false);
                        setBookingStep('SERVICE_AND_PRICE');
                      }
                    }}
                  >
                    <Ionicons name="location-outline" size={18} color="#0F172A" style={{ marginRight: 10 }} />
                    <Text style={styles.searchResultText}>{item.description}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <CancelModal
        visible={showCancelModal}
        userType="PASSENGER"
        isPenaltyApplicable={checkPenaltyApplicable()}
        onClose={handleCloseCancelModal} 
        onConfirm={handleConfirmCancel} 
      />

      <RatingModal
        visible={showRatingModal}
        targetName={driverInfo?.name || 'Motorista'}
        onSubmit={handleSubmitRating} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -18,
    marginTop: -36,
    alignItems: 'center',
    zIndex: 5,
  },
  centerPin: {
    marginBottom: -4,
  },
  pinShadow: {
    width: 12,
    height: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 20 },
  loadingText: { fontSize: 14, color: '#64748B', marginTop: 12, fontWeight: '500', textAlign: 'center' },
  retryLocationBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: '#EAB308', borderRadius: 12 },
  
  floatingHeader: { 
    position: 'absolute', 
    top: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 20) + 10, 
    left: 16, 
    right: 16, 
    zIndex: 10, 
    backgroundColor: '#EAB308', 
    borderRadius: 20, 
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerUserInfo: { flexDirection: 'row', alignItems: 'center' },
  avatarPlaceholder: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginRight: 10, overflow: 'hidden' },
  greetingText: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  menuIcon: { padding: 4 },
  dragHandlerArea: { width: '100%', alignItems: 'center', paddingVertical: 10, marginTop: -8 },

  recenterButton: { 
    position: 'absolute', 
    right: 16, 
    bottom: 310, 
    backgroundColor: '#FFF', 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center', 
    elevation: 6, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, 
    shadowRadius: 5, 
    zIndex: 9 
  },
  carMarker: { backgroundColor: '#EAB308', padding: 8, borderRadius: 20, borderWidth: 2, borderColor: '#FFF', elevation: 4 },
  driverMarkerContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },

  favoritesContainer: { position: 'absolute', bottom: 195, left: 16, right: 16, flexDirection: 'row', gap: 10, zIndex: 9 },
  favoriteButton: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 5, gap: 8 },
  favoriteIconBg: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FEF08A', justifyContent: 'center', alignItems: 'center' },
  favoriteText: { fontSize: 12, fontWeight: '600', color: '#0F172A', flex: 1 },

  pinSecurityBadge: { position: 'absolute', top: 110, left: 16, right: 16, backgroundColor: '#FEF3C7', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#F59E0B', zIndex: 10, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 5 },
  pinSecurityTextContainer: { flex: 1, marginLeft: 10 },
  pinSecurityTitle: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  pinSecuritySub: { fontSize: 11, color: '#B45309' },
  pinCodeBox: { backgroundColor: '#92400E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  pinCodeText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  bottomSheetWrapper: { position: 'absolute', bottom: Platform.OS === 'ios' ? 20 : 12, left: 12, right: 12, zIndex: 10, elevation: 12 },
  bottomSheet: {
    backgroundColor: '#FFF',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 20,
    minHeight: 180,
    maxHeight: Dimensions.get('window').height * 0.75,
  },
  dragIndicator: { width: 38, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 14 },
  
  mainSearchInput: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12, elevation: 2 },
  mainSearchText: { fontSize: 14, color: '#475569', flex: 1, fontWeight: '500' },
  
  requestButton: { backgroundColor: '#EAB308', paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 5 },
  requestButtonText: { color: '#0F172A', fontSize: 15, fontWeight: '700' },

  actionRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 12, 
    gap: 8,
    width: '100%',
  },
  iconCircleButton: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: '#F1F5F9', 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#E2E8F0',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3
  },
  cancelButtonOutline: { 
    flex: 1, 
    height: 44,
    borderWidth: 1, 
    borderColor: '#CBD5E1', 
    paddingHorizontal: 6, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: '#FFF'
  },
  cancelButtonOutlineText: { 
    color: '#475569', 
    fontSize: 12, 
    fontWeight: '600' 
  },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 12 },
  serviceTypesContainer: { flexDirection: 'row', gap: 8 },
  serviceTypeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  serviceTypeActive: { backgroundColor: '#FEF08A', borderColor: '#EAB308' },
  serviceTypeText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  serviceTypeTextActive: { color: '#0F172A', fontWeight: '700' },

  vehicleCategoryContainer: { gap: 8 },
  categoryCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  categoryCardActive: { backgroundColor: '#FEF08A', borderColor: '#EAB308', borderWidth: 2 },
  vehicleImage: { width: 48, height: 36, marginRight: 12 },
  categoryTextWrapper: { flex: 1 },
  categoryTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  categorySubtitle: { fontSize: 11, color: '#64748B' },
  categoryPriceText: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  categoryTextActive: { color: '#0F172A' },
  categoryPriceTextActive: { color: '#0F172A' },

  referenceContainer: { marginBottom: 12 },
  referenceInput: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#0F172A' },

  paymentOptionsContainer: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  paymentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  paymentBtnActive: { backgroundColor: '#FEF08A', borderColor: '#EAB308' },
  paymentBtnText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  paymentBtnTextActive: { color: '#0F172A', fontWeight: '700' },

  pinCardContainer: { backgroundColor: '#ECFDF5', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#10B981', marginBottom: 12 },
  pinHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  pinTitle: { fontSize: 12, fontWeight: '800', color: '#065F46' },
  pinSubtitle: { fontSize: 11, color: '#047857', marginBottom: 10 },
  pinDigitsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  pinDigitBox: { backgroundColor: '#065F46', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pinDigitText: { fontSize: 18, fontWeight: '800', color: '#FFF' },

  statusBox: { alignItems: 'center', paddingVertical: 20 },
  statusTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  statusSub: { fontSize: 13, color: '#64748B', textAlign: 'center' },

  driverCardContainer: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
  driverMainInfo: { flexDirection: 'row', alignItems: 'center' },
  driverAvatarProfile: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E2E8F0', marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  driverDetails: { flex: 1 },
  driverName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  driverRatingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  driverRatingText: { fontSize: 12, fontWeight: '700', color: '#0F172A' },

  dividerLight: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 10 },

  vehicleShowcase: { flexDirection: 'row', alignItems: 'center' },
  showcaseVehicleImg: { width: 42, height: 30, marginRight: 10 },
  vehicleDetailsCol: { flex: 1 },
  vehicleModelText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  colorAndPlateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  modernColorChip: { width: 10, height: 10, borderRadius: 5, marginRight: 6, borderWidth: 1, borderColor: '#CBD5E1' },
  vehicleColorText: { fontSize: 11, color: '#64748B' },
  dotSeparator: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#94A3B8', marginHorizontal: 6 },
  modernPlateBadge: { backgroundColor: '#0F172A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  modernPlateText: { color: '#FFF', fontSize: 10, fontWeight: '800' },

  statusBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FEF08A', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, marginBottom: 8 },
  statusBannerText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  shareButton: { padding: 4 },

  sosButton: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },

  langHeaderBtn: { backgroundColor: '#FFF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginRight: 8 },
  langHeaderBtnText: { fontSize: 11, fontWeight: '800', color: '#0F172A' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  modalContainer: { width: '100%', backgroundColor: '#FFF', borderRadius: 20, padding: 20, alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 16 },
  langOption: { width: '100%', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', alignItems: 'center' },
  langOptionText: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  closeButton: { marginTop: 16, paddingVertical: 8 },

  locationModalCard: { width: '100%', backgroundColor: '#FFF', borderRadius: 24, padding: 20, alignItems: 'center' },
  locationIconBg: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FEF08A', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  locationModalTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 8, textAlign: 'center' },
  locationModalText: { fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 20, lineHeight: 18 },

  paymentModalCard: { width: '100%', backgroundColor: '#FFF', borderRadius: 24, overflow: 'hidden' },
  operatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  operatorTitle: { fontSize: 16, fontWeight: '800' },
  paymentModalBody: { padding: 16 },
  paymentModalSubtitle: { fontSize: 12, color: '#64748B', marginBottom: 16, lineHeight: 18 },
  amountBadge: { backgroundColor: '#F8FAFC', padding: 12, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  amountTextLabel: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  amountValue: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  phoneInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 12, marginBottom: 20 },
  countryCode: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginRight: 8 },
  phoneInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: '#0F172A' },
  modalActionsRow: { flexDirection: 'row', gap: 10 },
  cancelModalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center' },
  cancelModalBtnText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  confirmModalBtn: { flex: 1.5, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmModalBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },

  menuOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  menuDrawer: { width: '75%', height: '100%', backgroundColor: '#FFF', padding: 20 },
  menuHeader: { marginTop: Platform.OS === 'ios' ? 40 : 20, marginBottom: 20 },
  avatarPlaceholderLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FEF08A', justifyContent: 'center', alignItems: 'center', marginBottom: 12, overflow: 'hidden' },
  menuUserName: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  menuUserPhone: { fontSize: 13, color: '#64748B' },
  menuItems: { flex: 1 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  menuDivider: { height: 1, backgroundColor: '#E2E8F0', my: 12, marginVertical: 12 },

  chatOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  chatContainer: { height: '80%', backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  chatHeaderUserInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  chatTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  chatList: { paddingVertical: 12 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10, gap: 8 },
  rowPassenger: { justifyContent: 'flex-end' },
  rowDriver: { justifyContent: 'flex-start' },
  chatBubbleAvatar: { width: 24, height: 24, borderRadius: 12 },
  chatBubbleAvatarPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' },
  messageBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  messagePassenger: { backgroundColor: '#EAB308', borderBottomRightRadius: 2 },
  messageDriver: { backgroundColor: '#F1F5F9', borderBottomLeftRadius: 2 },
  messageText: { fontSize: 13, lineHeight: 18 },
  textPassenger: { color: '#0F172A', fontWeight: '600' },
  textDriver: { color: '#0F172A', fontWeight: '500' },
  chatInputContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  chatInput: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, color: '#0F172A' },
  chatSendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },

  searchModalContainer: { flex: 1, backgroundColor: '#FFF' },
  searchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  backButton: { padding: 4 },
  passengerSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  passengerSelectorText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  modalBody: { flex: 1, padding: 16 },
  mapboxSearchInputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2 },
  mapboxSearchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#0F172A', fontWeight: '500' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  searchResultText: { fontSize: 13, color: '#0F172A', fontWeight: '500', flex: 1 },
});