import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, Alert, 
  Platform, StatusBar, BackHandler, Linking, Vibration,
  Share, AppState, KeyboardAvoidingView, Modal, TextInput, 
  ActivityIndicator, Image, Animated, PanResponder, Dimensions, 
  ScrollView, TouchableWithoutFeedback, Keyboard, Easing
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';

import { useAuth } from '../contexts/AuthContext';
import { 
  socket, 
  connectPassengerSocket, 
  requestRide as emitRequestRide,  
  cancelRideByPassenger, 
  rateDriver 
} from '../services/passengerSocket';
import { CancelModal } from '../components/CancelModal';
import { RatingModal } from '../components/RatingModal';
import { ChatModal } from '../components/ChatModal';
import { api } from '../services/api';
import { registerAndSendPushToken } from '../services/notifications';
import { updateOngoingRideNotification, dismissOngoingRideNotification } from '../services/ongoingNotification';
import { speakRideStatusUpdate, speakText, triggerHapticFeedback } from '../utils/accessibility';

// Token Mapbox
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_KEY || 'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZTRyc3NmMDBzMTJ5cTA1anJvYjFsOSJ9.pUAoGXwZS8FtYNr85VD1TA';
if (MAPBOX_ACCESS_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
}

const STORAGE_RIDE_KEY = '@bai245:active_ride_state';
const STORAGE_FAVORITES_KEY = '@bai245:favorite_places';
const STORAGE_RECENT_SEARCHES_KEY = '@bai245:recent_searches';
const STORAGE_GLOW_BORDER_KEY = '@bai245:border_glow_enabled';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const BISSAU_CENTER = { latitude: 11.8636, longitude: -15.5977 };

export type RideStatus = 'idle' | 'searching' | 'queued' | 'accepted' | 'arrived' | 'in_progress' | 'completed';
export type BookingStep = 'ADDRESS' | 'SERVICE_AND_PRICE' | 'PAYMENT' | 'SEARCHING';
export type VehicleType = 'moto' | 'taxi' | 'moto-carro' | 'particular';
export type ServiceType = 'viagem' | 'entrega' | 'aluguel';
export type PaymentMethod = 'CASH'; // 🟢 FIXADO EXCLUSIVAMENTE PARA DINHEIRO EM ESPÉCIE
export type RegionType = 'BISSAU' | 'PRABIS' | 'QUINHAMEL' | 'SURU' | 'BAFATA' | 'GABU';

export interface RideStop {
  address: string;
  latitude: number;
  longitude: number;
  status?: string;
}

interface FavoritePlace {
  address: string;
  latitude: number;
  longitude: number;
}

