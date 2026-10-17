import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, Alert, 
  FlatList, Platform, StatusBar, BackHandler, Linking, 
  Share, AppState, KeyboardAvoidingView, Modal, TextInput, 
  ActivityIndicator, Image, Animated, PanResponder, Dimensions, ScrollView, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { api } from '../services/api';
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

// 🛡️ Normalizador universal do tipo de veículo
const normalizeVehicleType = (type?: string): string => {
  if (!type) return 'particular';
  const clean = type.toLowerCase().replace(/[-_]/g, '').trim();
  if (clean.includes('motocarro')) return 'moto-carro';
  if (clean.includes('moto')) return 'moto';
  if (clean.includes('taxi')) return 'taxi';
  if (clean.includes('toca')) return 'toca-toca';
  return 'particular';
};

// 🏎️ Mapeador de Ícones 3D (Top-View) para o Marcador do Mapa por Cor e Tipo
export const getVehicle3DIconAsset = (type?: string, colorName?: string) => {
  const normType = normalizeVehicleType(type);
  const color = (colorName || 'WHITE').toUpperCase().trim();

  // 1. Veículos Especiais
  if (normType === 'moto') {
    return require('../../assets/images/vehicles/moto.jpg');
  }
  if (normType === 'moto-carro' || normType === 'toca-toca') {
    return require('../../assets/images/vehicles/toca_toca.jpg');
  }
  if (normType === 'taxi') {
    return require('../../assets/images/vehicles/taxi_yellow.jpg');
  }

  // 2. Carros por Cor
  if (color.includes('PRET') || color.includes('BLACK')) return require('../../assets/images/vehicles/car_black.jpg');
  if (color.includes('AZUL') || color.includes('BLUE')) return require('../../assets/images/vehicles/car_blue.jpg');
  if (color.includes('VERMELH') || color.includes('RED')) return require('../../assets/images/vehicles/car_red.jpg');
  if (color.includes('LARANJ') || color.includes('ORANGE')) return require('../../assets/images/vehicles/car_orange.jpg');
  if (color.includes('VERD') || color.includes('GREEN')) return require('../../assets/images/vehicles/car_green.jpg');
  if (color.includes('PRAT') || color.includes('CINZA') || color.includes('GRAY') || color.includes('SILVER')) return require('../../assets/images/vehicles/car_gray.jpg');
  if (color.includes('CASTANH') || color.includes('MARROM') || color.includes('BROWN')) return require('../../assets/images/vehicles/car_brown.jpg');
  if (color.includes('AMAREL') || color.includes('YELLOW')) return require('../../assets/images/vehicles/car_yellow.jpg');

  // Padrão: Carro Branco
  return require('../../assets/images/vehicles/car_white.jpg');
};

// 🖼️ Imagem oficial do Veículo para o Cartão de Corrida
const getVehicleImage = (type?: string) => {
  const norm = normalizeVehicleType(type);
  switch (norm) {
    case 'moto':
      return require('../../assets/images/vehicles/moto.jpg');
    case 'moto-carro':
    case 'toca-toca':
      return require('../../assets/images/vehicles/toca_toca.jpg');
    case 'taxi':
      return require('../../assets/images/vehicles/taxi_yellow.jpg');
    case 'particular':
    default:
      return require('../../assets/images/vehicles/car_white.jpg');
  }
};

// 🛵 Ícone do Veículo para o Marcador do Mapa
const getVehicleIcon = (type?: string) => {
  const norm = normalizeVehicleType(type);
  switch (norm) {
    case 'moto':
      return 'motorbike';
    case 'moto-carro':
      return 'rickshaw';
    case 'taxi':
      return 'taxi';
    case 'particular':
    default:
      return 'car';
  }
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
  const insets = useSafeAreaInsets();
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
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ id: string; lat: number; lng: number; heading?: number }>>([]);
  const [isSearchingRide, setIsSearchingRide] = useState(false);
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

  console.log(`\n==================================================`);
  console.log(`🔍 [BUSCA INICIADA] Termo: "${text}"`);
  console.log(`==================================================`);

  const normalizedQuery = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1️⃣ Catálogo local interno
  const localMatches = GUINEA_BISSAU_BAIRROS.filter(item => {
    const normDesc = item.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normDesc.includes(normalizedQuery);
  });

  setIsSearchingMapbox(true);

  try {
    // 2️⃣ Photon OSM: Parâmetros corrigidos para evitar Erro 400 (removeu zoom e lang=pt)
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&lat=${BISSAU_CENTER.latitude}&lon=${BISSAU_CENTER.longitude}&limit=15`;

    // 3️⃣ OpenStreetMap Nominatim: Com área delimitada da Guiné-Bissau (viewbox)
    const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&countrycodes=gw&viewbox=-15.85,11.70,-15.40,12.05&bounded=0&format=json&addressdetails=1&limit=10`;

    // 4️⃣ Mapbox Geocoding: Com suporte a POIs, endereços e bairros
    const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?country=gw&proximity=${BISSAU_CENTER.longitude},${BISSAU_CENTER.latitude}&types=poi,address,neighborhood,locality,place,street&autocomplete=true&limit=10&language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;

    const [resPhoton, resOsm, resMapbox] = await Promise.allSettled([
      fetch(photonUrl),
      fetch(osmUrl, {
        headers: {
          'User-Agent': 'NoBai245-App/1.0 (contact@nobai245.com)',
          'Accept-Language': 'pt,fr,en'
        }
      }),
      fetch(mapboxUrl)
    ]);

    let apiResults: MapboxGeocodingFeature[] = [];

    // 📌 Motor 1: Photon OSM (Autocompletar de Avenidas, Bares, Hotéis e Vias)
    if (resPhoton.status === 'fulfilled' && resPhoton.value.ok) {
      const photonData = await resPhoton.value.json();
      const features = photonData?.features || [];
      console.log(`✅ [PHOTON OSM] Status 200 OK | Encontrados: ${features.length} itens`);

      const photonFeatures = features
        .filter((f: any) => {
          const country = f.properties?.country || '';
          return !country || country.toLowerCase().includes('guine') || country.toLowerCase().includes('bissau');
        })
        .map((f: any) => {
          const p = f.properties;
          const name = p.name || p.street || p.district || 'Local';
          const city = p.city || p.district || p.county || 'Bissau';
          const fullDesc = p.street && p.name && p.name !== p.street 
            ? `${p.name}, ${p.street} (${city})`
            : `${name}, ${city}`;

          return {
            id: `photon_${p.osm_id || Math.random()}`,
            description: fullDesc.replace(/, Guiné-Bissau/gi, '').replace(/, Guinea-Bissau/gi, ''),
            longitude: f.geometry.coordinates[0],
            latitude: f.geometry.coordinates[1],
            isLocalBairro: false,
          };
        });
      apiResults.push(...photonFeatures);
    } else if (resPhoton.status === 'fulfilled') {
      console.warn(`❌ [PHOTON OSM] Código HTTP: ${resPhoton.value.status}`);
    }

    // 📌 Motor 2: OpenStreetMap Nominatim
    if (resOsm.status === 'fulfilled' && resOsm.value.ok) {
      const osmData = await resOsm.value.json();
      if (Array.isArray(osmData)) {
        console.log(`✅ [NOMINATIM OSM] Status 200 OK | Encontrados: ${osmData.length} itens`);
        const osmFeatures = osmData.map((item: any) => ({
          id: `osm_${item.place_id}`,
          description: (item.display_name || '').split(',').slice(0, 3).join(', ').replace(/, Guiné-Bissau/gi, ''),
          longitude: parseFloat(item.lon),
          latitude: parseFloat(item.lat),
          isLocalBairro: false,
        }));
        apiResults.push(...osmFeatures);
      }
    }

    // 📌 Motor 3: Mapbox Geocoding
    if (resMapbox.status === 'fulfilled' && resMapbox.value.ok) {
      const mapboxData = await resMapbox.value.json();
      const features = mapboxData?.features || [];
      console.log(`✅ [MAPBOX API] Status 200 OK | Encontrados: ${features.length} itens`);

      if (Array.isArray(features)) {
        const mapboxFeatures = features.map((f: any) => ({
          id: f.id,
          description: (f.place_name || f.text || '').replace(/, Guiné-Bissau/gi, ''),
          longitude: f.center[0],
          latitude: f.center[1],
          isLocalBairro: false,
        }));
        apiResults.push(...mapboxFeatures);
      }
    }

    if (isMountedRef.current) {
      const combined = [...localMatches, ...apiResults];
      const uniqueResults = combined.filter((v, i, a) => 
        v.latitude && v.longitude &&
        a.findIndex(t => t.description.toLowerCase().trim() === v.description.toLowerCase().trim()) === i
      );

      console.log(`📊 [RESULTADO FINAL] Total de locais carregados: ${uniqueResults.length}`);
      setSearchResults(uniqueResults.length > 0 ? uniqueResults : localMatches);
    }
  } catch (e) {
    console.error('💥 [ERRO NA BUSCA]:', e);
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

      // Guarda sempre a posição real do passageiro no mapa
      setPassengerLocation(location);

      // 🛡️ SÓ SOBRESCREVE O PONTO DE EMBARQUE SE O USUÁRIO NÃO TIVER DIGITADO OU SELECIONADO UM ENDEREÇO MANUALMENTE
      if (!isManualPickupRef.current) {
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
                
                if (!isManualPickupRef.current) {
                  setPickupAddress(cleanAddress);
                }
              }
            }
          } catch (gErr) {
            console.warn('Geocodificação reversa falhou:', gErr);
            if (!isManualPickupRef.current) setPickupAddress('Bissau, Centro');
          }
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
        // 🛡️ Garante que solicita o estado assim que a reconexão for concluída
        setTimeout(() => {
          if (socket.connected) {
            socket.emit('passenger:request_state');
          }
        }, 800);
      } else {
        socket.emit('passenger:request_state');
      }
    }
  });
  
  return () => subscription.remove();
}, [getCurrentLocationWithFallback]);
useEffect(() => {
  const currentLat = pickupCoords?.latitude || passengerLocation?.coords?.latitude;
  const currentLng = pickupCoords?.longitude || passengerLocation?.coords?.longitude;

  if (!currentLat || !currentLng) return;

  const fetchNearby = async () => {
    try {
      const response = await api.get('/passengers/drivers/nearby', {
        params: { lat: currentLat, lng: currentLng }
      });
      setNearbyDrivers(response.data?.drivers || []);
    } catch (err) {
      console.warn('Erro ao carregar motoristas próximos:', err);
    }
  };

  fetchNearby();
  const interval = setInterval(fetchNearby, 5000);
  return () => clearInterval(interval);
}, [pickupCoords, passengerLocation]);
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
            if (['accepted', 'arrived', 'in_progress', 'searching'].includes(currentStatus)) {
              return currentStatus;
            }
            return 'idle';
          });
          return;
        }

        if (data?.hasActiveRide && data?.ride) {
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
          setActiveRideId(data.ride.id);
          activeRideIdRef.current = data.ride.id;

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
              carColor: data.ride.carColor || data.ride.vehicleColor || data.ride.color || 'BRANCO', 
              vehicleType: data.ride.vehicleType || data.ride.vehicle_type || 'PARTICULAR',
              licensePlate: data.ride.licensePlate || data.ride.plate,
              rating: data.ride.driverRating || 5.0,
              phone: data.ride.driverPhone,
              startOtp: otpCode,
            });
          }
        }
      } catch (err) {
        console.error('Erro ao processar estado recuperado:', err);
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
        carColor: data.carColor || data.vehicleColor || data.color || 'BRANCO', 
        vehicleType: data.vehicleType || data.vehicle_type || 'PARTICULAR',
        licensePlate: data.licensePlate || data.plate,
        rating: data.driverRating || 5.0,
        phone: data.driverPhone,
        startOtp: otpCode,
      });
      setAcceptedAt(new Date());
      setRideStatus('accepted');
      persistRideState(data.rideId, 'accepted');

      Alert.alert(
        t('ride_accepted_title', 'Corrida Aceita! 🚗'), 
        `${data.driverName || 'O motorista'} ${t('ride_accepted_msg', 'aceitou sua viagem e está a caminho.')}`
      );
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
// 🚗 Callback para atualizar a posição em tempo real do motorista no mapa
const handleDriverPosition = (data: any) => {
  if (!isMountedRef.current || !data) return;
  const lat = Number(data.latitude ?? data.lat);
  const lng = Number(data.longitude ?? data.lng);

  if (!isNaN(lat) && !isNaN(lng)) {
    setDriverLocation({
      latitude: lat,
      longitude: lng,
      heading: typeof data.heading === 'number' ? data.heading : 0,
    });
  }
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

  // Se o endereço foi digitado/selecionado manualmente via busca e o usuário NÃO arrastou o mapa com o dedo,
  // mantém o endereço digitado sem sobrescrever com o endereço da geocodificação do GPS.
  if (isManualPickupRef.current) return;

  const coords = feature?.geometry?.coordinates;
  if (!coords || !Array.isArray(coords) || coords.length < 2) return;

  const [lng, lat] = coords;
  if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) return;

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
  const handleResetToMyGps = () => {
    // 🔓 DESATRAVA A TRAVA MANUAL E VOLTA PRO GPS REAL
    isManualPickupRef.current = false;
    getCurrentLocationWithFallback();
  };
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

    // Usa a URL base configurada no .env
    const apiDomain = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
    const trackingUrl = `${apiDomain}/track/${activeRideId}`;

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
  // Função acionada quando o usuário clica em um endereço da lista de busca
  const handleSelectSearchResult = (address: string, coords: { latitude: number; longitude: number }) => {
    if (searchType === 'pickup') {
      // 🔒 ATIVA A TRAVA MANUAL: O GPS e o mapa não vão mais apagar o endereço digitado!
      isManualPickupRef.current = true;
      setPickupAddress(address);
      setPickupCoords(coords);
    } else if (searchType === 'dropoff') {
      setDropoffAddress(address);
      setDropoffCoords(coords);
      setBookingStep('SERVICE_AND_PRICE');
    } else if (searchType === 'extraStop') {
      setExtraStopAddress(address);
      setExtraStopCoords(coords);
    }

    setIsSearchModalVisible(false);
  };
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
      <View style={[styles.loadingContainer, { paddingTop: Math.max(insets?.top || 0, 40), paddingBottom: Math.max(insets?.bottom || 0, 20) }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError || t('getting_location', 'Obtendo localização exata...')}</Text>
        {locationError && (
          <TouchableOpacity 
            style={styles.retryLocationBtn} 
            onPress={getCurrentLocationWithFallback}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>{t('try_again', 'Tentar Novamente')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

 if (locationError && !passengerLocation) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: Math.max(insets?.top || 0, 40), paddingBottom: Math.max(insets?.bottom || 0, 20) }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError || t('getting_location', 'Obtendo localização exata...')}</Text>
        {locationError && (
          <TouchableOpacity 
            style={styles.retryLocationBtn} 
            onPress={getCurrentLocationWithFallback}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>{t('try_again', 'Tentar Novamente')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const activeOtpPin = String(startOtp || driverInfo?.startOtp || '');
  const topHeaderInset = Math.max((insets?.top || 0) + 12, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* 1. HEADER FLUTUANTE */}
      <View style={[styles.floatingHeader, { top: topHeaderInset }]}>
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
                <Ionicons name="person" size={18} color="#0F172A" />
              )}
            </View>
            <Text style={styles.greetingText}>
              {t('greeting', 'Olá')}, {user?.fullName ? user.fullName.split(' ')[0] : t('passenger', 'Passageiro')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.langHeaderBtn} 
            onPress={() => setLangModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.langHeaderBtnText}>{i18n.language?.toUpperCase() || 'PT'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuIcon} activeOpacity={0.7} onPress={() => setIsMenuVisible(true)}>
            <Ionicons name="menu" size={22} color="#EAB308" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. MAPA DE NAVEGAÇÃO MAPBOX */}
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
        onCameraChanged={(e) => {
          if (e.gestures.isGestureActive) {
            setIsMapMoving(true);
            isManualPickupRef.current = false;
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
                lineColor: '#EAB308',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* 🚗 MARCADORES DOS MOTORISTAS ONLINE PRÓXIMOS */}
{nearbyDrivers && nearbyDrivers.map((driver: any) => (
  <Mapbox.PointAnnotation
    key={`online-driver-${driver.id}`}
    id={`online-driver-${driver.id}`}
    coordinate={[Number(driver.lng), Number(driver.lat)]}
  >
    <View style={styles.driverMarkerWrapper}>
      <Image
        source={getVehicle3DIconAsset(driver.vehicleType || 'TAXI', driver.carColor || 'AMARELO')}
        style={[
          styles.driverMarkerImage,
          { transform: [{ rotate: `${driver.heading || 0}deg` }] }
        ]}
        resizeMode="contain"
      />
    </View>
  </Mapbox.PointAnnotation>
))}
        {/* 📍 PONTO DE EMBARQUE */}
{(pickupCoords?.latitude != null && pickupCoords?.longitude != null) && (
  <Mapbox.PointAnnotation 
    id="pickupPoint" 
    coordinate={[
      Number(pickupCoords.longitude), 
      Number(pickupCoords.latitude)
    ]}
  >
    <View style={styles.pickupMarker}>
      <Ionicons name="pin" size={22} color="#EAB308" />
    </View>
  </Mapbox.PointAnnotation>
)}
        {/* 🔵 PARADA EXTRA */}
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

        {/* 🚩 DESTINO FINAL */}
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

        {/* 🏎️ MOTORISTA EM MOVIMENTO (CORRIDA ACEITA) */}
        {driverLocation?.latitude != null && driverLocation?.longitude != null && (
          <Mapbox.PointAnnotation
            id="driverMarker"
            coordinate={[Number(driverLocation.longitude), Number(driverLocation.latitude)]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View 
              style={[
                styles.vehicle3DContainer, 
                { transform: [{ rotate: `${driverLocation.heading || 0}deg` }] }
              ]}
            >
              <Image
                source={getVehicle3DIconAsset(
                  driverInfo?.vehicleType || vehicleType,
                  driverInfo?.carColor
                )}
                style={styles.vehicle3DImage}
                fadeDuration={0}
                resizeMode="contain"
              />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* 📡 ONDAS DE RADAR DE BUSCA */}
      {isSearchingRide && (
        <SearchingRadarPulse statusText="Procurando motorista Nô Bai próximo..." />
      )}

      {/* PINO CENTRAL FLUTUANTE */}
      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.centerPinContainer} pointerEvents="none">
          <Animated.View style={[styles.centerPin, isMapMoving && { transform: [{ translateY: -10 }] }]}>
            <Ionicons name="location" size={36} color="#EAB308" />
          </Animated.View>
          <View style={styles.pinShadow} />
        </View>
      )}

      {/* BOTÃO RECENTRALIZAR */}
      <TouchableOpacity 
        style={[styles.recenterButton, { bottom: Math.max((insets?.bottom || 0) + 260, 270) }]} 
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
        <Ionicons name="locate" size={22} color="#EAB308" />
      </TouchableOpacity>

      {/* ATALHOS FAVORITOS */}
      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={[styles.favoritesContainer, { top: topHeaderInset + 68 }]}>
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

      {/* BADGE DE SEGURANÇA NOTURNO */}
      {isNightTimeForPin() && Boolean(activeOtpPin) && ['accepted', 'arrived'].includes(rideStatus) && (
        <View style={[styles.pinSecurityBadge, { top: topHeaderInset + 68 }]}>
          <Ionicons name="shield-checkmark" size={20} color="#EAB308" />
          <View style={styles.pinSecurityTextContainer}>
            <Text style={styles.pinSecurityTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
            <Text style={styles.pinSecuritySub}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
          </View>
          <View style={styles.pinCodeBox}>
            <Text style={styles.pinCodeText}>{activeOtpPin}</Text>
          </View>
        </View>
      )}

      {/* 3. PAINEL SLIDING BOTTOM SHEET */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={styles.bottomSheetWrapper} 
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.bottomSheet, { transform: [{ translateY }], paddingBottom: Math.max((insets?.bottom || 0) + 12, 20) }]}>
          
          <View style={styles.dragHandlerArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicator} />
          </View>

          <ScrollView 
            nestedScrollEnabled 
            showsVerticalScrollIndicator={false} 
            keyboardShouldPersistTaps="handled" 
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
          >
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
                  <TouchableOpacity style={[styles.requestButton, { backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155' }]} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                    <Text style={[styles.requestButtonText, { color: '#EAB308' }]}>{t('where_do_you_want_to_go', 'Aonde você quer ir?')}</Text>
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
                    <Ionicons name="car-outline" size={18} color={serviceType === 'viagem' ? '#0F172A' : '#94A3B8'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'viagem' && styles.serviceTypeTextActive]}>{t('ride_service', 'Viagem')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'entrega' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('entrega')}
                  >
                    <Ionicons name="cube-outline" size={18} color={serviceType === 'entrega' ? '#0F172A' : '#94A3B8'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'entrega' && styles.serviceTypeTextActive]}>{t('delivery_service', 'Entrega')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'aluguel' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('aluguel')}
                  >
                    <Ionicons name="key-outline" size={18} color={serviceType === 'aluguel' ? '#0F172A' : '#94A3B8'} />
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
                      <Text style={[styles.categoryPriceText, styles.categoryPriceTextActive, { color: '#10B981' }]}>
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

            {/* 💳 SELEÇÃO DE FORMA DE PAGAMENTO (APENAS ORANGE MONEY E DINHEIRO) */}
{rideStatus === 'idle' && bookingStep === 'PAYMENT' && (
  <View style={{ width: '100%' }}>
    <Text style={styles.sectionLabel}>{t('payment_method', 'Forma de Pagamento')}</Text>
    <View style={styles.paymentOptionsContainer}>
      
      {/* ORANGE MONEY */}
      <TouchableOpacity 
        style={[styles.paymentBtn, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnActive]}
        onPress={() => setPaymentMethod('ORANGE_MONEY')}
        activeOpacity={0.8}
      >
        <Ionicons name="phone-portrait-outline" size={18} color={paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#94A3B8'} />
        <Text style={[styles.paymentBtnText, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnTextActive]}>Orange Money</Text>
      </TouchableOpacity>

      {/* DINHEIRO */}
      <TouchableOpacity 
        style={[styles.paymentBtn, paymentMethod === 'CASH' && styles.paymentBtnActive]}
        onPress={() => setPaymentMethod('CASH')}
        activeOpacity={0.8}
      >
        <Ionicons name="cash-outline" size={18} color={paymentMethod === 'CASH' ? '#10B981' : '#94A3B8'} />
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
                    source={getVehicleImage(driverInfo?.vehicleType || vehicleType)} 
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
                    <Ionicons name="call" size={18} color="#EAB308" />
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

      {/* 4. MODAIS DO SISTEMA */}
      {/* MODAL DE IDIOMAS */}
      <Modal visible={langModalVisible} transparent animationType="slide" onRequestClose={() => setLangModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlayInner}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.modalContainer, { paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
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
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL DE PERMISSÃO DE GPS */}
      <Modal visible={isLocationSettingsVisible} animationType="slide" transparent onRequestClose={() => setIsLocationSettingsVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlayInner}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.locationModalCard, { paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
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
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL DE CONVIDADO / TERCEIROS */}
      <Modal visible={isGuestModalVisible} transparent animationType="slide" onRequestClose={() => setIsGuestModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlayInner}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.locationModalCard, { paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
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
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL DE PAGAMENTO MOBILE MONEY */}
      <Modal 
        visible={isPaymentModalVisible} 
        transparent 
        animationType="slide" 
        onRequestClose={() => !isProcessingPayment && setIsPaymentModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.paymentModalCard, { paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
                  <View style={[styles.operatorHeader, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#FFCC00' }]}>
                    <Ionicons name="phone-portrait-sharp" size={24} color={paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000'} />
                    <Text style={[styles.operatorTitle, { color: paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000' }]}>
                      {paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : 'MTN Mobile Money'}
                    </Text>
                  </View>

                  <ScrollView 
                    style={styles.paymentModalBody} 
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }} 
                    showsVerticalScrollIndicator={false} 
                    keyboardShouldPersistTaps="handled"
                  >
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
                      <TextInput
                        style={[styles.phoneInput, { paddingLeft: 12 }]}
                        value={paymentPhone}
                        onChangeText={setPaymentPhone}
                        keyboardType="phone-pad"
                        editable={!isProcessingPayment}
                        placeholder={t('phone_number_placeholder', 'Ex: 955000000')}
                        placeholderTextColor="#64748B"
                      />
                    </View>

                    <View style={styles.modalActionsRow}>
                      <TouchableOpacity 
                        style={styles.cancelModalBtn} 
                        disabled={isProcessingPayment} 
                        onPress={() => setIsPaymentModalVisible(false)} 
                        activeOpacity={0.8}
                      >
                        <Text style={styles.cancelModalBtnText}>{t('back_btn', 'Cancelar')}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity 
                        style={[styles.confirmModalBtn, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#004F9F' }]}
                        disabled={isProcessingPayment}
                        onPress={confirmPaymentAndRide}
                        activeOpacity={0.85}
                      >
                        {isProcessingPayment ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Text style={styles.confirmModalBtnText}>{t('confirm_payment_btn', 'Confirmar Solicitação')}</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MENU LATERAL */}
      <Modal visible={isMenuVisible} animationType="fade" transparent onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <View style={[styles.menuDrawer, { paddingTop: Math.max((insets?.top || 0) + 16, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 20), paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
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
              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('Profile'); }} activeOpacity={0.7}>
                <Ionicons name="person-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_profile', 'Meu Perfil')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('RideHistory'); }} activeOpacity={0.7}>
                <Ionicons name="time-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_rides', 'Minhas Corridas')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('EmergencyContacts'); }} activeOpacity={0.7}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('HelpCenter'); }} activeOpacity={0.7}>
                <Ionicons name="help-buoy-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('help_center', 'Central de Ajuda')}</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); signOut(); }} activeOpacity={0.7}>
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{t('logout', 'Sair da Conta')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* CHAT INTERNO */}
      <Modal 
        visible={isChatVisible} 
        animationType="slide" 
        transparent 
        statusBarTranslucent
        onRequestClose={() => setIsChatVisible(false)}
      >
        <KeyboardAvoidingView 
          style={styles.chatOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.chatContainer, { paddingTop: Math.max((insets?.top || 0) + 10, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 16) }]}>
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderUserInfo}>
                {driverInfo?.photoUrl || driverInfo?.profilePicture ? (
                  <Image source={{ uri: formatPhotoUrl(driverInfo.photoUrl || driverInfo.profilePicture) }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarPlaceholder}>
                    <Ionicons name="person" size={18} color="#64748B" />
                  </View>
                )}
                <Text style={styles.chatTitle}>
                  {t('chat_with', 'Chat com')} {driverInfo?.name || 'Motorista'}
                </Text>
              </View>

              <TouchableOpacity onPress={() => setIsChatVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={chatFlatListRef}
              data={messages}
              keyExtractor={(item, index) => item.id || `msg-${index}`}
              contentContainerStyle={styles.chatList}
              keyboardShouldPersistTaps="handled"
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

            <View style={[styles.chatInputContainer, { paddingBottom: Math.max((insets?.bottom || 0) + 8, 12) }]}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('type_something', 'Escreva algo...')}
                placeholderTextColor="#94A3B8"
                multiline
                maxLength={250}
              />
              <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage} activeOpacity={0.85}>
                <Ionicons name="send" size={16} color="#0F172A" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL DE BUSCA DE ENDEREÇO MAPBOX */}
      <Modal visible={isSearchModalVisible} animationType="slide" transparent={false} onRequestClose={() => setIsSearchModalVisible(false)}>
        <SafeAreaView style={styles.searchModalContainer}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={styles.searchHeader}>
              <TouchableOpacity onPress={() => setIsSearchModalVisible(false)} style={styles.backButton} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={22} color="#0F172A" />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.passengerSelector} onPress={() => setIsGuestModalVisible(true)} activeOpacity={0.8}>
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
                    activeOpacity={0.7}
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

      {/* MODAL DE CANCELAMENTO */}
      <CancelModal
        visible={showCancelModal}
        userType="PASSENGER"
        isPenaltyApplicable={checkPenaltyApplicable()}
        onClose={handleCloseCancelModal} 
        onConfirm={handleConfirmCancel} 
      />

      {/* MODAL DE AVALIAÇÃO */}
      <RatingModal
        visible={showRatingModal}
        targetName={driverInfo?.name || 'Motorista'}
        onSubmit={handleSubmitRating} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#0F172A' 
  },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#0F172A', 
    paddingHorizontal: 20 
  },
  loadingText: { 
    color: '#F8FAFC', 
    fontSize: 15, 
    fontWeight: '600', 
    marginTop: 16, 
    textAlign: 'center' 
  },
  retryLocationBtn: { 
    marginTop: 20, 
    backgroundColor: '#EAB308', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 10 
  },
  
  // 🏎️ ESTILOS DO VEÍCULO 3D COM ROTAÇÃO DE RUA NO MAPA
  vehicle3DContainer: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  vehicle3DImage: {
    width: 44,
    height: 44,
    resizeMode: 'contain',
  },

  // MARCADORES E PINOS
  carMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0F172A',
    elevation: 4,
  },
  driverMarkerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  centerPinContainer: {
    position: 'absolute',
    top: '44%',
    left: '50%',
    marginLeft: -18,
    marginTop: -36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinShadow: {
    width: 10,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 5,
    marginTop: -4,
  },
  recenterButton: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#0F172A',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 5,
  },

  // CABEÇALHO FLUTUANTE
  floatingHeader: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 6,
  },
  headerUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  greetingText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  langHeaderBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    marginRight: 8,
  },
  langHeaderBtnText: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '800',
  },
  menuIcon: {
    padding: 6,
  },

  // FAVORITOS E PIN DE SEGURANÇA
  favoritesContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 9,
  },
  favoriteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  favoriteIconBg: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  favoriteText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  pinSecurityBadge: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAB308',
    zIndex: 9,
  },
  pinSecurityTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  pinSecurityTitle: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '800',
  },
  pinSecuritySub: {
    color: '#94A3B8',
    fontSize: 10,
  },
  pinCodeBox: {
    backgroundColor: '#FEF08A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pinCodeText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },

  // SLIDING BOTTOM SHEET
  bottomSheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomSheet: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderColor: '#334155',
    elevation: 20,
  },
  dragHandlerArea: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#475569',
    borderRadius: 2,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 12,
  },
  mainSearchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  mainSearchText: {
    color: '#94A3B8',
    fontSize: 14,
    flex: 1,
  },
  requestButton: {
    backgroundColor: '#EAB308',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },

  // SERVIÇOS E VEÍCULOS
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  serviceTypesContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  serviceTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  serviceTypeActive: {
    backgroundColor: '#EAB308',
    borderColor: '#EAB308',
  },
  serviceTypeText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  serviceTypeTextActive: {
    color: '#0F172A',
  },
  vehicleCategoryContainer: {
    gap: 8,
    marginBottom: 12,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoryCardActive: {
    borderColor: '#EAB308',
    backgroundColor: '#1E293B',
  },
  vehicleImage: {
    width: 44,
    height: 44,
    marginRight: 10,
  },
  categoryTextWrapper: {
    flex: 1,
  },
  categoryTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  categoryTextActive: {
    color: '#EAB308',
  },
  categorySubtitle: {
    color: '#64748B',
    fontSize: 11,
  },
  categoryPriceText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  categoryPriceTextActive: {
    color: '#EAB308',
    fontSize: 14,
    fontWeight: '800',
  },
  referenceContainer: {
    marginBottom: 12,
  },
  referenceInput: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonOutline: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonOutlineText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },

  // PAGAMENTOS E CARDS DO MOTORISTA
  paymentOptionsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  paymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  paymentBtnActive: {
    borderColor: '#EAB308',
  },
  paymentBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  paymentBtnTextActive: {
    color: '#F8FAFC',
    fontWeight: '800',
  },
  pinCardContainer: {
    backgroundColor: '#064E3B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  pinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  pinTitle: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  pinSubtitle: {
    color: '#A7F3D0',
    fontSize: 11,
    marginBottom: 8,
  },
  pinDigitsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  pinDigitBox: {
    backgroundColor: '#022C22',
    width: 38,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#059669',
  },
  pinDigitText: {
    color: '#A7F3D0',
    fontSize: 20,
    fontWeight: '900',
  },
  statusBox: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  statusTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  statusSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  driverCardContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  driverMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverAvatarProfile: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#334155',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  driverRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  driverRatingText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '700',
  },
  dividerLight: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 10,
  },
  vehicleShowcase: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  showcaseVehicleImg: {
    width: 50,
    height: 36,
    marginRight: 10,
  },
  vehicleDetailsCol: {
    flex: 1,
  },
  vehicleModelText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  colorAndPlateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  modernColorChip: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#64748B',
  },
  vehicleColorText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#64748B',
    marginHorizontal: 8,
  },
  modernPlateBadge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#475569',
  },
  modernPlateText: {
    color: '#EAB308',
    fontSize: 10,
    fontWeight: '800',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF08A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  statusBannerText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  shareButton: {
    padding: 4,
  },
  iconCircleButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 8,
  },
  sosButton: {
    borderColor: '#EF4444',
  },

  // MODAIS
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalOverlayInner: {
    width: '100%',
  },
  modalContainer: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  langOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  langOptionText: {
    color: '#F8FAFC',
    fontSize: 14,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 10,
  },
  locationModalCard: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  locationIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEF08A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  locationModalTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  locationModalText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },

  // MODAL DE PAGAMENTO
  paymentModalCard: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  operatorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: 8,
  },
  operatorTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  paymentModalBody: {
    padding: 20,
  },
  paymentModalSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  amountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  amountTextLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  amountValue: {
    color: '#EAB308',
    fontSize: 16,
    fontWeight: '900',
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  phoneInputContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  phoneInput: {
    color: '#F8FAFC',
    fontSize: 15,
    paddingVertical: 12,
    fontWeight: '700',
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cancelModalBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#475569',
  },
  cancelModalBtnText: {
    color: '#94A3B8',
    fontWeight: '700',
  },
  confirmModalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmModalBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  // MENU LATERAL DRAWER
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  menuDrawer: {
    width: '78%',
    height: '100%',
    backgroundColor: '#0F172A',
    paddingHorizontal: 20,
    borderRightWidth: 1,
    borderColor: '#334155',
  },
  menuHeader: {
    marginBottom: 24,
  },
  avatarPlaceholderLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  menuUserName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  menuUserPhone: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  menuItems: {
    gap: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  menuItemText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 10,
  },

  // CHAT INTERNO
  chatOverlay: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  chatContainer: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  chatHeaderUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  headerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
  },
  chatList: {
    padding: 16,
    gap: 12,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  rowPassenger: {
    justifyContent: 'flex-end',
  },
  rowDriver: {
    justifyContent: 'flex-start',
  },
  chatBubbleAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  chatBubbleAvatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  messagePassenger: {
    backgroundColor: '#EAB308',
    borderBottomRightRadius: 2,
  },
  messageDriver: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 2,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 18,
  },
  textPassenger: {
    color: '#0F172A',
    fontWeight: '600',
  },
  textDriver: {
    color: '#F8FAFC',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: '#F8FAFC',
    fontSize: 13,
    maxHeight: 100,
  },
  chatSendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAB308',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // BUSCA MAPBOX
  searchModalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    padding: 4,
  },
  passengerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  passengerSelectorText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },
  mapboxSearchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  mapboxSearchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  searchResultText: {
    color: '#F8FAFC',
    fontSize: 13,
    flex: 1,
  },
  // 🏎️ Adicione dentro do StyleSheet.create se ainda não estiver presente:
vehicle3DContainer: {
  width: 48,
  height: 48,
  justifyContent: 'center',
  alignItems: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.35,
  shadowRadius: 5,
  elevation: 6,
},
vehicle3DImage: {
  width: 44,
  height: 44,
  resizeMode: 'contain',
},
driverMarkerWrapper: {
  width: 36,
  height: 36,
  justifyContent: 'center',
  alignItems: 'center',
},
driverMarkerImage: {
  width: 32,
  height: 32,
},
pickupMarker: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: '#0F172A',
  borderWidth: 2,
  borderColor: '#EAB308',
  justifyContent: 'center',
  alignItems: 'center',
},
});