interface ChatMessage { 
  id: string; 
  sender: 'passenger' | 'driver'; 
  text?: string; 
  audioUrl?: string | null;
  audioDuration?: number;
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

// Catálogo ampliado de Bairros e Pontos de Referência de Guiné-Bissau
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

const RENTAL_PRICES: Record<RegionType, { label: string; description: string; price: number }> = {
  BISSAU: { label: 'Setor Autónomo de Bissau', description: 'Uso urbano em toda a capital', price: 25000 },
  PRABIS: { label: 'Prabis', description: 'Rota Bissau - Prabis', price: 35000 },
  QUINHAMEL: { label: 'Quinhamel', description: 'Rota Bissau - Quinhamel', price: 40000 },
  SURU: { label: 'Suru', description: 'Rota Bissau - Suru', price: 45000 },
  BAFATA: { label: 'Bafatá', description: 'Viagem interurbana Bissau - Bafatá', price: 75000 },
  GABU: { label: 'Gabú', description: 'Viagem interurbana Bissau - Gabú', price: 90000 },
};

const formatPhotoUrl = (path?: string) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${cleanBase}${cleanPath}`;
  return fullUrl;
};

const isNightTimeForPin = () => {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6;
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

const normalizeVehicleType = (type?: string): string => {
  if (!type) return 'particular';
  const clean = type.toLowerCase().replace(/[-_]/g, '').trim();
  if (clean.includes('motocarro')) return 'moto-carro';
  if (clean.includes('moto')) return 'moto';
  if (clean.includes('taxi')) return 'taxi';
  if (clean.includes('toca')) return 'toca-toca';
  return 'particular';
};

// 1. Ícones do Mapa
export const getVehicle3DIconAsset = (type?: string, colorName?: string) => {
  const normType = normalizeVehicleType(type);
  const color = (colorName || 'BRANCO').toUpperCase().trim();

  if (normType === 'moto') {
    return require('../../assets/images/vehicles/moto.png');
  }
  if (normType === 'moto-carro' || normType === 'toca-toca' || normType === 'taxi') {
    return require('../../assets/images/vehicles/car_yellow.png');
  }

  switch (color) {
    case 'BLACK': case 'PRETO': case 'ESCURO':
      return require('../../assets/images/vehicles/car_black.png');
    case 'BLUE': case 'AZUL':
      return require('../../assets/images/vehicles/car_blue.png');
    case 'RED': case 'VERMELHO': case 'VINHO':
      return require('../../assets/images/vehicles/car_red.png');
    case 'YELLOW': case 'AMARELO': case 'DOURADO':
      return require('../../assets/images/vehicles/car_yellow.png');
    case 'GRAY': case 'SILVER': case 'CINZA': case 'PRATA':
      return require('../../assets/images/vehicles/car_gray.png');
    case 'WHITE': case 'BRANCO':
    default:
      return require('../../assets/images/vehicles/car_white.png');
  }
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

// 🌟 COMPONENTE SKELETON LOADER PARA ANIMAÇÕES DE CARREGAMENTO SUAVES
const SkeletonLoader: React.FC<{ width?: any; height?: number; borderRadius?: number; style?: any }> = ({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style,
}) => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: '#334155',
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
};

// ⚡ COMPONENTE DE BOTÃO COM EFEITO DE RAIO LUMINOSO CONTINUO E DESATIVÁVEL
interface GlowingButtonProps {
  onPress: () => void;
  style?: any;
  textStyle?: any;
  title: string;
  icon?: string;
  isGlowEnabled?: boolean;
  gradientColors?: string[];
  disabled?: boolean;
  activeOpacity?: number;
}

const GlowingButton: React.FC<GlowingButtonProps> = ({
  onPress,
  style,
  textStyle,
  title,
  icon,
  isGlowEnabled = true,
  gradientColors = ['#FACC15', '#EAB308', '#CA8A04'],
  disabled = false,
  activeOpacity = 0.85,
}) => {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isGlowEnabled) {
      const animation = Animated.loop(
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2400,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animation.start();
      return () => animation.stop();
    } else {
      glowAnim.setValue(0);
    }
  }, [isGlowEnabled, glowAnim]);

  const borderOpacity = glowAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 1, 0.3],
  });

  const borderScale = glowAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.02, 1],
  });

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <View style={[{ position: 'relative', borderRadius: 14 }, style]}>
      {isGlowEnabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: 16,
              borderWidth: 2,
              borderColor: '#FFFFFF',
              opacity: borderOpacity,
              transform: [{ scale: borderScale }],
              shadowColor: '#FFFFFF',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.9,
              shadowRadius: 8,
              elevation: 8,
            },
          ]}
        />
      )}
      <TouchableOpacity
        activeOpacity={activeOpacity}
        onPress={handlePress}
        disabled={disabled}
        style={{ width: '100%', height: '100%', borderRadius: 14, overflow: 'hidden' }}
      >
        <LinearGradient
          colors={gradientColors as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
          }}
        >
          {icon ? <Ionicons name={icon as any} size={20} color="#0F172A" style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.requestButtonText, textStyle]}>{title}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
};

export function Home() {
  const { user, signOut } = useAuth();
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const isMountedRef = useRef(true);
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRideIdRef = useRef<string | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const isInaccessibleAlertShowingRef = useRef(false);
  const isManualPickupRef = useRef(false);
  const isChatVisibleRef = useRef(false);
  const route = useRoute<any>();
  const radarAnim = useRef(new Animated.Value(0)).current;
  const appStateRef = useRef(AppState.currentState);
  const roadDistanceRef = useRef<number | null>(null);
  const roadDurationRef = useRef<number | null>(null);
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
  
  const [extraStopCoords, setExtraStopCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [extraStopAddress, setExtraStopAddress] = useState('');
  const [showExtraStop, setShowExtraStop] = useState(false);

  const [isForAnotherPerson, setIsForAnotherPerson] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [isGuestModalVisible, setIsGuestModalVisible] = useState(false);

  const [pickupReferencePoint, setPickupReferencePoint] = useState('');
  const [dropoffReferencePoint, setDropoffReferencePoint] = useState('');
  const [driverEta, setDriverEta] = useState<number | null>(null);
  const [extraStopReferencePoint, setExtraStopReferencePoint] = useState('');

  const [vehicleType, setVehicleType] = useState<VehicleType>('particular');
  const [serviceType, setServiceType] = useState<ServiceType>('viagem');
  const [selectedRegion] = useState<RegionType>('BISSAU');
  
  // 🟢 FORÇADO EXCLUSIVAMENTE PARA DINHEIRO (CASH)
  const [paymentMethod] = useState<PaymentMethod>('CASH');
  
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [isCalculatingPrice, setIsCalculatingPrice] = useState<boolean>(false);
  
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
  const [searchType, setSearchType] = useState<'pickup' | 'dropoff' | 'extraStop'>('dropoff');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MapboxGeocodingFeature[]>([]);
  const [isSearchingMapbox, setIsSearchingMapbox] = useState(false);
  const [isVoiceAssistEnabled, setIsVoiceAssistEnabled] = useState<boolean>(true);
  const [isBorderGlowEnabled, setIsBorderGlowEnabled] = useState<boolean>(true);
  
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const handleCloseCancelModal = useCallback(() => setShowCancelModal(false), []);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [homeLocation, setHomeLocation] = useState<FavoritePlace | null>(null);
  const [workLocation, setWorkLocation] = useState<FavoritePlace | null>(null);
  const [recentSearches, setRecentSearches] = useState<MapboxGeocodingFeature[]>([]);

  const [, setIsConnected] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocationSettingsVisible, setIsLocationSettingsVisible] = useState(false);
  const [langModalVisible, setLangModalVisible] = useState(false);

  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ id: string; lat: number; lng: number; heading?: number; vehicleType?: string; carColor?: string }>>([]);
  const [, setIsSearchingRide] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const radarScale1 = radarAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 3.2] });
  const radarOpacity1 = radarAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 0.25, 0] });
  const radarScale2 = radarAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.8, 1.8, 3.2] });
  const radarOpacity2 = radarAnim.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0, 0.5, 0.2, 0] });

  const animatedLng = useRef(new Animated.Value(driverLocation?.longitude || BISSAU_CENTER.longitude)).current;
  const animatedLat = useRef(new Animated.Value(driverLocation?.latitude || BISSAU_CENTER.latitude)).current;

  const [interpolatedCoords, setInterpolatedCoords] = useState<[number, number]>([
    driverLocation?.longitude || BISSAU_CENTER.longitude,
    driverLocation?.latitude || BISSAU_CENTER.latitude,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_GLOW_BORDER_KEY).then((val) => {
      if (val !== null) setIsBorderGlowEnabled(val === 'true');
    }).catch(() => {});
  }, []);
useEffect(() => {
    roadDistanceRef.current = null;
    roadDurationRef.current = null;
  }, [pickupCoords, dropoffCoords, extraStopCoords]);
  const toggleBorderGlow = async () => {
    const next = !isBorderGlowEnabled;
    setIsBorderGlowEnabled(next);
    triggerHapticFeedback('BUTTON_PRESS');
    try {
      await AsyncStorage.setItem(STORAGE_GLOW_BORDER_KEY, String(next));
    } catch (e) {}
  };

  const resetRideState = useCallback(() => {
    setActiveRideId(null);
    activeRideIdRef.current = null;
    setRideStatus('idle');
    setBookingStep('ADDRESS');
    setDriverInfo(null);
    setDriverLocation(null);
    setDriverEta(null);
    setStartOtp('');
    setRouteGeometry(null);
    setIsSearchingRide(false);
    
    setDropoffCoords(null);
    setDropoffAddress('');
    setPickupReferencePoint('');
    setDropoffReferencePoint('');
    setExtraStopCoords(null);
    setExtraStopAddress('');
    setExtraStopReferencePoint('');
    setShowExtraStop(false);
    setEstimatedPrice(null);
    setEstimatedDistance(null);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    AsyncStorage.removeItem(STORAGE_RIDE_KEY).catch(() => {});
  }, []);
  // 🧹 Reset Completo do Fluxo da Corrida (Retorna à tela inicial limpa "Para onde vamos?")
const handleFullCancelAndReset = useCallback(() => {
  // 1. Limpa locais de destino e paradas
  setDropoffCoords(null);
  setDropoffAddress('');
  setDropoffReferencePoint('');
  setPickupReferencePoint('');
  setExtraStopCoords(null);
  setExtraStopAddress('');
  setExtraStopReferencePoint('');
  setShowExtraStop(false);

  // 2. Limpa rota calculada e estimativa de valores
  setRouteGeometry(null);
  setEstimatedPrice(null);
  setEstimatedDistance(null);

  // 3. Reseta status de busca, corrida e etapas
  setActiveRideId(null);
  activeRideIdRef.current = null;
  setRideStatus('idle');
  setBookingStep('ADDRESS');
  setDriverInfo(null);
  setDriverLocation(null);
  setDriverEta(null);
  setStartOtp('');
  setIsSearchingRide(false);

  // 4. Limpa temporizadores e armazenamento local
  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
  AsyncStorage.removeItem(STORAGE_RIDE_KEY).catch(() => {});

  // 5. Centraliza a câmera no passageiro se a localização estiver disponível
  if (passengerLocation?.coords && cameraRef.current) {
    cameraRef.current.setCamera({
      centerCoordinate: [passengerLocation.coords.longitude, passengerLocation.coords.latitude],
      zoomLevel: 15,
      animationDuration: 800,
    });
  }
}, [passengerLocation]);
// 🟢 VEHICLE_OPTIONS movido para dentro do componente com useMemo
  const VEHICLE_OPTIONS = useMemo(() => [
    { 
      id: 'moto' as VehicleType, 
      title: 'Moto', 
      subtitle: t('moto_subtitle', 'Rápido e econômico'), 
      image: require('../../assets/images/vehicles/moto.png') 
    },
    { 
      id: 'particular' as VehicleType, 
      title: t('standard_vehicle', 'Particular'), 
      subtitle: t('particular_subtitle', 'Viagem exclusiva'), 
      image: require('../../assets/images/vehicles/car_white.png') 
    },
    { 
      id: 'taxi' as VehicleType, 
      title: 'Táxi', 
      subtitle: t('taxi_subtitle', 'Conforto e tradição'), 
      image: require('../../assets/images/vehicles/car_yellow.png') 
    },
    { 
      id: 'moto-carro' as VehicleType, 
      title: 'Moto-carro', 
      subtitle: t('motocarro_subtitle', 'Ideal para bagagens leves'), 
      image: require('../../assets/images/vehicles/car_yellow.png') 
    },
  ], [t]);
  const persistRideState = async (
    rideId: string | null, 
    status: RideStatus, 
    extraData?: {
      driverInfo?: DriverInfo | null;
      pickupCoords?: { latitude: number; longitude: number } | null;
      pickupAddress?: string;
      dropoffCoords?: { latitude: number; longitude: number } | null;
      dropoffAddress?: string;
      extraStopCoords?: { latitude: number; longitude: number } | null;
      extraStopAddress?: string;
      pickupReferencePoint?: string;
      extraStopReferencePoint?: string;
      dropoffReferencePoint?: string;
      startOtp?: string;
      estimatedPrice?: number | null;
      estimatedDistance?: number | null;
    }
  ) => {
    try {
      if (rideId && status !== 'idle' && status !== 'completed') {
        const payload = {
          rideId,
          status,
          driverInfo: extraData?.driverInfo ?? driverInfo,
          pickupCoords: extraData?.pickupCoords ?? pickupCoords,
          pickupAddress: extraData?.pickupAddress ?? pickupAddress,
          dropoffCoords: extraData?.dropoffCoords ?? dropoffCoords,
          dropoffAddress: extraData?.dropoffAddress ?? dropoffAddress,
          extraStopCoords: extraData?.extraStopCoords ?? extraStopCoords,
          extraStopAddress: extraData?.extraStopAddress ?? extraStopAddress,
          pickupReferencePoint: extraData?.pickupReferencePoint ?? pickupReferencePoint,
          extraStopReferencePoint: extraData?.extraStopReferencePoint ?? extraStopReferencePoint,
          dropoffReferencePoint: extraData?.dropoffReferencePoint ?? dropoffReferencePoint,
          startOtp: extraData?.startOtp ?? startOtp,
          estimatedPrice: extraData?.estimatedPrice ?? estimatedPrice,
          estimatedDistance: extraData?.estimatedDistance ?? estimatedDistance,
          
        };
        await AsyncStorage.setItem(STORAGE_RIDE_KEY, JSON.stringify(payload));
      } else {
        await AsyncStorage.removeItem(STORAGE_RIDE_KEY);
      }
    } catch (e) {
      console.error('Erro ao salvar estado local do passageiro:', e);
    }
  };

  const calculateEstimate = useCallback(
    async (
      origin: { latitude: number; longitude: number },
      destination: { latitude: number; longitude: number },
      extra?: { latitude: number; longitude: number } | null
    ) => {
      setIsCalculatingPrice(true);
      if (serviceType === 'aluguel') {
        const price = RENTAL_PRICES[selectedRegion]?.price || 25000;
        setEstimatedPrice(price);
        setIsCalculatingPrice(false);
        return;
      }

      const fallbackHaversine = extra
        ? getHaversineDistance(origin, extra) + getHaversineDistance(extra, destination)
        : getHaversineDistance(origin, destination);

      const distanceKm = roadDistanceRef.current !== null ? roadDistanceRef.current : fallbackHaversine;
      const price = calculateVehiclePrice(vehicleType, distanceKm);
      setEstimatedDistance(Number(distanceKm.toFixed(2)));
      setEstimatedPrice(price);
      setIsCalculatingPrice(false);
    },
    [serviceType, selectedRegion, vehicleType]
  );

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    setLangModalVisible(false);
  };

  const toggleVoiceAssist = () => {
    const next = !isVoiceAssistEnabled;
    setIsVoiceAssistEnabled(next);
    triggerHapticFeedback('BUTTON_PRESS');
    speakText(next ? 'Assistência por voz ativada' : 'Assistência por voz desativada');
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80) {
          Animated.timing(translateY, {
            toValue: 200,
            duration: 200,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (rideStatus === 'searching') {
      Animated.loop(
        Animated.timing(radarAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      radarAnim.setValue(0);
    }
  }, [rideStatus, radarAnim]);

  useEffect(() => {
    if (driverLocation?.latitude && driverLocation?.longitude) {
      Animated.parallel([
        Animated.timing(animatedLat, {
          toValue: driverLocation.latitude,
          duration: 2000,
          useNativeDriver: false,
        }),
        Animated.timing(animatedLng, {
          toValue: driverLocation.longitude,
          duration: 2000,
          useNativeDriver: false,
        }),
      ]).start();

      const listenerIdLat = animatedLat.addListener(({ value }) => {
        setInterpolatedCoords(prev => [prev[0], value]);
      });
      const listenerIdLng = animatedLng.addListener(({ value }) => {
        setInterpolatedCoords(prev => [value, prev[1]]);
      });

      return () => {
        animatedLat.removeListener(listenerIdLat);
        animatedLng.removeListener(listenerIdLng);
      };
    }
  }, [driverLocation, animatedLat, animatedLng]);

  useEffect(() => {
    const notificationSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const { data } = notification.request.content;
      if (data?.channelId === 'chat-messages' && !isChatVisibleRef.current) {
        triggerHapticFeedback('NEW_OFFER');
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.rideId || data?.channelId === 'chat-messages' || data?.type === 'CHAT_MESSAGE') {
        setIsChatVisible(true);
      }
    });

    return () => {
      notificationSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  const setupBissauOfflineMap = async () => {
    try {
      const packs = await Mapbox.offlineManager.getPacks();
      const exists = packs.some(p => p.name === 'bissau_city_map');

      if (!exists) {
        await Mapbox.offlineManager.createPack(
          {
            name: 'bissau_city_map',
            styleURL: 'mapbox://styles/mapbox/streets-v12',
            minZoom: 11,
            maxZoom: 16,
            bounds: [
              [-15.65, 11.80],
              [-15.50, 11.92],
            ],
          },
          (_, status) => {
            if (status.state === 'complete') {
              console.log('✅ [OFFLINE_MAP] Mapa de Bissau gravado no armazenamento local.');
            }
          }
        );
      }
    } catch (error) {
      console.warn('⚠️ Erro ao salvar cache de mapa offline:', error);
    }
  };

  useEffect(() => {
    setupBissauOfflineMap();
  }, []);

  useEffect(() => {
    if (['accepted', 'arrived', 'in_progress'].includes(rideStatus)) {
      updateOngoingRideNotification({
        title: rideStatus === 'accepted' ? 'Motorista a caminho' : 'Viagem em andamento',
        body: `A caminho de: ${dropoffAddress || 'Seu destino'}`,
        vehiclePlate: driverInfo?.licensePlate,
        vehicleModel: driverInfo?.carModel,
        etaMinutes: driverEta,
      });
    } else {
      dismissOngoingRideNotification();
    }
  }, [rideStatus, driverEta, driverInfo, dropoffAddress]);

  isChatVisibleRef.current = isChatVisible;
  useEffect(() => {
    isChatVisibleRef.current = isChatVisible;
  }, [isChatVisible]);

  const handleIncomingChatMessage = useCallback((data: any) => {
  if (!isMountedRef.current || !data) return;

  const text = String(data.text || data.message || '').trim();
  const audioUrl = data.audioUrl || data.audio || null;
  const audioDuration = Number(data.audioDuration || data.duration || 0);

  if (!text && !audioUrl) return;

  const rawSender = String(data.sender || data.senderType || '').toLowerCase();
  const isFromDriver = rawSender.includes('driver') || rawSender !== 'passenger';
  const normalizedSender: 'passenger' | 'driver' = isFromDriver ? 'driver' : 'passenger';
  const messageId = String(data.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

  // 🔴 SE A MENSAGEM FOR DO MOTORISTA E O CHAT ESTIVER FECHADO:
  if (isFromDriver && !isChatVisibleRef.current) {
    setUnreadCount(prev => prev + 1);
    triggerHapticFeedback('NEW_OFFER');
  }

  setMessages(prev => {
    const isDuplicate = prev.some(
      m => m.id === messageId || 
      (text && m.text === text && m.sender === normalizedSender) ||
      (audioUrl && m.audioUrl === audioUrl)
    );
    if (isDuplicate) return prev;

    return [
      ...prev, 
      { 
        id: messageId, 
        sender: normalizedSender, 
        text, 
        audioUrl, 
        audioDuration, 
        senderPhoto: data.senderPhoto || data.driverPhoto 
      }
    ];
  });
}, []);
const handleOpenChat = () => {
  setUnreadCount(0); // Limpa o contador de mensagens não lidas
  setIsChatVisible(true);
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
      cameraRef.current.fitBounds(ne, sw, [120, 60, 320, 60], 1000);
    } catch (err) {
      console.warn('Erro ao ajustar enquadramento do mapa Mapbox:', err);
    }
  }, []);

  const fetchMapboxRoute = useCallback(async (
    origin: { latitude: number; longitude: number }, 
    destination: { latitude: number; longitude: number }, 
    extraStops?: Array<{ latitude: number; longitude: number }> | { latitude: number; longitude: number } | null
  ) => {
    if (!MAPBOX_ACCESS_TOKEN) return;

    if (isNaN(origin.latitude) || isNaN(origin.longitude) || isNaN(destination.latitude) || isNaN(destination.longitude)) {
      return;
    }

    try {
      const waypoints: string[] = [`${origin.longitude},${origin.latitude}`];

      if (Array.isArray(extraStops)) {
        extraStops.forEach(s => {
          if (s && !isNaN(s.latitude) && !isNaN(s.longitude)) {
            waypoints.push(`${s.longitude},${s.latitude}`);
          }
        });
      } else if (extraStops && !isNaN(extraStops.latitude) && !isNaN(extraStops.longitude)) {
        waypoints.push(`${extraStops.longitude},${extraStops.latitude}`);
      }

      waypoints.push(`${destination.longitude},${destination.latitude}`);

      const coordinatesString = waypoints.join(';');
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesString}?geometries=geojson&overview=full&access_token=${MAPBOX_ACCESS_TOKEN}`;
      
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      
      if (data.routes && data.routes.length > 0 && isMountedRef.current) {
        const routeObj = data.routes[0];
        
        setRouteGeometry({
          type: 'Feature',
          properties: {},
          geometry: routeObj.geometry,
        });

        const distanceKm = Number((routeObj.distance / 1000).toFixed(2));
        const durationMin = Math.ceil(routeObj.duration / 60);

        setDriverEta(durationMin);
        if (rideStatus === 'idle') {
          roadDistanceRef.current = distanceKm;
          roadDurationRef.current = durationMin;
          setEstimatedDistance(distanceKm);
          setEstimatedPrice(calculateVehiclePrice(vehicleType, distanceKm));
        }
      }
    } catch (error) {
      console.warn('Erro ao buscar rota no Mapbox:', error);
    }
  }, [rideStatus, vehicleType]);

  const extractDriverInfo = (source: any, otpFallback?: string): DriverInfo | null => {
    if (!source) return null;
    const d = source.driver || source;
    const id = d.id || source.driverId || source.driver_id;
    if (!id) return null;

    const otpCode = String(source.startOtp || source.otpPin || source.pin || d.startOtp || otpFallback || '');

    const extracted: DriverInfo = {
      id: String(id),
      name: d.fullName || d.name || source.driverName || 'Motorista',
      photoUrl: formatPhotoUrl(d.profilePicture || d.photoUrl || source.driverPhoto),
      profilePicture: formatPhotoUrl(d.profilePicture || d.photoUrl || source.driverPhoto),
      carModel: d.vehicleModel || d.vehicleBrand || source.carModel || source.vehicleModel || 'Veículo Padrão',
      carColor: d.vehicleColor || source.carColor || source.vehicleColor || source.color || 'BRANCO',
      vehicleType: d.vehicleType || source.vehicleType || source.vehicle_type || 'PARTICULAR',
      licensePlate: d.vehiclePlate || source.licensePlate || source.plate || 'SEM PLACA',
      rating: Number(d.ratingAverage || d.rating || source.driverRating || 5.0),
      phone: d.phone || source.driverPhone,
      startOtp: otpCode,
    };
    return extracted;
  };

  const syncPassengerActiveRide = useCallback(async () => {
    try {
      if (!api || typeof api.get !== 'function') return;

      let response = await api.get('/passengers/active-ride').catch(() => null);
      if (!response?.data?.ride) {
        response = await api.get('/rides/active').catch(() => null);
      }
      
      if (response?.data?.ride && isMountedRef.current) {
        const ride = response.data.ride;
        const mappedStatus: RideStatus = 
          ride.status === 'SEARCHING' || ride.status === 'QUEUED' || ride.status === 'PENDING' ? 'searching' :
          ride.status === 'ACCEPTED' ? 'accepted' :
          ride.status === 'ARRIVED' ? 'arrived' :
          ride.status === 'IN_PROGRESS' ? 'in_progress' : 'idle';

        if (mappedStatus !== 'idle') {
          setActiveRideId(ride.id);
          activeRideIdRef.current = ride.id;
          setRideStatus(mappedStatus);
          setBookingStep('SEARCHING');

          const otpCode = String(ride.startOtp || ride.otpPin || ride.pin || '');
          if (otpCode) setStartOtp(otpCode);

          const parsedDriver = extractDriverInfo(ride, otpCode);
          if (parsedDriver) {
            setDriverInfo(parsedDriver);
          }

          const dObj = ride.driver || {};
          const lat = Number(dObj.currentLat || ride.driverLat || ride.currentLat);
          const lng = Number(dObj.currentLng || ride.driverLng || ride.currentLng);
          if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
            setDriverLocation({
              latitude: lat,
              longitude: lng,
              heading: Number(dObj.heading || ride.heading || 0),
            });
          }

          let pCoords = null;
          let dCoords = null;

          if (ride.originLat && ride.originLng) {
            pCoords = { latitude: Number(ride.originLat), longitude: Number(ride.originLng) };
            setPickupCoords(pCoords);
            if (ride.originAddress) setPickupAddress(ride.originAddress);
          }

          if (ride.destinationLat && ride.destinationLng) {
            dCoords = { latitude: Number(ride.destinationLat), longitude: Number(ride.destinationLng) };
            setDropoffCoords(dCoords);
            if (ride.destinationAddress) setDropoffAddress(ride.destinationAddress);
          }

          if (Array.isArray(ride.stops) && ride.stops.length > 0) {
            const firstStop = ride.stops[0];
            const stopLat = Number(firstStop.lat || firstStop.latitude);
            const stopLng = Number(firstStop.lng || firstStop.longitude);
            if (!isNaN(stopLat) && !isNaN(stopLng)) {
              setExtraStopCoords({ latitude: stopLat, longitude: stopLng });
              setExtraStopAddress(firstStop.address || 'Parada Intermediária');
              setShowExtraStop(true);
            }
          }

          if (ride.priceXof) setEstimatedPrice(Number(ride.priceXof));
          if (ride.distanceKm) setEstimatedDistance(Number(ride.distanceKm));
          if (pCoords && dCoords) {
            fetchMapboxRoute(pCoords, dCoords, extraStopCoords);
            fitMapBounds([pCoords, dCoords]);
          }

          activateKeepAwakeAsync('PASSENGER_RIDE_KEEP_AWAKE').catch(() => {});

          await persistRideState(ride.id, mappedStatus, {
            driverInfo: parsedDriver,
            pickupCoords: pCoords,
            pickupAddress: ride.originAddress,
            dropoffCoords: dCoords,
            dropoffAddress: ride.destinationAddress,
            startOtp: otpCode,
            estimatedPrice: ride.priceXof ? Number(ride.priceXof) : null,
            estimatedDistance: ride.distanceKm ? Number(ride.distanceKm) : null,
          });

          if (socket && socket.connected) {
            socket.emit('passenger:rejoin_ride', { rideId: ride.id });
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ [SYNC_DEBUG] Erro na rede ao sincronizar corrida:', err);
    }
  }, [fetchMapboxRoute, fitMapBounds, extraStopCoords]);

  const handleMapboxSearch = async (text: string) => {
    setSearchQuery(text);

    if (!text || text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearchingMapbox(true);

    try {
      const response = await api.get(`/landmarks/search?q=${encodeURIComponent(text)}`).catch(() => null);
      
      let dbResults: MapboxGeocodingFeature[] = [];

      if (response?.data && Array.isArray(response.data)) {
        dbResults = response.data.map((item: any) => {
          const mainTitle = item.displayText || item.name || item.title || item.popularName || '';
          const subTitle = item.subtitle || item.neighborhood || item.referenceNotes || '';
          
          let description = mainTitle;
          if (!item.displayText && subTitle && !mainTitle.toLowerCase().includes(subTitle.toLowerCase())) {
            description = `${mainTitle}, ${subTitle}`;
          }

          if (!description || description.includes('undefined')) {
            description = item.description || item.formatted_address || 'Localização';
          }

          return {
            id: `db_${item.id || Math.random()}`,
            description: description.replace(/undefined/g, '').trim(),
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            isLocalBairro: true,
          };
        });
      }

      if (dbResults.length > 0) {
        setSearchResults(dbResults);
        setIsSearchingMapbox(false);
        return;
      }

      const mapboxRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?country=gw&proximity=${BISSAU_CENTER.longitude},${BISSAU_CENTER.latitude}&language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`
      );

      if (mapboxRes.ok) {
        const mapboxData = await mapboxRes.json();
        const formattedMapbox: MapboxGeocodingFeature[] = (mapboxData.features || []).map((item: any) => ({
          id: item.id,
          description: (item.place_name || item.text || 'Localização').replace(/, Guiné-Bissau/gi, ''),
          latitude: item.geometry.coordinates[1],
          longitude: item.geometry.coordinates[0],
          isLocalBairro: false,
        }));

        setSearchResults(formattedMapbox);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error('❌ [SEARCH_DEBUG] Erro ao pesquisar local:', error);
      setSearchResults([]);
    } finally {
      setIsSearchingMapbox(false);
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

      let location: Location.LocationObject | null = null;
      try {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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

      if (!isManualPickupRef.current) {
        const { latitude, longitude } = location.coords;
        setPickupCoords({ latitude, longitude });

        const localName = findNearestLocalBairro(latitude, longitude);

        if (localName) {
          setPickupAddress(localName);
        } else if (MAPBOX_ACCESS_TOKEN && isMountedRef.current) {
          try {
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?country=gw&proximity=${longitude},${latitude}&types=neighborhood,locality,place,address,poi&language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (data?.features?.length > 0 && isMountedRef.current) {
                const bestFeature = data.features[0];
                const neighborhood = data.features.find((f: any) => f.place_type?.includes('neighborhood'))?.text;
                const placeName = bestFeature.text || bestFeature.place_name || 'Bissau, Centro';

                const cleanAddress = neighborhood ? `${neighborhood}, Bissau` : placeName;
                if (!isManualPickupRef.current) {
                  setPickupAddress(cleanAddress);
                }
              }
            }
          } catch (gErr) {
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
    async function loadRecentSearches() {
      try {
        const savedRecents = await AsyncStorage.getItem(STORAGE_RECENT_SEARCHES_KEY);
        if (savedRecents && isMountedRef.current) {
          setRecentSearches(JSON.parse(savedRecents));
        }
      } catch (e) {
        console.error('Erro ao carregar histórico de buscas:', e);
      }
    }
    loadRecentSearches();
  }, []);

  const saveToRecentSearches = async (newItem: MapboxGeocodingFeature) => {
    try {
      const filtered = recentSearches.filter(
        item => item.description.toLowerCase().trim() !== newItem.description.toLowerCase().trim()
      );
      const updated = [newItem, ...filtered].slice(0, 10);

      setRecentSearches(updated);
      await AsyncStorage.setItem(STORAGE_RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Erro ao salvar busca recente:', e);
    }
  };

  const removeRecentSearch = async (id: string) => {
    try {
      const updated = recentSearches.filter(item => item.id !== id);
      setRecentSearches(updated);
      await AsyncStorage.setItem(STORAGE_RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Erro ao remover busca recente:', e);
    }
  };

  const saveFavoritePlace = async (type: 'home' | 'work', place: FavoritePlace) => {
    try {
      let updatedHome = homeLocation;
      let updatedWork = workLocation;

      if (type === 'home') {
        updatedHome = place;
        setHomeLocation(place);
      } else {
        updatedWork = place;
        setWorkLocation(place);
      }

      await AsyncStorage.setItem(
        STORAGE_FAVORITES_KEY,
        JSON.stringify({ home: updatedHome, work: updatedWork })
      );

      Alert.alert(
        'Endereço Salvo! 🌟',
        `${type === 'home' ? 'Casa' : 'Trabalho'} definido para: ${place.address}`
      );
    } catch (e) {
      console.error('Erro ao salvar local favorito:', e);
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        getCurrentLocationWithFallback();

        if (socket && !socket.connected) {
          connectPassengerSocket();
        }

        await syncPassengerActiveRide();

        setTimeout(() => {
          if (socket && socket.connected) {
            socket.emit('passenger:request_state');
          }
        }, 800);
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [getCurrentLocationWithFallback, syncPassengerActiveRide]);

  useEffect(() => {
    const currentLat = pickupCoords?.latitude || passengerLocation?.coords?.latitude;
    const currentLng = pickupCoords?.longitude || passengerLocation?.coords?.longitude;

    if (!currentLat || !currentLng) return;

    const fetchNearby = async () => {
      try {
        const response = await api.get('/passengers/drivers/nearby', {
          params: { lat: currentLat, lng: currentLng }
        });
        if (isMountedRef.current) {
          setNearbyDrivers(response.data?.drivers || []);
        }
      } catch (err) {
        console.warn('Erro ao carregar motoristas próximos:', err);
      }
    };

    fetchNearby();
    const interval = setInterval(fetchNearby, 5000);
    return () => clearInterval(interval);
  }, [pickupCoords, passengerLocation]);

  useEffect(() => {
    async function initAppAndPermissions() {
      try {
        const savedState = await AsyncStorage.getItem(STORAGE_RIDE_KEY);
        if (savedState && isMountedRef.current) {
          const parsed = JSON.parse(savedState);
          if (parsed?.rideId && parsed?.status && parsed.status !== 'idle' && parsed.status !== 'completed') {
            setActiveRideId(parsed.rideId);
            activeRideIdRef.current = parsed.rideId;
            setRideStatus(parsed.status);
            setBookingStep('SEARCHING');

            if (parsed.driverInfo) setDriverInfo(parsed.driverInfo);
            if (parsed.pickupCoords) setPickupCoords(parsed.pickupCoords);
            if (parsed.pickupAddress) setPickupAddress(parsed.pickupAddress);
            if (parsed.dropoffCoords) setDropoffCoords(parsed.dropoffCoords);
            if (parsed.dropoffAddress) setDropoffAddress(parsed.dropoffAddress);
            if (parsed.extraStopCoords) setExtraStopCoords(parsed.extraStopCoords);
            if (parsed.extraStopAddress) {
              setExtraStopAddress(parsed.extraStopAddress);
              setShowExtraStop(true);
            }
            if (parsed.startOtp) setStartOtp(parsed.startOtp);
            if (parsed.estimatedPrice) setEstimatedPrice(parsed.estimatedPrice);
            if (parsed.estimatedDistance) setEstimatedDistance(parsed.estimatedDistance);

            if (parsed.pickupCoords && parsed.dropoffCoords) {
              fitMapBounds([parsed.pickupCoords, parsed.dropoffCoords]);
            } else if (parsed.pickupCoords && cameraRef.current) {
              cameraRef.current.setCamera({
                centerCoordinate: [parsed.pickupCoords.longitude, parsed.pickupCoords.latitude],
                zoomLevel: 15,
                animationDuration: 500,
              });
            }
          }
        }
      } catch (err) {
        console.error('Erro ao recuperar corrida salva localmente:', err);
      }

      await getCurrentLocationWithFallback();
      await syncPassengerActiveRide();
    }

    initAppAndPermissions();

    if (!user?.id) return;

    connectPassengerSocket();
    registerAndSendPushToken();

    if (activeRideIdRef.current) {
      socket.emit('passenger:rejoin_ride', { rideId: activeRideIdRef.current });
    }

    const handleConnect = () => {
      if (isMountedRef.current) setIsConnected(true);
      if (socket && socket.connected) {
        socket.emit('passenger:request_state');
        if (activeRideIdRef.current) {
          socket.emit('passenger:rejoin_ride', { rideId: activeRideIdRef.current });
        }
      }
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
          const ride = data.ride;
          setActiveRideId(ride.id);
          activeRideIdRef.current = ride.id;

          if (typeof ride.originLat === 'number' && typeof ride.originLng === 'number') {
            const lat = Number(ride.originLat);
            const lng = Number(ride.originLng);
            if (!isNaN(lat) && !isNaN(lng)) setPickupCoords({ latitude: lat, longitude: lng });
            if (ride.originAddress) setPickupAddress(ride.originAddress);
          }

          if (typeof ride.destinationLat === 'number' && typeof ride.destinationLng === 'number') {
            const lat = Number(ride.destinationLat);
            const lng = Number(ride.destinationLng);
            if (!isNaN(lat) && !isNaN(lng)) setDropoffCoords({ latitude: lat, longitude: lng });
            if (ride.destinationAddress) setDropoffAddress(ride.destinationAddress);
          }

          const otpCode = String(ride.startOtp || ride.otpPin || ride.pin || '');
          if (otpCode) setStartOtp(otpCode);

          const parsedDriver = extractDriverInfo(ride, otpCode);
          if (parsedDriver) {
            setDriverInfo(parsedDriver);
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
      setActiveRideId(data.rideId || data.id);
      activeRideIdRef.current = data.rideId || data.id;

      const parsedDriver = extractDriverInfo(data, otpCode);
      if (parsedDriver) {
        setDriverInfo(parsedDriver);
      }
  const serverPrice = Number(data.priceXof ?? data.fareXOF ?? 0);
      if (serverPrice > 0) setEstimatedPrice(Math.round(serverPrice));
      const serverDist = Number(data.distanceKm ?? 0);
      if (serverDist > 0) setEstimatedDistance(serverDist);
      const serverDur = Number(data.durationMin ?? 0);
      if (serverDur > 0) setDriverEta(serverDur);
      setAcceptedAt(new Date());
      setRideStatus(data.isQueuedRide ? 'queued' : 'accepted');
      persistRideState(data.rideId || data.id, data.isQueuedRide ? 'queued' : 'accepted', {
        driverInfo: parsedDriver,
        startOtp: otpCode,
        estimatedPrice: serverPrice > 0 ? Math.round(serverPrice) : estimatedPrice,
        estimatedDistance: serverDist > 0 ? serverDist : estimatedDistance,
      });

      speakRideStatusUpdate(data.isQueuedRide ? 'queued' : 'accepted', { driverName: parsedDriver?.name });

      Notifications.scheduleNotificationAsync({
        content: {
          title: t('ride_accepted_title', 'Corrida Aceita! 🚗'),
          body: `${parsedDriver?.name || 'O motorista'} ${t('ride_accepted_msg', 'aceitou sua viagem e está a caminho.')}`,
          data: { channelId: 'ride-updates' },
          sound: 'default',
        },
        trigger: null,
      }).catch(() => {});
    };

    const handleDriverArrived = (data: any) => {
      if (!isMountedRef.current) return;
      setRideStatus('arrived');
      if (data?.startOtp) setStartOtp(data.startOtp);
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'arrived');
      
      speakRideStatusUpdate('arrived');

      Notifications.scheduleNotificationAsync({
        content: {
          title: t('driver_arrived_title', 'Motorista no Local! 📍'),
          body: t('driver_arrived_alert_msg', 'Seu motorista chegou ao ponto de partida e está te aguardando.'),
          data: { channelId: 'ride-updates' },
          sound: 'default',
        },
        trigger: null,
      }).catch(() => {});
    };

    const handleRideStarted = () => { 
      if (!isMountedRef.current) return;
      setRideStatus('in_progress'); 
      setIsChatVisible(false); 
      speakRideStatusUpdate('in_progress');
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'in_progress');
    };

    const handleRideFinished = (data: any) => { 
      if (!isMountedRef.current) return;
      const finalPrice = Number(data?.fareXOF ?? data?.priceXof ?? data?.totalAmount ?? 0);
      if (finalPrice > 0) setEstimatedPrice(Math.round(finalPrice));
      const finalDist = Number(data?.distanceKm ?? 0);
      if (finalDist > 0) setEstimatedDistance(finalDist);

      setRideStatus('completed');
      setShowRatingModal(true); 
      speakRideStatusUpdate('completed');
      persistRideState(null, 'idle');
    };

    const handleRideCancelled = (data: any) => {
      if (!isMountedRef.current) return;

      const isDriverCancel = data?.cancelledBy === 'DRIVER';
      const title = isDriverCancel ? t('warning_title', 'Aviso ⚠️') : t('cancelled_title', 'Cancelado');
      const body = isDriverCancel 
        ? t('driver_cancelled_msg', 'O motorista cancelou a corrida. Por favor, solicite um novo veículo.')
        : (data?.appliedPenalty ? `${t('cancellation_fee', 'Taxa de cancelamento:')} ${data.penaltyAmount} XOF.` : t('ride_cancelled_msg', 'Sua corrida foi cancelada.'));

      Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { channelId: 'ride-updates' },
          sound: 'default',
        },
        trigger: null,
      }).catch(() => {});
      
      resetRideState();
    };

    const handleNoDriversFound = () => {
      if (!isMountedRef.current) return;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

      Notifications.scheduleNotificationAsync({
        content: {
          title: t('search_ended_title', 'Busca Encerrada'),
          body: t('no_drivers_found_msg', 'Não encontramos motoristas disponíveis na sua região. Tente novamente.'),
          data: { channelId: 'ride-updates' },
          sound: 'default',
        },
        trigger: null,
      }).catch(() => {});

      resetRideState();
    };

    const handlePriceCalculated = (data: any) => {
      if (!isMountedRef.current || !data) return;
      if (typeof data.price === 'number') setEstimatedPrice(data.price);
      if (typeof data.distance === 'number') setEstimatedDistance(data.distance);
    };

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

    // 🟢 OUVINTES DE SOCKET (COM SUPORTE MULTI-EVENTO PARA CHAT)
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('passenger:state_recovered', handleStateRecovered);
    socket.on('driver:position', handleDriverPosition);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:arrived', handleDriverArrived);
    socket.on('ride:driver_arrived', handleDriverArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:completed', handleRideFinished);
    socket.on('ride:cancelled', handleRideCancelled);
    
    // 💬 OUVINTES DE CHAT GARANTIDOS (RECEIVE, MESSAGE E NEW_MESSAGE)
    socket.on('chat:receive_message', handleIncomingChatMessage);
    socket.on('chat:message', handleIncomingChatMessage);
    socket.on('chat:new_message', handleIncomingChatMessage);
    
    socket.on('ride:no_drivers_found', handleNoDriversFound);
    socket.on('ride:price_calculated', handlePriceCalculated);
    socket.on('ride:inaccessible_location', handleInaccessibleLocationAlert);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('passenger:state_recovered', handleStateRecovered);
      socket.off('driver:position', handleDriverPosition);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:arrived', handleDriverArrived);
      socket.off('ride:driver_arrived', handleDriverArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:completed', handleRideFinished);
      socket.off('ride:cancelled', handleRideCancelled);
      
      // 💬 LIMPEZA DOS OUVINTES DE CHAT
      socket.off('chat:receive_message', handleIncomingChatMessage);
      socket.off('chat:message', handleIncomingChatMessage);
      socket.off('chat:new_message', handleIncomingChatMessage);
      
      socket.off('ride:no_drivers_found', handleNoDriversFound);
      socket.off('ride:price_calculated', handlePriceCalculated);
      socket.off('ride:inaccessible_location', handleInaccessibleLocationAlert);
      
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [
    user?.id, 
    getCurrentLocationWithFallback, 
    handleInaccessibleLocationAlert, 
    handleIncomingChatMessage, 
    resetRideState, 
    syncPassengerActiveRide, 
    fitMapBounds,
    t
  ]);

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

  useEffect(() => {
    const activeRideStates = ['searching', 'accepted', 'arrived', 'in_progress'];
    const isRideActive = activeRideStates.includes(rideStatus);

    if (isRideActive) {
      activateKeepAwakeAsync('passenger_ride_tag').catch(() => {});
    } else {
      deactivateKeepAwake('passenger_ride_tag').catch(() => {});
    }

    return () => {
      deactivateKeepAwake('passenger_ride_tag').catch(() => {});
    };
  }, [rideStatus]);

  async function handleInitialRequestRide() {
    const needsDropoff = serviceType !== 'aluguel';
    if (!pickupCoords || (needsDropoff && (!dropoffCoords || !dropoffAddress.trim())) || !user?.id) {
      Alert.alert(
        t('warning_title', 'Aviso ⚠️'), 
        t('select_origin_destination_msg', 'Preencha obrigatoriamente o local de partida e o destino final.')
      );
      return;
    }

    try {
      const currentLoc = await Location.getCurrentPositionAsync({ 
        accuracy: Location.Accuracy.Balanced 
      });
      const isMocked = currentLoc.mocked || (currentLoc.coords as any)?.mocked;

      if (isMocked) {
        Alert.alert(
          "🚨 Localização Simulada Detectada",
          "Por motivos de segurança, não é possível solicitar corridas utilizando aplicativos de GPS falso.",
          [{ text: "Entendido" }]
        );
        return;
      }
    } catch (e) {
      console.warn('Erro ao verificar localização simulada:', e);
    }

    executeRideRequest();
  }

  function executeRideRequest() {
    if (!user?.id || !pickupCoords || !dropoffCoords) {
      Alert.alert(t('warning_title', 'Aviso ⚠️'), t('missing_data_msg', 'Preencha o local de partida e o destino final para continuar.'));
      return;
    }

    try {
      if (!socket.connected) connectPassengerSocket();

      setRideStatus('searching');
      
      const mappedServiceType = serviceType === 'viagem' ? 'RIDE' : serviceType === 'entrega' ? 'DELIVERY' : 'RENTAL';
      const mappedVehicleType = 
        vehicleType === 'particular' ? 'PARTICULAR' : 
        vehicleType === 'moto-carro' ? 'MOTO_CARRO' : 
        (vehicleType as string) === 'toca-toca' ? 'TOCA_TOCA' :
        vehicleType.toUpperCase();
        
      const regionLabel = RENTAL_PRICES[selectedRegion]?.label || selectedRegion;
      const finalPriceXof = estimatedPrice != null ? Math.round(Number(estimatedPrice)) : undefined;
      const finalDistanceKm = estimatedDistance != null ? Number(estimatedDistance.toFixed(2)) : undefined;
      const finalDurationMin = (roadDurationRef.current ?? driverEta) != null ? Number(roadDurationRef.current ?? driverEta) : undefined;
      const payload = {
        passengerId: user.id,
        passengerName: (user as any)?.name || user.fullName,
        passengerRating: Number((user as any)?.rating || user.ratingAverage || 5.0),
        pickupLat: pickupCoords.latitude,
        pickupLng: pickupCoords.longitude,
        originAddress: pickupAddress,
        destinationLat: dropoffCoords?.latitude || pickupCoords.latitude,
        destinationLng: dropoffCoords?.longitude || pickupCoords.longitude,
        destinationAddress: serviceType === 'aluguel' ? `Aluguel Toca-Toca (${regionLabel})` : dropoffAddress,
        pickupReferencePoint: pickupReferencePoint.trim(),
        extraStopReferencePoint: extraStopReferencePoint.trim(),
        dropoffReferencePoint: dropoffReferencePoint.trim(),
        referencePoint: pickupReferencePoint.trim(),
        serviceType: mappedServiceType,
        vehicleType: mappedVehicleType,
        paymentMethod: 'CASH', // 🟢 SEMPRE DINHEIRO FÍSICO
        guestName: isForAnotherPerson ? guestName : undefined,
        guestPhone: isForAnotherPerson ? guestPhone : undefined,
        estimatedPrice: finalPriceXof,
        priceXof: finalPriceXof,
        distanceKm: finalDistanceKm,
        durationMin: finalDurationMin,
        stops: (extraStopCoords?.latitude && extraStopCoords?.longitude) ? [
          {
            address: extraStopAddress || 'Parada Intermediária',
            referencePoint: extraStopReferencePoint.trim(),
            lat: extraStopCoords.latitude,
            lng: extraStopCoords.longitude,
            latitude: extraStopCoords.latitude,
            longitude: extraStopCoords.longitude,
            status: 'PENDING'
          }
        ] : [],
        extraStopLat: extraStopCoords?.latitude,
        extraStopLng: extraStopCoords?.longitude,
        extraStopAddress: extraStopAddress || undefined,
      };

      emitRequestRide(payload);

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

  const checkPenaltyApplicable = () => {
    if (!acceptedAt) return false;
    return (new Date().getTime() - acceptedAt.getTime()) > 2 * 60 * 1000;
  };

  const handleConfirmCancel = useCallback((reason: string) => {
  setShowCancelModal(false);

  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

  // Se houver uma corrida ativa no banco, cancela via Socket/API
  if (activeRideId && user?.id) {
    cancelRideByPassenger(activeRideId, user.id, reason);
  }

  AsyncStorage.multiRemove([
    '@nobai245:active_ride_id',
    '@nobai245:active_ride_data',
    '@bai245:active_ride',
    STORAGE_RIDE_KEY
  ]).catch(() => {});

  // Executa o reset completo da tela
  handleFullCancelAndReset();
}, [activeRideId, user?.id, handleFullCancelAndReset]);

  const onMapRegionDidChange = useCallback(async (feature: any) => {
    setIsMapMoving(false);
    if (rideStatus !== 'idle' || bookingStep !== 'ADDRESS') return;
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
        setPickupAddress('Bissau, Centro');
      }
    }
  }, [rideStatus, bookingStep]);

  const handleSubmitRating = useCallback((stars: number, tags: string[], comment: string) => {
    if (activeRideId && driverInfo && user?.id) {
      rateDriver({ 
        rideId: activeRideId, 
        reviewerId: user.id, 
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
        Alert.alert(
          t('warning_title', 'Aviso ⚠️'), 
          t('wait_trip_data', 'Aguarde os dados da corrida carregarem para compartilhar.')
        );
        return;
      }

      const apiDomain = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
      const baseUrl = apiDomain.replace(/\/api\/?$/, '').replace(/\/$/, '');
      const trackingUrl = `${baseUrl}/track/${activeRideId}`;

      const mensagem = 
        `🚕 *Acompanhe minha viagem no Nô Bai 245!*\n\n` +
        `👤 *Motorista:* ${driverInfo.name || 'Motorista'}\n` +
        `🚘 *Veículo:* ${driverInfo.carModel || 'Veículo'} (${driverInfo.carColor || 'N/A'}) — Placa: *${driverInfo.licensePlate || 'N/A'}*\n` +
        `📍 *Destino:* ${dropoffAddress}\n` +
        `${driverEta ? `⏳ *Previsão de Chegada:* ${driverEta} min\n` : ''}\n` +
        `🌐 *Acompanhe ao vivo no mapa pelo navegador:*\n${trackingUrl}`;

      await Share.share({ 
        message: mensagem, 
        title: 'Acompanhar Minha Viagem - Nô Bai 245' 
      });
    } catch (error) {
      Alert.alert(
        t('error_title', 'Erro'), 
        t('share_error_msg', 'Não foi possível abrir o menu de compartilhamento.')
      );
    }
  };

  function openSearchModal(type: 'pickup' | 'dropoff' | 'extraStop') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  const safeCenterCoordinate = useMemo(() => {
    if (
      driverLocation?.latitude && 
      driverLocation?.longitude && 
      !isNaN(Number(driverLocation.latitude)) && 
      Number(driverLocation.latitude) !== 0
    ) {
      return [Number(driverLocation.longitude), Number(driverLocation.latitude)];
    }

    if (
      pickupCoords?.latitude && 
      pickupCoords?.longitude && 
      !isNaN(Number(pickupCoords.latitude)) && 
      Number(pickupCoords.latitude) !== 0
    ) {
      return [Number(pickupCoords.longitude), Number(pickupCoords.latitude)];
    }

    if (
      passengerLocation?.coords?.latitude && 
      passengerLocation?.coords?.longitude && 
      !isNaN(Number(passengerLocation.coords.latitude)) && 
      Number(passengerLocation.coords.latitude) !== 0
    ) {
      return [Number(passengerLocation.coords.longitude), Number(passengerLocation.coords.latitude)];
    }

    return [BISSAU_CENTER.longitude, BISSAU_CENTER.latitude];
  }, [driverLocation, pickupCoords, passengerLocation]);

  const hasActiveRestoredRide = rideStatus !== 'idle' && Boolean(activeRideId);

  /* SUB-BLOCO DE CÓDIGO DA HOME.TSX: RETORNO DA RENDERIZAÇÃO E MODAIS */

  if (!passengerLocation && !hasActiveRestoredRide && locationError) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: Math.max(insets?.top || 0, 40), paddingBottom: Math.max(insets?.bottom || 0, 20) }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError || t('getting_location', 'Obtendo localização exata...')}</Text>
        <TouchableOpacity 
          style={styles.retryLocationBtn} 
          onPress={getCurrentLocationWithFallback}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>{t('try_again', 'Tentar Novamente')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeOtpPin = String(startOtp || driverInfo?.startOtp || '');
  const topHeaderInset = Math.max((insets?.top || 0) + 12, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* 1. HEADER FLUTUANTE COM VIDRO FOSCO (GLASSMORPHISM) */}
      <View style={[styles.floatingHeader, { top: topHeaderInset }]}>
        <BlurView intensity={75} tint="dark" style={styles.headerBlurWrapper}>
          <View style={styles.headerContent}>
            
            {/* 🟢 VOLTAR (SE ESTIVER ESCOLHENDO VEÍCULO OU PAGAMENTO) OU PERFIL DO PASSAGEIRO */}
            {(bookingStep === 'SERVICE_AND_PRICE' || bookingStep === 'PAYMENT') ? (
              <TouchableOpacity 
                style={styles.backButton} 
                onPress={() => {
                  if (bookingStep === 'SERVICE_AND_PRICE' || bookingStep === 'PAYMENT') {
                    handleFullCancelAndReset();
                  } else if (navigation.canGoBack()) {
                    navigation.goBack();
                  }
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={24} color="#FFF" />
              </TouchableOpacity>
            ) : (
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
            )}

            <TouchableOpacity 
              style={[
                styles.voiceToggleHeaderBtn, 
                { backgroundColor: isVoiceAssistEnabled ? '#EAB308' : 'rgba(30, 41, 59, 0.8)' }
              ]} 
              onPress={toggleVoiceAssist}
              activeOpacity={0.8}
            >
              <Ionicons 
                name={isVoiceAssistEnabled ? "volume-high" : "volume-mute"} 
                size={18} 
                color={isVoiceAssistEnabled ? "#0F172A" : "#94A3B8"} 
              />
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
        </BlurView>
      </View>

      {/* 2. MAPA DE NAVEGAÇÃO MAPBOX */}
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Dark}
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
          centerCoordinate={safeCenterCoordinate}
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

        {/* 📡 ONDAS DE RADAR */}
        {rideStatus === 'searching' && pickupCoords?.latitude != null && pickupCoords?.longitude != null && (
          <Mapbox.PointAnnotation
            id="searchingRadarMarker"
            coordinate={[Number(pickupCoords.longitude), Number(pickupCoords.latitude)]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={{ width: 160, height: 160, justifyContent: 'center', alignItems: 'center' }}>
              <Animated.View
                style={[
                  styles.radarWaveCircle,
                  { transform: [{ scale: radarScale1 }], opacity: radarOpacity1 }
                ]}
              />
              <Animated.View
                style={[
                  styles.radarWaveCircle,
                  { transform: [{ scale: radarScale2 }], opacity: radarOpacity2 }
                ]}
              />
              <View style={styles.radarCenterPin}>
                <Ionicons name="location" size={22} color="#EAB308" />
              </View>
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* 🚗 MOTORISTAS ONLINE PRÓXIMOS */}
        {nearbyDrivers && nearbyDrivers
          .filter((driver: any) => driver.lat && driver.lng && Number(driver.lat) !== 0 && Number(driver.lng) !== 0)
          .map((driver: any) => (
            <Mapbox.PointAnnotation
              key={`online-driver-${driver.id}`}
              id={`online-driver-${driver.id}`}
              coordinate={[Number(driver.lng), Number(driver.lat)]}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.driverMarkerWrapper}>
                <View style={{ transform: [{ rotate: `${driver.heading || 0}deg` }] }}>
                  <Image
                    source={getVehicle3DIconAsset(driver.vehicleType || 'TAXI', driver.carColor || 'AMARELO')}
                    style={styles.driverMarkerImage}
                    fadeDuration={0}
                    resizeMode="contain"
                  />
                </View>
              </View>
            </Mapbox.PointAnnotation>
          ))}

        {/* 📍 PONTO DE EMBARQUE */}
        {pickupCoords?.latitude != null && pickupCoords?.longitude != null && !isNaN(Number(pickupCoords.longitude)) && Number(pickupCoords.latitude) !== 0 && (
          <Mapbox.PointAnnotation 
            id="pickupPoint" 
            coordinate={[Number(pickupCoords.longitude), Number(pickupCoords.latitude)]}
          >
            <View style={styles.pickupMarker}>
              <Ionicons name="pin" size={22} color="#EAB308" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* 🔵 PARADA EXTRA */}
        {extraStopCoords?.latitude != null && extraStopCoords?.longitude != null && !isNaN(Number(extraStopCoords.longitude)) && Number(extraStopCoords.latitude) !== 0 && (
          <Mapbox.PointAnnotation
            id="extraStopMarker"
            coordinate={[Number(extraStopCoords.longitude), Number(extraStopCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#3B82F6', borderColor: '#FFF', borderWidth: 2 }]}>
              <Ionicons name="location" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* 🚩 DESTINO FINAL */}
        {dropoffCoords?.latitude != null && dropoffCoords?.longitude != null && !isNaN(Number(dropoffCoords.longitude)) && Number(dropoffCoords.latitude) !== 0 && (
          <Mapbox.PointAnnotation
            id="dropoffMarker"
            coordinate={[Number(dropoffCoords.longitude), Number(dropoffCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#0F172A' }]}>
              <Ionicons name="flag" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* 🏎️ MOTORISTA EM MOVIMENTO */}
        {driverLocation?.latitude != null && driverLocation?.longitude != null && !isNaN(Number(driverLocation.longitude)) && Number(driverLocation.latitude) !== 0 && (
          <Mapbox.PointAnnotation
            key="driverMarker"
            id="driverMarker"
            coordinate={interpolatedCoords}
            anchor={{ x: 0.5, y: 0.8 }}
          >
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              {driverEta !== null && driverEta > 0 && ['accepted', 'arrived', 'in_progress'].includes(rideStatus) && (
                <View style={styles.driverEtaBubble}>
                  <Ionicons name="time" size={10} color="#0F172A" style={{ marginRight: 3 }} />
                  <Text style={styles.driverEtaText}>{driverEta} min</Text>
                </View>
              )}
              <View style={{ transform: [{ rotate: `${driverLocation.heading || 0}deg` }] }}>
                <Image
                  source={getVehicle3DIconAsset(
                    driverInfo?.vehicleType || vehicleType,
                    driverInfo?.carColor
                  )}
                  style={{ width: 44, height: 44, backgroundColor: 'transparent' }}
                  fadeDuration={0}
                  resizeMode="contain"
                />
              </View>
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* PINO CENTRAL FLUTUANTE */}
      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.centerPinContainer} pointerEvents="none">
          <Animated.View style={[styles.centerPin, isMapMoving && { transform: [{ translateY: -10 }] }]}>
            <Ionicons name="location" size={36} color="#EAB308" />
          </Animated.View>
          <View style={styles.pinShadow} />
        </View>
      )}

      {/* 🛡️ CENTRAL DE SEGURANÇA FLUTUANTE */}
      {['accepted', 'arrived', 'in_progress'].includes(rideStatus) && (
        <TouchableOpacity
          style={[styles.floatingSafetyShieldBtn, { bottom: Math.max((insets?.bottom || 0) + 315, 325) }]}
          activeOpacity={0.85}
          onPress={handleSosPress}
        >
          <Ionicons name="shield-checkmark" size={20} color="#EF4444" />
        </TouchableOpacity>
      )}

      {/* BOTÃO RECENTRALIZAR */}
      <TouchableOpacity 
        style={[styles.recenterButton, { bottom: Math.max((insets?.bottom || 0) + 260, 270) }]} 
        activeOpacity={0.85}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          if (cameraRef.current) {
            cameraRef.current.setCamera({
              centerCoordinate: safeCenterCoordinate,
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

      {/* 3. PAINEL SLIDING BOTTOM SHEET TRANSLÚCIDO */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={styles.bottomSheetWrapper} 
        pointerEvents="box-none"
      >
        <Animated.View 
          style={[
            styles.bottomSheet, 
            { 
              transform: [{ translateY }], 
              maxHeight: Dimensions.get('window').height * 0.68,
              paddingBottom: Math.max((insets?.bottom || 0) + 12, 20) 
            }
          ]}
        >
          <View style={styles.dragHandlerArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicator} />
          </View>

          <ScrollView 
            nestedScrollEnabled 
            showsVerticalScrollIndicator={false} 
            keyboardShouldPersistTaps="handled" 
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
          >
            {/* CONFIGURAÇÃO DE ROTA (APENAS QUANDO LIVRE) */}
            {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
              <View style={{ width: '100%', paddingTop: 4 }}>
                <Text style={styles.sheetTitle}>{t('where_to', 'Para onde vamos?')}</Text>
                
                {/* EMBARQUE */}
                <View style={{ marginBottom: 10 }}>
                  <TouchableOpacity style={styles.mainSearchInput} activeOpacity={0.8} onPress={() => openSearchModal('pickup')}>
                    <Ionicons name="location" size={20} color="#EAB308" style={{ marginRight: 12 }} />
                    <Text style={styles.mainSearchText} numberOfLines={1} ellipsizeMode="tail">
                      {pickupAddress || t('pickup_location', 'Local de partida')}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.referenceInputContainer}>
                    <Ionicons name="compass-outline" size={16} color="#94A3B8" style={{ marginRight: 8 }} />
                    <TextInput
                      style={styles.referenceTextInput}
                      placeholder="Ref. Partida (opcional: ex: Perto da Farmácia Central)"
                      placeholderTextColor="#64748B"
                      value={pickupReferencePoint}
                      onChangeText={(val) => setPickupReferencePoint(val)}
                      maxLength={80}
                    />
                  </View>
                </View>

                {/* PARADA EXTRA */}
                {showExtraStop && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <TouchableOpacity style={[styles.mainSearchInput, { flex: 1, borderColor: '#3B82F6', marginBottom: 0 }]} activeOpacity={0.8} onPress={() => openSearchModal('extraStop')}>
                      <Ionicons name="location-sharp" size={18} color="#3B82F6" style={{ marginRight: 12 }} />
                      <Text style={styles.mainSearchText} numberOfLines={1} ellipsizeMode="tail">
                        {extraStopAddress || 'Adicionar Parada Intermediária...'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={{ padding: 10, marginLeft: 6, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 12 }} 
                      onPress={() => { 
                        setShowExtraStop(false); 
                        setExtraStopAddress(''); 
                        setExtraStopCoords(null); 
                      }}
                    >
                      <Ionicons name="trash-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                )}

                {/* DESTINO */}
                <View style={{ marginBottom: 10 }}>
                  <TouchableOpacity style={styles.mainSearchInput} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                    <Ionicons name="flag" size={20} color="#EF4444" style={{ marginRight: 12 }} />
                    <Text style={styles.mainSearchText} numberOfLines={1} ellipsizeMode="tail">
                      {dropoffAddress || t('enter_destination_placeholder', 'Digite seu destino...')}
                    </Text>
                  </TouchableOpacity>

                  {Boolean(dropoffAddress) && (
                    <View style={styles.referenceInputContainer}>
                      <Ionicons name="compass-outline" size={16} color="#94A3B8" style={{ marginRight: 8 }} />
                      <TextInput
                        style={styles.referenceTextInput}
                        placeholder="Ref. Destino (opcional: ex: Em frente ao Mercado)"
                        placeholderTextColor="#64748B"
                        value={dropoffReferencePoint}
                        onChangeText={(val) => setDropoffReferencePoint(val)}
                        maxLength={80}
                      />
                    </View>
                  )}
                </View>

                {!showExtraStop && (
                  <TouchableOpacity 
                    style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6, paddingHorizontal: 4 }} 
                    onPress={() => { 
                      setShowExtraStop(true); 
                      openSearchModal('extraStop'); 
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={20} color="#3B82F6" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#3B82F6', fontWeight: '600', fontSize: 13 }}>+ Adicionar Parada Intermediária</Text>
                  </TouchableOpacity>
                )}

                {Boolean(pickupCoords && dropoffCoords && dropoffAddress.trim()) ? (
                  <GlowingButton
                    title={t('next_btn', 'Avançar')}
                    onPress={() => setBookingStep('SERVICE_AND_PRICE')}
                    isGlowEnabled={isBorderGlowEnabled}
                    style={{ height: 48, marginTop: 8 }}
                  />
                ) : (
                  <TouchableOpacity 
                    style={[styles.requestButton, { backgroundColor: 'rgba(30, 41, 59, 0.8)', borderWidth: 1, borderColor: '#334155' }]} 
                    activeOpacity={0.8} 
                    onPress={() => openSearchModal('dropoff')}
                  >
                    <Text style={[styles.requestButtonText, { color: '#EAB308' }]}>{t('where_do_you_want_to_go', 'Aonde você quer ir?')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* 💳 FORMA DE PAGAMENTO E BOTÃO CANCELAR/VOLTAR */}
            {rideStatus === 'idle' && bookingStep === 'PAYMENT' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>{t('payment_method', 'Forma de Pagamento')}</Text>
                
                <View style={styles.paymentOptionsContainer}>
                  <TouchableOpacity 
                    style={[
                      styles.paymentBtn, 
                      styles.paymentBtnActive, 
                      { 
                        backgroundColor: 'rgba(30, 41, 59, 0.8)', 
                        borderColor: '#10B981', 
                        borderWidth: 1,
                        paddingVertical: 14 
                      }
                    ]}
                    activeOpacity={0.9}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(16, 185, 129, 0.15)', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="cash-outline" size={18} color="#10B981" />
                    </View>

                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.paymentBtnText, { color: '#F8FAFC', fontWeight: '800', fontSize: 14 }]}>
                        {t('cash_payment', 'Dinheiro em Espécie')}
                      </Text>
                      <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
                        {t('cash_desc', 'Pague diretamente ao motorista no final da viagem')}
                      </Text>
                    </View>

                    <Ionicons 
                      name="checkmark-circle" 
                      size={22} 
                      color="#10B981" 
                    />
                  </TouchableOpacity>
                </View>

                {/* 🔴 BOTÕES DE AÇÃO COM BOTÃO DE CANCELAR */}
                <View style={styles.actionRow}>
                  <TouchableOpacity 
               style={styles.cancelButtonOutline} 
                    onPress={handleFullCancelAndReset}
                activeOpacity={0.8}
              >
              <Text style={styles.cancelButtonOutlineText}>Cancelar</Text>
              </TouchableOpacity>

                  <View style={{ flex: 1.5 }}>
                    <GlowingButton
                      title={t('request_now_btn', 'Pedir Agora')}
                      onPress={handleInitialRequestRide}
                      isGlowEnabled={isBorderGlowEnabled}
                      style={{ height: 48 }}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* 🔑 PIN DE EMBARQUE */}
            {(rideStatus === 'accepted' || rideStatus === 'arrived') && Boolean(activeOtpPin) && (
              <View style={styles.pinCardContainer}>
                <View style={styles.pinHeader}>
                  <Ionicons name="shield-checkmark-sharp" size={18} color="#10B981" />
                  <Text style={styles.pinTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
                </View>
                <Text style={styles.pinSubtitle}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
                <View style={styles.pinDigitsRow}>
                  {activeOtpPin.split('').map((digit, index) => (
                    <View key={`pin-digit-${index}`} style={styles.pinDigitBox}>
                      <Text style={styles.pinDigitText}>{digit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* 📡 BUSCANDO MOTORISTA */}
            {rideStatus === 'searching' && (
              <View style={styles.statusBox}>
                <View style={{ height: 90, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                  <Animated.View
                    style={[
                      styles.radarWaveCircle,
                      { width: 70, height: 70, borderRadius: 35, transform: [{ scale: radarScale1 }], opacity: radarOpacity1 }
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.radarWaveCircle,
                      { width: 70, height: 70, borderRadius: 35, transform: [{ scale: radarScale2 }], opacity: radarOpacity2 }
                    ]}
                  />
                  <View style={styles.radarCenterPin}>
                    <Ionicons name="car-sport" size={24} color="#EAB308" />
                  </View>
                </View>

                <Text style={styles.statusTitle}>{t('searching_drivers_title', 'Procurando motoristas próximos...')}</Text>
                <Text style={styles.statusSub}>{t('locating_nearest_vehicle', 'Conectando ao veículo mais rápido de Guiné-Bissau.')}</Text>
                
                <TouchableOpacity 
                  style={[styles.cancelButtonOutline, { marginTop: 18 }]} 
                  onPress={() => setShowCancelModal(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelButtonOutlineText}>{t('cancel_search_btn', 'Cancelar Busca')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 📊 ACOMPANHAMENTO DA CORRIDA */}
            {['accepted', 'arrived', 'in_progress'].includes(rideStatus) && driverInfo && (
              <View style={styles.activeRideContainer}>
                
                {/* HEADER DE STATUS E VALOR */}
                <View style={styles.activeRideHeader}>
                  <View style={styles.statusPulseBox}>
                    <View style={styles.statusPulseDot} />
                    <Text style={styles.activeRideStatusTitle}>
                      {rideStatus === 'accepted' 
                        ? (driverEta ? `Motorista a caminho (${driverEta} min)` : 'Motorista a caminho') :
                       rideStatus === 'arrived' 
                        ? '📍 O motorista chegou ao local!' : 
                       (driverEta ? `Em Viagem • Chegada em ${driverEta} min` : 'Viagem em Andamento')}
                    </Text>

                    {estimatedDistance ? (
                      <View style={{ backgroundColor: 'rgba(15, 23, 42, 0.8)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 4, alignSelf: 'flex-start' }}>
                        <Text style={{ color: '#EAB308', fontSize: 12, fontWeight: 'bold' }}>
                          📍 {estimatedDistance.toFixed(1)} km
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.priceBadgeHeader}>
                    <Text style={styles.priceBadgeLabel}>VALOR</Text>
                    <Text style={styles.priceBadgeValue}>
                      {estimatedPrice ? `${estimatedPrice.toLocaleString('pt-GW')} XOF` : 'A calcular'}
                    </Text>
                  </View>
                </View>

                {/* ITINERÁRIO */}
                <View style={styles.routeTimelineContainer}>
                  <Text style={styles.routeTimelineHeaderTitle}>ITINERÁRIO DA VIAGEM</Text>
                  
                  <View style={styles.timelineItem}>
                    <View style={[styles.timelineIconBg, { backgroundColor: '#10B981' }]}>
                      <Ionicons name="location" size={14} color="#FFF" />
                    </View>
                    <View style={styles.timelineTextWrapper}>
                      <Text style={styles.timelineLabel}>Origem</Text>
                      <Text style={styles.timelineValue} numberOfLines={1}>{pickupAddress}</Text>
                    </View>
                  </View>

                  {extraStopCoords && (
                    <View style={styles.timelineItem}>
                      <View style={[styles.timelineIconBg, { backgroundColor: '#3B82F6' }]}>
                        <Ionicons name="location-sharp" size={14} color="#FFF" />
                      </View>
                      <View style={styles.timelineTextWrapper}>
                        <Text style={[styles.timelineLabel, { color: '#60A5FA' }]}>Parada Intermediária</Text>
                        <Text style={styles.timelineValue} numberOfLines={1}>{extraStopAddress || 'Parada 1'}</Text>
                      </View>
                    </View>
                  )}

                  <View style={styles.timelineItem}>
                    <View style={[styles.timelineIconBg, { backgroundColor: '#EF4444' }]}>
                      <Ionicons name="flag" size={14} color="#FFF" />
                    </View>
                    <View style={styles.timelineTextWrapper}>
                      <Text style={styles.timelineLabel}>Destino Final</Text>
                      <Text style={styles.timelineValue} numberOfLines={1}>{dropoffAddress}</Text>
                    </View>
                  </View>

                  <View style={styles.paymentMethodChip}>
                    <Ionicons name="cash" size={14} color="#EAB308" />
                    <Text style={styles.paymentMethodChipText}>
                      Pagamento: Dinheiro em Espécie
                    </Text>
                  </View>
                </View>

                {/* DADOS DO MOTORISTA */}
                <View style={styles.driverCardCompact}>
                  <Image 
                    source={{ uri: driverInfo.photoUrl || driverInfo.profilePicture || 'https://via.placeholder.com/100' }} 
                    style={styles.driverAvatarCompact} 
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.driverNameCompact}>{driverInfo.name}</Text>
                    <Text style={styles.vehicleModelCompact}>
                      {driverInfo.carModel || 'Veículo'} {driverInfo.carColor ? `• ${driverInfo.carColor}` : ''}
                    </Text>
                    <View style={styles.plateBadgeCompact}>
                      <Text style={styles.plateTextCompact}>{driverInfo.licensePlate?.toUpperCase() || 'SEM PLACA'}</Text>
                    </View>
                  </View>
                  <Image 
                    source={getVehicle3DIconAsset(driverInfo.vehicleType, driverInfo.carColor)} 
                    style={{ width: 48, height: 48 }} 
                    resizeMode="contain" 
                  />
                </View>

                {/* BOTÕES DE AÇÃO RÁPIDA */}
                <View style={styles.actionRowGrid}>
                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleSosPress} activeOpacity={0.8}>
                    <Ionicons name="shield-checkmark" size={18} color="#EF4444" />
                    <Text style={[styles.actionBtnText, { color: '#EF4444' }]}>SOS</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleCallDriver} activeOpacity={0.8}>
                    <Ionicons name="call" size={18} color="#EAB308" />
                    <Text style={[styles.actionBtnText, { color: '#EAB308' }]}>Ligar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleShareTrip} activeOpacity={0.8}>
                    <Ionicons name="share-social" size={18} color="#3B82F6" />
                    <Text style={[styles.actionBtnText, { color: '#3B82F6' }]}>Partilhar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.actionBtnPrimary} 
                    onPress={() => {
                      setUnreadCount(0);
                      setIsChatVisible(true);
                    }} 
                    activeOpacity={0.85}
                  >
                    <Ionicons name="chatbubble-ellipses" size={18} color="#0F172A" />
                    <Text style={styles.actionBtnPrimaryText}>Chat</Text>

                    {unreadCount > 0 && (
                      <View style={styles.chatBadgeContainer}>
                        <Text style={styles.chatBadgeText}>
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity 
                       style={styles.cancelRideLink} 
                        onPress={() => setShowCancelModal(true)}
                        >
                      <Text style={styles.cancelRideLinkText}>Cancelar Viagem</Text>
                       </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* 🏎️ CARTÃO DE RESUMO PARA VOZ */}
      {rideStatus !== 'idle' && (
        <View style={styles.driverInfoCard} accessibilityRole="summary">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.cardTitle}>Status da Viagem</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHapticFeedback('BUTTON_PRESS');
                speakText(
                  `Motorista ${driverInfo?.name || ''}, veículo ${driverInfo?.carModel || ''} ${driverInfo?.carColor || ''}, matrícula ${driverInfo?.licensePlate || ''}. Valor da corrida: ${estimatedPrice || 0} XOF.`
                );
              }}
              accessibilityLabel="Ouvir informações da viagem"
              style={{ padding: 6, backgroundColor: 'rgba(234, 179, 8, 0.2)', borderRadius: 20 }}
            >
              <Ionicons name="volume-medium" size={20} color="#EAB308" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => speakText(`Valor total: ${estimatedPrice || 0} XOF`)}
            style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}
          >
            <Text style={styles.priceText}>{estimatedPrice ? `${estimatedPrice.toLocaleString('pt-GW')} XOF` : '0 XOF'}</Text>
            <Ionicons name="volume-high-outline" size={16} color="#EAB308" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      )}

      {/* 🚕 MODAL DE SELEÇÃO DE VEÍCULO TRANSLÚCIDO COM BOTÃO CANCELAR */}
      <Modal
        visible={rideStatus === 'idle' && bookingStep === 'SERVICE_AND_PRICE'}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setBookingStep('ADDRESS')}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.88)' }}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.1)',
            backgroundColor: 'rgba(15, 23, 42, 0.92)'
          }}>
            <TouchableOpacity 
              onPress={() => setBookingStep('ADDRESS')}
              style={{ padding: 8, borderRadius: 20, backgroundColor: 'rgba(30, 41, 59, 0.8)', marginRight: 12 }}
            >
              <Ionicons name="arrow-back" size={22} color="#EAB308" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>Escolher Veículo</Text>
              <Text style={{ color: '#94A3B8', fontSize: 12 }} numberOfLines={1}>
                {pickupAddress} ➔ {dropoffAddress}
              </Text>
            </View>
          </View>
            {estimatedDistance != null && estimatedDistance > 0 && (
                <Text style={{ color: '#EAB308', fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                  📍 Distância da rota: {estimatedDistance.toFixed(1)} km {driverEta ? `• ~${driverEta} min` : ''}
                </Text>
              )}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.sectionLabel}>{t('service_type', 'Tipo de Serviço')}</Text>
            <View style={styles.serviceTypesContainer}>
              <TouchableOpacity 
                style={[styles.serviceTypeButton, serviceType === 'viagem' && styles.serviceTypeActive]}
                onPress={() => setServiceType('viagem')}
              >
                <Ionicons name="car-outline" size={18} color={serviceType === 'viagem' ? '#0F172A' : '#94A3B8'} />
                <Text style={[styles.serviceTypeText, serviceType === 'viagem' && styles.serviceTypeTextActive]}>Viagem</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.serviceTypeButton, serviceType === 'entrega' && styles.serviceTypeActive]}
                onPress={() => setServiceType('entrega')}
              >
                <Ionicons name="cube-outline" size={18} color={serviceType === 'entrega' ? '#0F172A' : '#94A3B8'} />
                <Text style={[styles.serviceTypeText, serviceType === 'entrega' && styles.serviceTypeTextActive]}>Entrega</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.serviceTypeButton, serviceType === 'aluguel' && styles.serviceTypeActive]}
                onPress={() => setServiceType('aluguel')}
              >
                <Ionicons name="key-outline" size={18} color={serviceType === 'aluguel' ? '#0F172A' : '#94A3B8'} />
                <Text style={[styles.serviceTypeText, serviceType === 'aluguel' && styles.serviceTypeTextActive]}>Aluguel</Text>
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
              <View style={{ marginTop: 12 }}>
                <Text style={styles.sectionLabel}>Veículos Disponíveis</Text>
                <View style={{ gap: 10, marginBottom: 16 }}>
                  {VEHICLE_OPTIONS.map((item) => {
                    const isSelected = vehicleType === item.id;
                    const price = calculateVehiclePrice(item.id, estimatedDistance);
                    return (
                      <TouchableOpacity 
                        key={item.id} 
                        style={[
                          styles.categoryCard, 
                          isSelected && styles.categoryCardActive,
                          { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16 }
                        ]}
                        activeOpacity={0.85}
                        onPress={() => setVehicleType(item.id)}
                      >
                        <Image source={item.image} style={{ width: 55, height: 40 }} resizeMode="contain" />
                        <View style={[styles.categoryTextWrapper, { marginLeft: 12 }]}>
                          <Text style={[styles.categoryTitle, isSelected && styles.categoryTextActive, { fontSize: 15 }]}>{item.title}</Text>
                          <Text style={styles.categorySubtitle}>{item.subtitle}</Text>
                        </View>
                        {isCalculatingPrice ? (
                          <SkeletonLoader width={70} height={18} borderRadius={6} />
                        ) : (
                          <Text style={[styles.categoryPriceText, isSelected && styles.categoryPriceTextActive, { fontSize: 15, fontWeight: '900' }]}>
                            {price ? `${price} XOF` : 'Calculando...'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 🔴 BARRA INFERIOR DE ESCOLHA DE VEÍCULO COM BOTÃO CANCELAR */}
            <View style={{
              paddingVertical: 16,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.1)',
              backgroundColor: 'transparent',
              flexDirection: 'row',
              gap: 10
            }}>
              <TouchableOpacity 
                style={styles.cancelButtonOutline} 
                onPress={() => setBookingStep('ADDRESS')}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelButtonOutlineText}>Cancelar</Text>
              </TouchableOpacity>

              <View style={{ flex: 1.5 }}>
                <GlowingButton
                  title="Continuar para Pagamento ➔"
                  onPress={() => setBookingStep('PAYMENT')}
                  isGlowEnabled={isBorderGlowEnabled}
                  style={{ height: 52 }}
                />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 🌐 MODAL DE IDIOMAS TRANSLÚCIDO */}
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
                      activeOpacity={0.7}
                    >
                      <Text style={styles.langOptionText}>{lang.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity 
                    style={styles.closeButton} 
                    onPress={() => setLangModalVisible(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>{t('back_btn', 'Fechar')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* 📍 MODAL DE PERMISSÃO DE GPS TRANSLÚCIDO */}
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
                    activeOpacity={0.85}
                  >
                    <Text style={styles.requestButtonText}>{t('open_settings', 'Abrir Configurações')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.cancelButtonOutline} 
                    onPress={getCurrentLocationWithFallback}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelButtonOutlineText}>{t('try_again', 'Já ativei / Tentar novamente')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* 📑 MENU LATERAL DRAWER TRANSLÚCIDO */}
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
              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={toggleBorderGlow} 
                activeOpacity={0.7}
              >
                <Ionicons 
                  name="flash-outline" 
                  size={20} 
                  color={isBorderGlowEnabled ? "#EAB308" : "#94A3B8"} 
                />
                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
                  <Text style={styles.menuItemText}>Efeito Raio Luminoso</Text>
                  <View style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 10,
                    backgroundColor: isBorderGlowEnabled ? '#EAB308' : '#334155'
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: isBorderGlowEnabled ? '#0F172A' : '#FFF' }}>
                      {isBorderGlowEnabled ? 'LIGADO' : 'DESLIGADO'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={toggleVoiceAssist} 
                activeOpacity={0.7}
              >
                <Ionicons 
                  name={isVoiceAssistEnabled ? "volume-high-outline" : "volume-mute-outline"} 
                  size={20} 
                  color={isVoiceAssistEnabled ? "#EAB308" : "#94A3B8"} 
                />
                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
                  <Text style={styles.menuItemText}>{t('voice_assist', 'Assistência por Voz')}</Text>
                  <View style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 10,
                    backgroundColor: isVoiceAssistEnabled ? '#EAB308' : '#334155'
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: 'bold', color: isVoiceAssistEnabled ? '#0F172A' : '#FFF' }}>
                      {isVoiceAssistEnabled ? 'LIGADO' : 'DESLIGADO'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={() => { 
                  setIsMenuVisible(false); 
                  navigation.navigate('Profile'); 
                }} 
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={20} color="#F8FAFC" />
                <Text style={styles.menuItemText}>{t('my_profile', 'Meu Perfil')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={() => { 
                  setIsMenuVisible(false); 
                  navigation.navigate('RideHistory'); 
                }} 
                activeOpacity={0.7}
              >
                <Ionicons name="time-outline" size={20} color="#F8FAFC" />
                <Text style={styles.menuItemText}>{t('my_rides', 'Minhas Corridas')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={() => { 
                  setIsMenuVisible(false); 
                  navigation.navigate('EmergencyContacts'); 
                }} 
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color="#F8FAFC" />
                <Text style={styles.menuItemText}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={() => { 
                  setIsMenuVisible(false); 
                  navigation.navigate('HelpCenter'); 
                }} 
                activeOpacity={0.7}
              >
                <Ionicons name="help-buoy-outline" size={20} color="#F8FAFC" />
                <Text style={styles.menuItemText}>{t('help_center', 'Central de Ajuda')}</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity 
                style={styles.menuItem} 
                onPress={() => { 
                  setIsMenuVisible(false); 
                  signOut(); 
                }} 
                activeOpacity={0.7}
              >
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{t('logout', 'Sair da Conta')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 🔀 MODAL DE BUSCA TRANSLÚCIDO MAPBOX */}
      <Modal 
        visible={isSearchModalVisible} 
        animationType="slide" 
        transparent={true} 
        onRequestClose={() => setIsSearchModalVisible(false)}
      >
        <SafeAreaView style={styles.searchModalContainer}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
            style={{ flex: 1 }}
          >
            <View style={styles.searchHeader}>
              <TouchableOpacity 
                onPress={() => setIsSearchModalVisible(false)} 
                style={styles.backButton} 
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={24} color="#F8FAFC" />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.passengerSelector} 
                onPress={() => setIsGuestModalVisible(true)} 
                activeOpacity={0.8}
              >
                <Ionicons name="person" size={13} color="#EAB308" style={{ marginRight: 6 }} />
                <Text style={styles.passengerSelectorText}>
                  {isForAnotherPerson ? (guestName || 'Outra Pessoa') : t('for_me', 'Para mim')}
                </Text>
              </TouchableOpacity>

              <View style={{ width: 40 }} />
            </View>

            <View style={styles.modalBody}>
              <ScrollView 
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                <View style={{ flexDirection: 'row', marginBottom: 15, paddingHorizontal: 4 }}>
                  <View style={{ alignItems: 'center', marginRight: 12, paddingTop: 14 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#EAB308' }} />
                    <View style={{ width: 2, height: showExtraStop ? 110 : 70, backgroundColor: '#334155', marginVertical: 4 }} />
                    {showExtraStop && (
                      <>
                        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#3B82F6' }} />
                        <View style={{ width: 2, height: 70, backgroundColor: '#334155', marginVertical: 4 }} />
                      </>
                    )}
                    <View style={{ width: 12, height: 12, backgroundColor: '#EF4444', borderRadius: 2 }} />
                  </View>

                  <View style={{ flex: 1 }}>
                    {/* EMBARQUE */}
                    <View style={{ marginBottom: 12 }}>
                      <Text style={{ color: '#EAB308', fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                        PONTO DE PARTIDA (EMBARQUE) *
                      </Text>
                      <View style={[
                        styles.mapboxSearchInputWrapper, 
                        searchType === 'pickup' ? { borderColor: '#EAB308', borderWidth: 1 } : { borderWidth: 1, borderColor: '#334155' }
                      ]}>
                        <Ionicons name="location" size={18} color="#EAB308" style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.mapboxSearchInput}
                          placeholder={t('pickup_location', 'Local de Partida')}
                          placeholderTextColor="#64748B"
                          value={searchType === 'pickup' ? searchQuery : pickupAddress}
                          autoCorrect={false}
                          onFocus={() => { 
                            setSearchType('pickup'); 
                            setSearchQuery(pickupAddress); 
                          }}
                          onChangeText={(text) => {
                            setSearchQuery(text);
                            handleMapboxSearch(text);
                          }}
                        />
                        {isSearchingMapbox && searchType === 'pickup' ? (
                          <ActivityIndicator size="small" color="#EAB308" style={{ marginRight: 6 }} />
                        ) : (searchType === 'pickup' ? searchQuery : pickupAddress) ? (
                          <TouchableOpacity onPress={() => { setSearchQuery(''); setPickupAddress(''); setPickupCoords(null); }}>
                            <Ionicons name="close-circle" size={18} color="#64748B" />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.referenceInputContainer}>
                        <Ionicons name="compass" size={15} color="#EAB308" style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.referenceTextInput}
                          placeholder="Ref. Partida (opcional: ex: Perto da Farmácia Central)"
                          placeholderTextColor="#64748B"
                          value={pickupReferencePoint}
                          onChangeText={setPickupReferencePoint}
                          maxLength={80}
                        />
                      </View>
                    </View>

                    {/* PARADA EXTRA */}
                    {showExtraStop && (
                      <View style={{ marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <Text style={{ color: '#3B82F6', fontSize: 11, fontWeight: '800' }}>
                            PARADA INTERMEDIÁRIA
                          </Text>
                          <TouchableOpacity onPress={() => { 
                            setShowExtraStop(false); 
                            setExtraStopAddress(''); 
                            setExtraStopCoords(null); 
                            setExtraStopReferencePoint(''); 
                          }}>
                            <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '600' }}>Remover</Text>
                          </TouchableOpacity>
                        </View>
                        
                        <View style={[
                          styles.mapboxSearchInputWrapper, 
                          searchType === 'extraStop' ? { borderColor: '#3B82F6', borderWidth: 1 } : { borderWidth: 1, borderColor: '#334155' }
                        ]}>
                          <Ionicons name="location-sharp" size={18} color="#3B82F6" style={{ marginRight: 8 }} />
                          <TextInput
                            style={styles.mapboxSearchInput}
                            placeholder="Adicionar Parada..."
                            placeholderTextColor="#64748B"
                            value={searchType === 'extraStop' ? searchQuery : extraStopAddress}
                            autoCorrect={false}
                            onFocus={() => { 
                              setSearchType('extraStop'); 
                              setSearchQuery(extraStopAddress); 
                            }}
                            onChangeText={(text) => {
                              setSearchQuery(text);
                              handleMapboxSearch(text);
                            }}
                          />
                        </View>

                        <View style={styles.referenceInputContainer}>
                          <Ionicons name="compass-outline" size={15} color="#3B82F6" style={{ marginRight: 8 }} />
                          <TextInput
                            style={styles.referenceTextInput}
                            placeholder="Ref. Parada (opcional)"
                            placeholderTextColor="#64748B"
                            value={extraStopReferencePoint}
                            onChangeText={setExtraStopReferencePoint}
                            maxLength={80}
                          />
                        </View>
                      </View>
                    )}

                    {/* DESTINO FINAL */}
                    <View style={{ marginBottom: 8 }}>
                      <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '800', marginBottom: 4 }}>
                        DESTINO FINAL (DESEMBARQUE) *
                      </Text>
                      <View style={[
                        styles.mapboxSearchInputWrapper, 
                        searchType === 'dropoff' ? { borderColor: '#EF4444', borderWidth: 1 } : { borderWidth: 1, borderColor: '#334155' }
                      ]}>
                        <Ionicons name="flag" size={18} color="#EF4444" style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.mapboxSearchInput}
                          placeholder={t('where_to', 'Para onde vamos?')}
                          placeholderTextColor="#64748B"
                          value={searchType === 'dropoff' ? searchQuery : dropoffAddress}
                          autoCorrect={false}
                          onFocus={() => { 
                            setSearchType('dropoff'); 
                            setSearchQuery(dropoffAddress); 
                          }}
                          onChangeText={(text) => {
                            setSearchQuery(text);
                            handleMapboxSearch(text);
                          }}
                        />
                        {isSearchingMapbox && searchType === 'dropoff' ? (
                          <ActivityIndicator size="small" color="#EF4444" style={{ marginRight: 6 }} />
                        ) : (searchType === 'dropoff' ? searchQuery : dropoffAddress) ? (
                          <TouchableOpacity onPress={() => { setSearchQuery(''); setDropoffAddress(''); setDropoffCoords(null); }}>
                            <Ionicons name="close-circle" size={18} color="#64748B" />
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      <View style={styles.referenceInputContainer}>
                        <Ionicons name="compass" size={15} color="#EF4444" style={{ marginRight: 8 }} />
                        <TextInput
                          style={styles.referenceTextInput}
                          placeholder="Ref. Destino (opcional: ex: Em frente ao Mercado)"
                          placeholderTextColor="#64748B"
                          value={dropoffReferencePoint}
                          onChangeText={setDropoffReferencePoint}
                          maxLength={80}
                        />
                      </View>
                    </View>

                    {!showExtraStop && (
                      <TouchableOpacity 
                        style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center' }} 
                        onPress={() => { 
                          setShowExtraStop(true); 
                          setSearchType('extraStop'); 
                          setSearchQuery(''); 
                        }}
                      >
                        <Ionicons name="add-circle-outline" size={18} color="#3B82F6" />
                        <Text style={{ color: '#3B82F6', fontWeight: '700', marginLeft: 6, fontSize: 13 }}>
                          + Adicionar Parada Intermediária
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {searchQuery.trim().length === 0 ? (
                  <View>
                    <Text style={styles.sectionHeaderTitle}>Locais Salvos</Text>
                    
                    <TouchableOpacity 
                      style={styles.savedPlaceRow} 
                      onPress={() => handleFavoritePress('home')}
                      onLongPress={() => {
                        if (pickupCoords) {
                          saveFavoritePlace('home', { address: pickupAddress, ...pickupCoords });
                        }
                      }}
                    >
                      <View style={[styles.savedIconCircle, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="home" size={20} color="#D97706" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.savedPlaceTitle}>Casa</Text>
                        <Text style={styles.savedPlaceSub} numberOfLines={1}>
                          {homeLocation ? homeLocation.address : 'Segure para definir a localização atual como Casa'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.savedPlaceRow} 
                      onPress={() => handleFavoritePress('work')}
                      onLongPress={() => {
                        if (pickupCoords) {
                          saveFavoritePlace('work', { address: pickupAddress, ...pickupCoords });
                        }
                      }}
                    >
                      <View style={[styles.savedIconCircle, { backgroundColor: '#E0F2FE' }]}>
                        <Ionicons name="briefcase" size={20} color="#0284C7" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.savedPlaceTitle}>Trabalho</Text>
                        <Text style={styles.savedPlaceSub} numberOfLines={1}>
                          {workLocation ? workLocation.address : 'Segure para definir a localização atual como Trabalho'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {recentSearches.length > 0 && (
                      <View style={{ marginTop: 20 }}>
                        <Text style={styles.sectionHeaderTitle}>Pesquisas Recentes</Text>
                        {recentSearches.map((item) => (
                          <View key={item.id} style={styles.recentItemRow}>
                            <TouchableOpacity 
                              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                              onPress={() => {
                                if (searchType === 'pickup') {
                                  isManualPickupRef.current = true;
                                  setPickupAddress(item.description);
                                  setPickupCoords({ latitude: item.latitude, longitude: item.longitude });
                                } else if (searchType === 'extraStop') {
                                  setExtraStopAddress(item.description);
                                  setExtraStopCoords({ latitude: item.latitude, longitude: item.longitude });
                                } else {
                                  setDropoffAddress(item.description);
                                  setDropoffCoords({ latitude: item.latitude, longitude: item.longitude });
                                  setIsSearchModalVisible(false);
                                  setBookingStep('SERVICE_AND_PRICE');
                                }
                              }}
                            >
                              <Ionicons name="time-outline" size={20} color="#64748B" />
                              <Text style={styles.recentText} numberOfLines={1}>{item.description}</Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity 
                              onPress={() => removeRecentSearch(item.id)} 
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                              <Ionicons name="close-circle" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    {searchResults.map((item) => (
                      <TouchableOpacity
                        key={item.id}
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
                            const selectedFeature = {
                              id: `recent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                              description: item.description,
                              latitude: item.latitude,
                              longitude: item.longitude,
                            };
                            saveToRecentSearches(selectedFeature);
                            setDropoffAddress(item.description);
                            setDropoffCoords({ latitude: item.latitude, longitude: item.longitude });
                            setIsSearchModalVisible(false);
                            setBookingStep('SERVICE_AND_PRICE');
                          }
                        }}
                      >
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                          <Ionicons name="location" size={18} color="#EAB308" />
                        </View>
                        <Text style={[styles.searchResultText, { color: '#F8FAFC' }]}>{item.description}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* 👤 MODAL: VIAGEM PARA OUTRA PESSOA TRANSLÚCIDO */}
      <Modal
        visible={isGuestModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsGuestModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlayInner}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.modalContainer, { paddingBottom: Math.max((insets?.bottom || 0) + 16, 20) }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={styles.modalTitle}>{t('ride_for_another_person', 'Viagem para Outra Pessoa')}</Text>
                    <TouchableOpacity onPress={() => setIsGuestModalVisible(false)}>
                      <Ionicons name="close-circle" size={24} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>

                  <Text style={{ color: '#94A3B8', fontSize: 13, marginBottom: 16 }}>
                    O motorista receberá o nome e o número de telefone do passageiro para facilitá-lo no momento do embarque.
                  </Text>

                  <Text style={styles.inputLabel}>Nome do Passageiro</Text>
                  <View style={[styles.phoneInputContainer, { marginBottom: 12 }]}>
                    <Ionicons name="person-outline" size={18} color="#94A3B8" style={{ marginLeft: 12 }} />
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="Ex: Mamadou Djalo"
                      placeholderTextColor="#64748B"
                      value={guestName}
                      onChangeText={setGuestName}
                    />
                  </View>

                  <Text style={styles.inputLabel}>Telefone do Passageiro (Guiné-Bissau)</Text>
                  <View style={[styles.phoneInputContainer, { marginBottom: 20 }]}>
                    <Ionicons name="call-outline" size={18} color="#94A3B8" style={{ marginLeft: 12 }} />
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="Ex: 955000000"
                      placeholderTextColor="#64748B"
                      keyboardType="phone-pad"
                      value={guestPhone}
                      onChangeText={(tVal) => setGuestPhone(tVal.replace(/[^0-9]/g, ''))}
                      maxLength={12}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={[styles.cancelButtonOutline, { flex: 1 }]}
                      onPress={() => {
                        setIsForAnotherPerson(false);
                        setGuestName('');
                        setGuestPhone('');
                        setIsGuestModalVisible(false);
                      }}
                    >
                      <Text style={styles.cancelButtonOutlineText}>Remover</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.requestButton, { flex: 1 }]}
                      onPress={() => {
                        if (guestName.trim() && guestPhone.trim()) {
                          setIsForAnotherPerson(true);
                          setIsGuestModalVisible(false);
                        } else {
                          Alert.alert('Preencha os dados', 'Informe o nome e número do passageiro.');
                        }
                      }}
                    >
                      <Text style={styles.requestButtonText}>Salvar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* 💬 CHATMODAL DO PASSAGEIRO */}
<ChatModal 
  visible={isChatVisible} 
  onClose={() => {
    setIsChatVisible(false);
    setUnreadCount(0); // 🟢 Zera o badge de não lidas ao fechar
  }} 
  socket={socket} 
  rideId={activeRideId || ''} 
  currentRole="passenger" 
  currentUserPhoto={user?.profilePicture ? formatPhotoUrl(user.profilePicture) : null} 
  otherUserName={driverInfo?.name || 'Motorista'} 
  otherUserPhoto={driverInfo?.photoUrl || driverInfo?.profilePicture} 
/>

      {/* 🛑 MODAL DE CANCELAMENTO */}
      <CancelModal
        visible={showCancelModal}
        userType="PASSENGER"
        isPenaltyApplicable={checkPenaltyApplicable()}
        onClose={handleCloseCancelModal} 
        onConfirm={handleConfirmCancel} 
      /> 

      {/* ⭐ MODAL DE AVALIAÇÃO COM GORJETA */}
      <RatingModal
        visible={showRatingModal}
        targetName={driverInfo?.name || 'Motorista'}
        onSubmit={handleSubmitRating} 
      />
    </View>
  );
}

// 🎨 ESTILOS UNIFICADOS COM GLASSMORPHISM E TRANSPARÊNCIA (SISTEMA NÔ BAI 245)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#F8FAFC',
    fontSize: 15,
    textAlign: 'center',
    marginVertical: 16,
    fontWeight: '500',
  },
  retryLocationBtn: {
    backgroundColor: '#EAB308',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 10,
  },
  floatingHeader: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  headerBlurWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  headerUserInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
  },
  greetingText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  voiceToggleHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langHeaderBtn: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  langHeaderBtnText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '800',
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  radarWaveCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(234, 179, 8, 0.25)',
    borderWidth: 1.5,
    borderColor: '#EAB308',
  },
  radarCenterPin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EAB308',
    elevation: 6,
  },
  driverMarkerWrapper: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverMarkerImage: {
    width: 36,
    height: 36,
  },
  driverEtaBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAB308',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginBottom: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  driverEtaText: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '900',
  },
  pickupMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#EAB308',
  },
  carMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPinContainer: {
    position: 'absolute',
    top: '42%',
    left: '50%',
    marginLeft: -18,
    marginTop: -36,
    alignItems: 'center',
    zIndex: 10,
  },
  centerPin: {
    alignItems: 'center',
  },
  pinShadow: {
    width: 12,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 6,
    marginTop: -4,
  },
  floatingSafetyShieldBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    elevation: 6,
    zIndex: 15,
  },
  recenterButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    elevation: 6,
    zIndex: 15,
  },
  favoritesContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 10,
    zIndex: 15,
  },
  favoriteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 8,
  },
  favoriteIconBg: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  pinSecurityBadge: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#EAB308',
    zIndex: 15,
    gap: 10,
  },
  pinSecurityTextContainer: {
    flex: 1,
  },
  pinSecurityTitle: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '800',
  },
  pinSecuritySub: {
    color: '#94A3B8',
    fontSize: 11,
  },
  pinCodeBox: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  pinCodeText: {
    color: '#EAB308',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  bottomSheetWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  bottomSheet: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    elevation: 12,
  },
  dragHandlerArea: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
  },
  sheetTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  mainSearchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  mainSearchText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  referenceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  referenceTextInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 12,
    paddingVertical: 6,
  },
  requestButton: {
    backgroundColor: '#EAB308',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  requestButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  paymentOptionsContainer: {
    marginBottom: 16,
  },
  paymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  paymentBtnActive: {
    borderColor: '#10B981',
  },
  paymentBtnText: {
    color: '#F8FAFC',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cancelButtonOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  cancelButtonOutlineText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '800',
  },
  pinCardContainer: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#10B981',
    marginBottom: 12,
  },
  pinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinTitle: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  pinSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginVertical: 4,
  },
  pinDigitsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  pinDigitBox: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  pinDigitText: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '900',
  },
  statusBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  statusTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusSub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  activeRideContainer: {
    gap: 12,
  },
  activeRideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPulseBox: {
    flex: 1,
  },
  statusPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginBottom: 4,
  },
  activeRideStatusTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  priceBadgeHeader: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  priceBadgeLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '800',
  },
  priceBadgeValue: {
    color: '#EAB308',
    fontSize: 14,
    fontWeight: '900',
  },
  routeTimelineContainer: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 16,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  routeTimelineHeaderTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineIconBg: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineTextWrapper: {
    flex: 1,
  },
  timelineLabel: {
    color: '#94A3B8',
    fontSize: 10,
  },
  timelineValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  paymentMethodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  paymentMethodChipText: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '600',
  },
  driverCardCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  driverAvatarCompact: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#334155',
  },
  driverNameCompact: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  vehicleModelCompact: {
    color: '#94A3B8',
    fontSize: 12,
  },
  plateBadgeCompact: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  plateTextCompact: {
    color: '#EAB308',
    fontSize: 10,
    fontWeight: '800',
  },
  actionRowGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  actionBtnPrimary: {
    flex: 1.2,
    backgroundColor: '#EAB308',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionBtnPrimaryText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  chatBadgeContainer: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  chatBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
  },
  cancelRideLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelRideLinkText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  driverInfoCard: {
    position: 'absolute',
    top: -999,
    left: 0,
  },
  cardTitle: { color: '#FFF' },
  priceText: { color: '#EAB308', fontSize: 16, fontWeight: 'bold' },
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
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  categoryCardActive: {
    borderColor: '#EAB308',
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
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
    color: '#94A3B8',
    fontSize: 11,
  },
  categoryPriceText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  categoryPriceTextActive: {
    color: '#EAB308',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalOverlayInner: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  langOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  langOptionText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  },
  closeButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
  },
  locationModalCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  locationIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  locationModalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  locationModalText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  menuDrawer: {
    width: '80%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingHorizontal: 20,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  menuHeader: {
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
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
    color: '#94A3B8',
    fontSize: 12,
  },
  menuItems: {
    marginTop: 16,
    gap: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
  },
  menuItemText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 10,
  },
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
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  backButton: {
    padding: 6,
  },
  passengerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  passengerSelectorText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  mapboxSearchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapboxSearchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
  },
  sectionHeaderTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  savedPlaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    gap: 12,
  },
  savedIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  savedPlaceTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  savedPlaceSub: {
    color: '#94A3B8',
    fontSize: 12,
  },
  recentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  recentText: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  searchResultText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  phoneInput: {
    flex: 1,
    color: '#F8FAFC',
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
});