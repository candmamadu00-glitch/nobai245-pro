import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  FlatList,
  ActivityIndicator,
  Dimensions,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Share,
  Linking,
  TouchableWithoutFeedback,
  Keyboard,
  AppState,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';

// Importações dos serviços e componentes internos
import {
  socket,
  connectPassengerSocket,
  emitRequestRide,
  cancelRideByPassenger,
  rateDriver,
  sendChatMessage,
  initiateMobileMoneyPayment,
  registerAndSendPushToken,
} from '../services/socket';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import CancelModal from '../components/CancelModal';
import RatingModal from '../components/RatingModal';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '');

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const STORAGE_RIDE_KEY = '@Nobai245:passenger_active_ride';

// Coordenadas Centrais de Bissau
const BISSAU_CENTER = {
  latitude: 11.8632,
  longitude: -15.5843,
};

// Catálogo de Bairros da Guiné-Bissau
const GUINEA_BISSAU_BAIRROS = [
  { id: 'bissau_centro', description: 'Bissau, Centro (Praça dos Heróis)', latitude: 11.8632, longitude: -15.5843, isLocalBairro: true },
  { id: 'bandim', description: 'Bandim (Mercado Central de Bandim)', latitude: 11.8550, longitude: -15.5750, isLocalBairro: true },
  { id: 'bantam', description: 'Bantam', latitude: 11.8600, longitude: -15.5700, isLocalBairro: true },
  { id: 'rossio', description: 'Rossio / Bissau Velho', latitude: 11.8580, longitude: -15.5820, isLocalBairro: true },
  { id: 'santa_luzia', description: 'Santa Luzia', latitude: 11.8710, longitude: -15.5890, isLocalBairro: true },
  { id: 'prufa', description: 'Prufa', latitude: 11.8670, longitude: -15.5800, isLocalBairro: true },
  { id: 'plaqueto', description: 'Plaqueto 1 e 2', latitude: 11.8750, longitude: -15.5850, isLocalBairro: true },
  { id: 'mindara', description: 'Mindara', latitude: 11.8720, longitude: -15.5780, isLocalBairro: true },
  { id: 'bairro_militar', description: 'Bairro Militar', latitude: 11.8800, longitude: -15.5900, isLocalBairro: true },
  { id: 'cuntum', description: 'Cuntum Madina', latitude: 11.8780, longitude: -15.5720, isLocalBairro: true },
  { id: 'ajuda', description: 'Bairro da Ajuda', latitude: 11.8850, longitude: -15.5820, isLocalBairro: true },
  { id: 'pessaque', description: 'Pessaque', latitude: 11.8820, longitude: -15.5760, isLocalBairro: true },
  { id: 'quelele', description: 'Quelelél', latitude: 11.8880, longitude: -15.6010, isLocalBairro: true },
  { id: 'sao_paulo', description: 'São Paulo', latitude: 11.8690, longitude: -15.5950, isLocalBairro: true },
  { id: 'belém', description: 'Belém', latitude: 11.8740, longitude: -15.5920, isLocalBairro: true },
  { id: 'antula', description: 'Antula Bono', latitude: 11.8950, longitude: -15.5800, isLocalBairro: true },
  { id: 'bor', description: 'Bor', latitude: 11.9050, longitude: -15.5750, isLocalBairro: true },
  { id: 'bissalanca', description: 'Bissalanca (Aeroporto Osvaldo Vieira)', latitude: 11.8900, longitude: -15.6500, isLocalBairro: true },
  { id: 'safim', description: 'Safim', latitude: 11.9500, longitude: -15.6500, isLocalBairro: true },
  { id: 'prabis', description: 'Prabis', latitude: 11.8000, longitude: -15.7500, isLocalBairro: true },
  { id: 'quinhamel', description: 'Quinhamel', latitude: 11.8833, longitude: -15.8667, isLocalBairro: true },
];

const LANGUAGES = [
  { code: 'pt', label: 'Português' },
  { code: 'crioulo', label: 'Kriol (Guiné-Bissau)' },
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];

type RideStatus = 'idle' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'queued' | 'completed';
type BookingStep = 'ADDRESS' | 'SERVICE_AND_PRICE' | 'PAYMENT';
type VehicleType = 'particular' | 'moto-carro' | 'toca-toca' | string;

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

export default function Home({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { t, i18n } = useTranslation();

  const isMountedRef = useRef(true);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const activeRideIdRef = useRef<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInaccessibleAlertShowingRef = useRef(false);
  const isManualPickupRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const chatFlatListRef = useRef<FlatList>(null);

  // Estados da corrida
  const [rideStatus, setRideStatus] = useState<RideStatus>('idle');
  const [bookingStep, setBookingStep] = useState<BookingStep>('ADDRESS');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [acceptedAt, setAcceptedAt] = useState<Date | null>(null);

  // Localizações e Rotas
  const [passengerLocation, setPassengerLocation] = useState<Location.LocationObject | null>(null);
  const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState<string>('');
  const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState<string>('');
  const [extraStopCoords, setExtraStopCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [extraStopAddress, setExtraStopAddress] = useState<string>('');
  const [showExtraStop, setShowExtraStop] = useState(false);

  // Motorista e Estimativas
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number; heading?: number } | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number>(0);
  const [routeGeometry, setRouteGeometry] = useState<any>(null);
  const [startOtp, setStartOtp] = useState<string>('');

  // Opções de Serviço e Pagamento
  const [serviceType] = useState<'viagem' | 'entrega' | 'aluguel'>('viagem');
  const [vehicleType, setVehicleType] = useState<VehicleType>('particular');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ORANGE_MONEY' | 'MTN_MOMO'>('CASH');
  const [paymentPhone, setPaymentPhone] = useState<string>('');
  const [referencePoint, setReferencePoint] = useState<string>('');

  // Modais e UI
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
  const [searchType, setSearchType] = useState<'pickup' | 'dropoff' | 'extraStop'>('dropoff');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchingMapbox, setIsSearchingMapbox] = useState(false);
  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [isLocationSettingsVisible, setIsLocationSettingsVisible] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [, setIsConnected] = useState(true);
  const [, setIsAppInBackground] = useState(false);

  // Solicitação para outra pessoa
  const [isForAnotherPerson] = useState(false);
  const [guestName] = useState('');
  const [guestPhone] = useState('');
  const [, setIsGuestModalVisible] = useState(false);

  // Chat em Tempo Real
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'passenger' | 'driver'; text: string; senderPhoto?: string }>>([]);
  const [inputText, setInputText] = useState('');

  // Animação do BottomSheet e Widget Flutuante
  const translateY = useRef(new Animated.Value(0)).current;
  const floatingPan = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH - 180, y: SCREEN_HEIGHT - 160 })).current;

  // Helpers
  const formatPhotoUrl = (url?: string) => {
    if (!url) return undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const apiDomain = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
    return `${apiDomain}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const calculateVehiclePrice = useCallback((type: VehicleType, distKm: number) => {
    let base = 500;
    let perKm = 200;
    if (type === 'moto-carro') { base = 350; perKm = 150; }
    if (type === 'toca-toca') { base = 300; perKm = 100; }
    const total = base + Math.ceil(distKm * perKm);
    return Math.max(total, 500);
  }, []);

  const findNearestLocalBairro = (lat: number, lng: number) => {
    let closest: string | null = null;
    let minDistance = Infinity;
    GUINEA_BISSAU_BAIRROS.forEach((b) => {
      const dist = Math.hypot(b.latitude - lat, b.longitude - lng);
      if (dist < minDistance && dist < 0.015) {
        minDistance = dist;
        closest = b.description;
      }
    });
    return closest;
  };

  const getVehicleImage = (type?: VehicleType) => {
    if (type === 'moto-carro') return require('../assets/images/moto-carro.png');
    if (type === 'toca-toca') return require('../assets/images/toca-toca.png');
    return require('../assets/images/particular.png');
  };

  const getVehicle3DIconAsset = (type?: string, color?: string) => {
    return getVehicleImage(type);
  };

  const persistRideState = async (rideId: string | null, status: RideStatus, extraData: any = {}) => {
    try {
      if (!rideId || status === 'idle' || status === 'completed') {
        await AsyncStorage.removeItem(STORAGE_RIDE_KEY);
      } else {
        const payload = { rideId, status, updatedAt: new Date().toISOString(), ...extraData };
        await AsyncStorage.setItem(STORAGE_RIDE_KEY, JSON.stringify(payload));
      }
    } catch (e) {
      console.warn('Erro ao salvar estado da corrida:', e);
    }
  };

  const fitMapBounds = useCallback((points: Array<{ latitude: number; longitude: number }>) => {
    if (!cameraRef.current || !points || points.length === 0) return;
    const validPoints = points.filter(p => p && !isNaN(p.latitude) && !isNaN(p.longitude) && p.latitude !== 0);
    if (validPoints.length === 0) return;

    if (validPoints.length === 1) {
      cameraRef.current.setCamera({
        centerCoordinate: [validPoints[0].longitude, validPoints[0].latitude],
        zoomLevel: 15,
        animationDuration: 1000,
      });
      return;
    }

    let minLat = validPoints[0].latitude;
    let maxLat = validPoints[0].latitude;
    let minLng = validPoints[0].longitude;
    let maxLng = validPoints[0].longitude;

    validPoints.forEach(p => {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    });

    cameraRef.current.fitBounds(
      [maxLng, maxLat],
      [minLng, minLat],
      [80, 80, 80, 80],
      1000
    );
  }, []);

  const handleIncomingChatMessage = useCallback((msg: any) => {
    if (!isMountedRef.current || !msg) return;
    const text = msg.text || msg.message || '';
    const sender = msg.senderType === 'DRIVER' || msg.sender === 'driver' ? 'driver' : 'passenger';
    const uniqueId = msg.id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    setMessages((prev) => {
      if (prev.some((m) => m.id === uniqueId)) return prev;
      return [...prev, { id: uniqueId, sender, text, senderPhoto: msg.senderPhoto }];
    });
  }, []);

  const changeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setLangModalVisible(false);
  };

  const fetchMapboxRoute = useCallback(async (
    origin: { latitude: number; longitude: number }, 
    destination: { latitude: number; longitude: number }, 
    extraStops?: Array<{ latitude: number; longitude: number }> | { latitude: number; longitude: number } | null
  ) => {
    const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
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
        const route = data.routes[0];
        setRouteGeometry({ type: 'Feature', properties: {}, geometry: route.geometry });
        const distanceKm = route.distance / 1000;

        if (rideStatus === 'idle' || rideStatus === 'searching') {
          setEstimatedDistance(distanceKm);
          setEstimatedPrice(calculateVehiclePrice(vehicleType, distanceKm));
        }
      }
    } catch (error) {
      console.warn('Erro ao buscar rota:', error);
    }
  }, [rideStatus, vehicleType, calculateVehiclePrice]);

  const handleMapboxSearch = async (text: string) => {
    const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
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
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&lat=${BISSAU_CENTER.latitude}&lon=${BISSAU_CENTER.longitude}&limit=15`;
      const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&countrycodes=gw&viewbox=-15.85,11.70,-15.40,12.05&bounded=0&format=json&addressdetails=1&limit=10`;
      const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?country=gw&proximity=${BISSAU_CENTER.longitude},${BISSAU_CENTER.latitude}&types=poi,address,neighborhood,locality,place,street&autocomplete=true&limit=10&language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;

      const [resPhoton, resOsm, resMapbox] = await Promise.allSettled([
        fetch(photonUrl),
        fetch(osmUrl, { headers: { 'User-Agent': 'NoBai245-App/1.0', 'Accept-Language': 'pt,fr,en' } }),
        fetch(mapboxUrl)
      ]);

      let apiResults: any[] = [];

      if (resPhoton.status === 'fulfilled' && resPhoton.value.ok) {
        const photonData = await resPhoton.value.json();
        const photonFeatures = (photonData?.features || []).map((f: any) => ({
          id: `photon_${f.properties?.osm_id || Math.random()}`,
          description: `${f.properties?.name || 'Local'}, ${f.properties?.city || 'Bissau'}`.replace(/, Guiné-Bissau/gi, ''),
          longitude: f.geometry.coordinates[0],
          latitude: f.geometry.coordinates[1],
        }));
        apiResults.push(...photonFeatures);
      }

      if (resOsm.status === 'fulfilled' && resOsm.value.ok) {
        const osmData = await resOsm.value.json();
        if (Array.isArray(osmData)) {
          const osmFeatures = osmData.map((item: any) => ({
            id: `osm_${item.place_id}`,
            description: (item.display_name || '').split(',').slice(0, 3).join(', ').replace(/, Guiné-Bissau/gi, ''),
            longitude: parseFloat(item.lon),
            latitude: parseFloat(item.lat),
          }));
          apiResults.push(...osmFeatures);
        }
      }

      if (resMapbox.status === 'fulfilled' && resMapbox.value.ok) {
        const mapboxData = await resMapbox.value.json();
        const mapboxFeatures = (mapboxData?.features || []).map((f: any) => ({
          id: f.id,
          description: (f.place_name || f.text || '').replace(/, Guiné-Bissau/gi, ''),
          longitude: f.center[0],
          latitude: f.center[1],
        }));
        apiResults.push(...mapboxFeatures);
      }

      if (isMountedRef.current) {
        const combined = [...localMatches, ...apiResults];
        const uniqueResults = combined.filter((v, i, a) => 
          v.latitude && v.longitude &&
          a.findIndex(t => t.description.toLowerCase().trim() === v.description.toLowerCase().trim()) === i
        );
        setSearchResults(uniqueResults.length > 0 ? uniqueResults : localMatches);
      }
    } catch (e) {
      if (isMountedRef.current) setSearchResults(localMatches);
    } finally {
      if (isMountedRef.current) setIsSearchingMapbox(false);
    }
  };

  const getCurrentLocationWithFallback = useCallback(async () => {
    const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
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
                const parts = placeName.split(',').map((p: string) => p.trim()).filter((p: string) => p && !p.toLowerCase().includes('guiné'));
                if (!isManualPickupRef.current) setPickupAddress(parts.length > 0 ? parts.slice(0, 2).join(', ') : 'Bissau, Centro');
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
      [{ text: 'OK', onPress: () => { isInaccessibleAlertShowingRef.current = false; } }],
      { cancelable: false, onDismiss: () => { isInaccessibleAlertShowingRef.current = false; } }
    );
  }, [t]);

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
    setReferencePoint('');
    setMessages([]); 
    setRouteGeometry(null);
    isManualPickupRef.current = false;
  }, []);

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

          const otpCode = String(ride.startOtp || ride.otpPin || ride.pin || '');
          if (otpCode) setStartOtp(otpCode);

          let parsedDriverInfo: DriverInfo | null = null;
          if (ride.driver) {
            parsedDriverInfo = {
              id: ride.driver.id,
              name: ride.driver.fullName || 'Motorista',
              photoUrl: formatPhotoUrl(ride.driver.profilePicture),
              profilePicture: formatPhotoUrl(ride.driver.profilePicture),
              carModel: ride.driver.vehicleModel || ride.driver.vehicleBrand,
              carColor: ride.driver.vehicleColor,
              licensePlate: ride.driver.vehiclePlate,
              rating: Number(ride.driver.ratingAverage || 5.0),
              phone: ride.driver.phone,
              startOtp: otpCode,
            };
            setDriverInfo(parsedDriverInfo);

            if (ride.driver.currentLat && ride.driver.currentLng) {
              setDriverLocation({
                latitude: Number(ride.driver.currentLat),
                longitude: Number(ride.driver.currentLng),
                heading: Number(ride.driver.heading || 0),
              });
            }
          }

          if (ride.originLat && ride.originLng) {
            setPickupCoords({ latitude: Number(ride.originLat), longitude: Number(ride.originLng) });
            if (ride.originAddress) setPickupAddress(ride.originAddress);
          }

          if (ride.destinationLat && ride.destinationLng) {
            setDropoffCoords({ latitude: Number(ride.destinationLat), longitude: Number(ride.destinationLng) });
            if (ride.destinationAddress) setDropoffAddress(ride.destinationAddress);
          }

          const price = ride.priceXof ? Number(ride.priceXof) : null;
          if (price) setEstimatedPrice(price);

          activateKeepAwakeAsync('PASSENGER_RIDE_KEEP_AWAKE').catch(() => {});
          if (socket && socket.connected) {
            socket.emit('passenger:rejoin_ride', { rideId: ride.id });
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao sincronizar corrida:', err);
    }
  }, []);

  // Monitor de Estado do App
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      const isBg = nextAppState.match(/inactive|background/);
      setIsAppInBackground(Boolean(isBg));

      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        getCurrentLocationWithFallback();
        if (socket && !socket.connected) connectPassengerSocket();
        await syncPassengerActiveRide();
      }
      appStateRef.current = nextAppState;
    });
    return () => subscription.remove();
  }, [getCurrentLocationWithFallback, syncPassengerActiveRide]);

  // Monitor de Motoristas Próximos
  useEffect(() => {
    const currentLat = pickupCoords?.latitude || passengerLocation?.coords?.latitude;
    const currentLng = pickupCoords?.longitude || passengerLocation?.coords?.longitude;
    if (!currentLat || !currentLng) return;

    const fetchNearby = async () => {
      try {
        const response = await api.get('/passengers/drivers/nearby', { params: { lat: currentLat, lng: currentLng } });
        if (isMountedRef.current) setNearbyDrivers(response.data?.drivers || []);
      } catch (err) {}
    };

    fetchNearby();
    const interval = setInterval(fetchNearby, 5000);
    return () => clearInterval(interval);
  }, [pickupCoords, passengerLocation]);

  // Configuração dos Eventos do Socket
  useEffect(() => {
    async function initApp() {
      try {
        const savedState = await AsyncStorage.getItem(STORAGE_RIDE_KEY);
        if (savedState && isMountedRef.current) {
          const parsed = JSON.parse(savedState);
          if (parsed?.rideId && parsed?.status && parsed.status !== 'idle') {
            setActiveRideId(parsed.rideId);
            activeRideIdRef.current = parsed.rideId;
            setRideStatus(parsed.status);
            if (parsed.driverInfo) setDriverInfo(parsed.driverInfo);
            if (parsed.pickupCoords) setPickupCoords(parsed.pickupCoords);
            if (parsed.pickupAddress) setPickupAddress(parsed.pickupAddress);
            if (parsed.dropoffCoords) setDropoffCoords(parsed.dropoffCoords);
            if (parsed.dropoffAddress) setDropoffAddress(parsed.dropoffAddress);
          }
        }
      } catch (e) {}

      await getCurrentLocationWithFallback();
      await syncPassengerActiveRide();
    }

    initApp();
    if (!user?.id) return;

    connectPassengerSocket();
    registerAndSendPushToken();

    const handleConnect = () => {
      if (isMountedRef.current) setIsConnected(true);
      if (socket && socket.connected) {
        socket.emit('passenger:request_state');
        if (activeRideIdRef.current) socket.emit('passenger:rejoin_ride', { rideId: activeRideIdRef.current });
      }
    };

    const handleDisconnect = () => { if (isMountedRef.current) setIsConnected(false); };

    const handleRideAccepted = (data: any) => {
      if (!isMountedRef.current || !data) return;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      const otpCode = String(data.startOtp || data.otpPin || data.pin || '');
      setStartOtp(otpCode); 
      setActiveRideId(data.rideId);
      activeRideIdRef.current = data.rideId;

      if (data.driverId) {
        setDriverInfo({ 
          id: data.driverId, 
          name: data.driverName || 'Motorista',
          photoUrl: formatPhotoUrl(data.driverPhoto), 
          profilePicture: formatPhotoUrl(data.driverPhoto),
          carModel: data.carModel || data.vehicleModel || t('standard_vehicle', 'Veículo Padrão'),
          carColor: data.carColor || data.vehicleColor || 'BRANCO', 
          vehicleType: data.vehicleType || 'PARTICULAR',
          licensePlate: data.licensePlate || data.plate,
          rating: data.driverRating || 5.0,
          phone: data.driverPhone,
          startOtp: otpCode,
        });
      }

      setAcceptedAt(new Date());
      setRideStatus('accepted');
      persistRideState(data.rideId, 'accepted');
      Alert.alert(t('ride_accepted_title', 'Corrida Aceita! 🚗'), `${data.driverName || 'O motorista'} aceitou sua viagem e está a caminho.`);
    };

    const handleDriverArrived = (data: any) => {
      if (!isMountedRef.current) return;
      setRideStatus('arrived');
      if (data?.startOtp) setStartOtp(data.startOtp);
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'arrived');
      Alert.alert(t('driver_arrived_title', 'Motorista no Local! 📍'), t('driver_arrived_alert_msg', 'Seu motorista chegou ao ponto de partida.'));
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
      persistRideState(null, 'idle');
    };

    const handleRideCancelled = (data: any) => {
      if (!isMountedRef.current) return;
      Alert.alert(t('cancelled_title', 'Cancelado'), data?.cancelledBy === 'DRIVER' ? 'O motorista cancelou a corrida.' : 'Sua corrida foi cancelada.');
      resetRideState();
    };

    const handleDriverPosition = (data: any) => {
      if (!isMountedRef.current || !data) return;
      const lat = Number(data.latitude ?? data.lat);
      const lng = Number(data.longitude ?? data.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        setDriverLocation({ latitude: lat, longitude: lng, heading: typeof data.heading === 'number' ? data.heading : 0 });
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('driver:position', handleDriverPosition);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:arrived', handleDriverArrived);
    socket.on('ride:driver_arrived', handleDriverArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:completed', handleRideFinished);
    socket.on('ride:cancelled', handleRideCancelled);
    socket.on('chat:receive_message', handleIncomingChatMessage);
    socket.on('chat:message', handleIncomingChatMessage);
    socket.on('chat:new_message', handleIncomingChatMessage);
    socket.on('ride:inaccessible_location', handleInaccessibleLocationAlert);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('driver:position', handleDriverPosition);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:arrived', handleDriverArrived);
      socket.off('ride:driver_arrived', handleDriverArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:completed', handleRideFinished);
      socket.off('ride:cancelled', handleRideCancelled);
      socket.off('chat:receive_message', handleIncomingChatMessage);
      socket.off('chat:message', handleIncomingChatMessage);
      socket.off('chat:new_message', handleIncomingChatMessage);
      socket.off('ride:inaccessible_location', handleInaccessibleLocationAlert);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [user?.id, getCurrentLocationWithFallback, handleInaccessibleLocationAlert, handleIncomingChatMessage, resetRideState, syncPassengerActiveRide, t]);

  // Atualização de Câmera e Rota
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

  // Keep Awake
  useEffect(() => {
    const isRideActive = ['searching', 'accepted', 'arrived', 'in_progress'].includes(rideStatus);
    if (isRideActive) {
      activateKeepAwakeAsync('passenger_ride_tag').catch(() => {});
    } else {
      deactivateKeepAwake('passenger_ride_tag').catch(() => {});
    }
    return () => { deactivateKeepAwake('passenger_ride_tag').catch(() => {}); };
  }, [rideStatus]);

  // PanResponders
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 120) {
        Animated.timing(translateY, { toValue: SCREEN_HEIGHT * 0.35, duration: 250, useNativeDriver: true }).start();
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  }), [translateY]);

  const panResponderFloating = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: Animated.event([null, { dx: floatingPan.x, dy: floatingPan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => {
      floatingPan.extractOffset();
    }
  }), [floatingPan]);

  // Execução de Pedido
  async function handleInitialRequestRide() {
    if (!pickupCoords || !dropoffCoords || !user?.id) {
      Alert.alert(t('warning_title', 'Aviso ⚠️'), t('select_origin_destination_msg', 'Selecione a origem e o destino antes de solicitar.'));
      return;
    }

    if (paymentMethod === 'CASH') {
      executeRideRequest();
      return;
    }

    if (!paymentPhone && user?.phone) setPaymentPhone(user.phone);
    setIsPaymentModalVisible(true);
  }

  async function confirmPaymentAndRide() {
    if (!user?.id) return;
    let cleanPhone = paymentPhone.replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('245') && cleanPhone.length === 12) cleanPhone = cleanPhone.substring(3);
    
    if (!cleanPhone || !/^9[567]\d{7}$/.test(cleanPhone)) {
      Alert.alert(t('error_title', 'Erro de Formato'), 'Informe um número válido de 9 dígitos da Orange Money ou MTN (ex: 95XXXXXXX, 96XXXXXXX, 97XXXXXXX).');
      return;
    }

    setIsProcessingPayment(true);
    try {
      const paymentResponse = await initiateMobileMoneyPayment({
        phone: cleanPhone,
        amount: estimatedPrice || 1000,
        provider: paymentMethod as 'ORANGE_MONEY' | 'MTN_MOMO',
        passengerId: user.id,
      });

      if (paymentResponse?.success) {
        setIsProcessingPayment(false);
        setIsPaymentModalVisible(false);
        Alert.alert('Solicitação Enviada 📲', 'Confirme a transação inserindo o seu PIN no prompt USSD que apareceu no telemóvel.', [{ text: 'OK, já confirmei', onPress: () => executeRideRequest() }]);
      } else {
        throw new Error(paymentResponse?.message || 'Falha ao processar pagamento.');
      }
    } catch (error: any) {
      setIsProcessingPayment(false);
      Alert.alert(t('error_title', 'Aviso no Pagamento'), error?.message || 'Não foi possível autorizar o débito. Verifique o saldo ou o número.');
    }
  }

  function executeRideRequest() {
    if (!user?.id || !pickupCoords) return;

    try {
      if (!socket.connected) connectPassengerSocket();
      setRideStatus('searching');

      const mappedVehicleType = vehicleType === 'particular' ? 'PARTICULAR' : vehicleType === 'moto-carro' ? 'MOTO_CARRO' : vehicleType.toUpperCase();

      emitRequestRide({
        passengerId: user.id,
        passengerName: (user as any)?.name || user.fullName,
        passengerRating: Number((user as any)?.rating || user.ratingAverage || 5.0),
        pickupLat: pickupCoords.latitude,
        pickupLng: pickupCoords.longitude,
        originAddress: pickupAddress,
        destinationLat: dropoffCoords?.latitude || pickupCoords.latitude,
        destinationLng: dropoffCoords?.longitude || pickupCoords.longitude,
        destinationAddress: dropoffAddress,
        referencePoint: referencePoint.trim(),
        serviceType: 'RIDE',
        vehicleType: mappedVehicleType,
        paymentMethod: paymentMethod,
        estimatedPrice: estimatedPrice,
        priceXof: estimatedPrice,
        guestName: isForAnotherPerson ? guestName : undefined,
        guestPhone: isForAnotherPerson ? guestPhone : undefined,
      });

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          Alert.alert(t('no_response_title', 'Sem resposta'), t('no_driver_accepted_msg', 'Nenhum motorista aceitou no momento. Tente novamente.'));
          resetRideState();
        }
      }, 60000);
    } catch (error) {
      Alert.alert(t('error_title', 'Erro'), t('server_error_msg', 'Ocorreu um problema ao comunicar com os servidores.'));
    }
  }

  const checkPenaltyApplicable = () => {
    if (!acceptedAt) return false;
    return (new Date().getTime() - acceptedAt.getTime()) > 2 * 60 * 1000;
  };

  const handleConfirmCancel = useCallback((reason: string) => {
    setShowCancelModal(false);
    if (activeRideId && user?.id) {
      cancelRideByPassenger(activeRideId, user.id, reason);
    }
    resetRideState();
  }, [activeRideId, user?.id, resetRideState]);

  const handleSubmitRating = useCallback((stars: number, tags: string[], comment: string) => {
    if (activeRideId && driverInfo && user?.id) {
      rateDriver({ rideId: activeRideId, reviewerId: user.id, receiverId: driverInfo.id, stars, tags, comment });
    }
    setShowRatingModal(false);
    resetRideState();
  }, [activeRideId, driverInfo, user?.id, resetRideState]);

  const handleSosPress = () => {
    Alert.alert(
      t('emergency_sos', 'SOS / Emergência 🚨'),
      'Selecione o serviço de emergência que deseja contactar:',
      [
        { text: '🚨 Central de Segurança (112)', onPress: () => Linking.openURL('tel:112').catch(() => {}) },
        { text: '🚒 Bombeiros (1313)', onPress: () => Linking.openURL('tel:1313').catch(() => {}) },
        { text: '🚑 Saúde / Ambulância (1919)', onPress: () => Linking.openURL('tel:1919').catch(() => {}) },
        { text: t('back_btn', 'Cancelar'), style: 'cancel' },
      ]
    );
  };

  const handleCallDriver = () => {
    setIsChatVisible(true);
    Alert.alert('Contato Protegido 🔒', 'Por motivos de segurança, a comunicação deve ser feita pelo Chat do aplicativo.');
  };

  const handleShareTrip = async () => {
    try {
      if (!driverInfo || !dropoffAddress || !activeRideId) return;
      const apiDomain = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
      const trackingUrl = `${apiDomain}/track/${activeRideId}`;
      const msg = `🚕 Acompanhe minha viagem no Nobai245!\n\n👤 Motorista: ${driverInfo.name}\n🚘 Veículo: ${driverInfo.carModel || 'Veículo'} - Placa: ${driverInfo.licensePlate || 'N/A'}\n📍 Destino: ${dropoffAddress}\n🌐 Tempo Real: ${trackingUrl}`;
      await Share.share({ message: msg, title: 'Detalhes da minha corrida' });
    } catch (e) {}
  };

  function sendMessage() {
    if (!inputText.trim() || !activeRideId) return;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const passengerName = (user as any)?.name || user?.fullName || 'Passageiro';
    setMessages(prev => [...prev, { id: uniqueId, sender: 'passenger', text: inputText.trim() }]);
    sendChatMessage(activeRideId, passengerName, inputText.trim());
    setInputText('');
  }

  const safeCenterCoordinate = useMemo(() => {
    if (driverLocation?.latitude && driverLocation?.longitude && !isNaN(Number(driverLocation.latitude)) && Number(driverLocation.latitude) !== 0) {
      return [Number(driverLocation.longitude), Number(driverLocation.latitude)];
    }
    if (pickupCoords?.latitude && pickupCoords?.longitude && !isNaN(Number(pickupCoords.latitude)) && Number(pickupCoords.latitude) !== 0) {
      return [Number(pickupCoords.longitude), Number(pickupCoords.latitude)];
    }
    if (passengerLocation?.coords?.latitude && passengerLocation?.coords?.longitude && !isNaN(Number(passengerLocation.coords.latitude)) && Number(passengerLocation.coords.latitude) !== 0) {
      return [Number(passengerLocation.coords.longitude), Number(passengerLocation.coords.latitude)];
    }
    return [BISSAU_CENTER.longitude, BISSAU_CENTER.latitude];
  }, [driverLocation, pickupCoords, passengerLocation]);

  const topHeaderInset = Math.max((insets?.top || 0) + 12, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);

  if (!passengerLocation && rideStatus === 'idle' && locationError) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: Math.max(insets?.top || 0, 40) }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError}</Text>
        <TouchableOpacity style={styles.retryLocationBtn} onPress={getCurrentLocationWithFallback}>
          <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>Tentar Novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* CABEÇALHO FLUTUANTE */}
      <View style={[styles.floatingHeader, { top: topHeaderInset }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.headerUserInfo} activeOpacity={0.8} onPress={() => navigation.navigate('Profile')}>
            <View style={styles.avatarPlaceholder}>
              {user?.profilePicture ? (
                <Image source={{ uri: formatPhotoUrl(user.profilePicture) }} style={{ width: '100%', height: '100%', borderRadius: 50 }} />
              ) : (
                <Ionicons name="person" size={18} color="#0F172A" />
              )}
            </View>
            <Text style={styles.greetingText}>Olá, {user?.fullName ? user.fullName.split(' ')[0] : 'Passageiro'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.langHeaderBtn} onPress={() => setLangModalVisible(true)}>
            <Text style={styles.langHeaderBtnText}>{i18n.language?.toUpperCase() || 'PT'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuIcon} onPress={() => setIsMenuVisible(true)}>
            <Ionicons name="menu" size={22} color="#EAB308" />
          </TouchableOpacity>
        </View>
      </View>

      {/* MAPA DE NAVEGAÇÃO MAPBOX */}
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={Mapbox.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <Mapbox.Camera ref={cameraRef} zoomLevel={14} centerCoordinate={safeCenterCoordinate} animationMode="flyTo" />

        {routeGeometry?.type === 'Feature' && routeGeometry?.geometry?.coordinates && (
          <Mapbox.ShapeSource id="routeSource" shape={routeGeometry}>
            <Mapbox.LineLayer id="routeLine" style={{ lineColor: '#EAB308', lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
        )}

        {/* MOTORISTAS PRÓXIMOS */}
        {nearbyDrivers.filter((d) => d.lat && d.lng).map((driver) => (
          <Mapbox.PointAnnotation key={`online-driver-${driver.id}`} id={`online-driver-${driver.id}`} coordinate={[Number(driver.lng), Number(driver.lat)]}>
            <Image source={getVehicle3DIconAsset(driver.vehicleType, driver.carColor)} style={{ width: 36, height: 36 }} resizeMode="contain" />
          </Mapbox.PointAnnotation>
        ))}

        {/* ORIGEM */}
        {pickupCoords && (
          <Mapbox.PointAnnotation id="pickupPoint" coordinate={[Number(pickupCoords.longitude), Number(pickupCoords.latitude)]}>
            <View style={styles.pickupMarker}><Ionicons name="pin" size={22} color="#EAB308" /></View>
          </Mapbox.PointAnnotation>
        )}

        {/* PARADA INTERMEDIÁRIA */}
        {extraStopCoords && (
          <Mapbox.PointAnnotation id="extraStopMarker" coordinate={[Number(extraStopCoords.longitude), Number(extraStopCoords.latitude)]}>
            <View style={[styles.carMarker, { backgroundColor: '#3B82F6', borderColor: '#FFF', borderWidth: 2 }]}><Ionicons name="location" size={16} color="#FFF" /></View>
          </Mapbox.PointAnnotation>
        )}

        {/* DESTINO */}
        {dropoffCoords && (
          <Mapbox.PointAnnotation id="dropoffMarker" coordinate={[Number(dropoffCoords.longitude), Number(dropoffCoords.latitude)]}>
            <View style={[styles.carMarker, { backgroundColor: '#0F172A' }]}><Ionicons name="flag" size={16} color="#FFF" /></View>
          </Mapbox.PointAnnotation>
        )}

        {/* MOTORISTA EM TEMPO REAL */}
        {driverLocation && (
          <Mapbox.PointAnnotation id="driverMarker" coordinate={[Number(driverLocation.longitude), Number(driverLocation.latitude)]}>
            <View style={{ transform: [{ rotate: `${driverLocation.heading || 0}deg` }] }}>
              <Image source={getVehicle3DIconAsset(driverInfo?.vehicleType, driverInfo?.carColor)} style={{ width: 40, height: 40 }} resizeMode="contain" />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* BOTÃO RECENTRALIZAR */}
      <TouchableOpacity style={[styles.recenterButton, { bottom: SCREEN_HEIGHT * 0.45 }]} onPress={() => cameraRef.current?.setCamera({ centerCoordinate: safeCenterCoordinate, zoomLevel: 15 })}>
        <Ionicons name="locate" size={22} color="#EAB308" />
      </TouchableOpacity>

      {/* BOTTOM SHEET DESLIZANTE */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomSheetWrapper} pointerEvents="box-none">
        <Animated.View style={[styles.bottomSheet, { transform: [{ translateY }], paddingBottom: Math.max((insets?.bottom || 0) + 12, 20) }]}>
          <View style={styles.dragHandlerArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicator} />
          </View>

          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sheetTitle}>Para onde vamos?</Text>
                <TouchableOpacity style={styles.mainSearchInput} onPress={() => { setSearchType('pickup'); setIsSearchModalVisible(true); }}>
                  <Ionicons name="location" size={20} color="#EAB308" style={{ marginRight: 12 }} />
                  <Text style={styles.mainSearchText} numberOfLines={1}>{pickupAddress || 'Local de partida'}</Text>
                </TouchableOpacity>

                {showExtraStop && (
                  <TouchableOpacity style={[styles.mainSearchInput, { borderColor: '#3B82F6' }]} onPress={() => { setSearchType('extraStop'); setIsSearchModalVisible(true); }}>
                    <Ionicons name="location-sharp" size={18} color="#3B82F6" style={{ marginRight: 12 }} />
                    <Text style={styles.mainSearchText} numberOfLines={1}>{extraStopAddress || 'Parada Intermediária...'}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.mainSearchInput} onPress={() => { setSearchType('dropoff'); setIsSearchModalVisible(true); }}>
                  <Ionicons name="flag" size={20} color="#EF4444" style={{ marginRight: 12 }} />
                  <Text style={styles.mainSearchText} numberOfLines={1}>{dropoffAddress || 'Digite seu destino...'}</Text>
                </TouchableOpacity>

                {dropoffCoords ? (
                  <TouchableOpacity style={styles.requestButton} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.requestButtonText}>Avançar</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.requestButton, { backgroundColor: '#0F172A' }]} onPress={() => { setSearchType('dropoff'); setIsSearchModalVisible(true); }}>
                    <Text style={[styles.requestButtonText, { color: '#EAB308' }]}>Aonde você quer ir?</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'SERVICE_AND_PRICE' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>Opções de Veículo</Text>
                {[
                  { id: 'particular', title: 'Carro Particular', subtitle: 'Viagem confortável e privada', image: require('../assets/images/particular.png') },
                  { id: 'moto-carro', title: 'Moto-Carro (TukTuk)', subtitle: 'Rápido e econômico para Bissau', image: require('../assets/images/moto-carro.png') },
                  { id: 'toca-toca', title: 'Toca-Toca (Transporte Coletivo)', subtitle: 'Econômico e tradicional', image: require('../assets/images/toca-toca.png') },
                ].map((item) => (
                  <TouchableOpacity key={item.id} style={[styles.categoryCard, vehicleType === item.id && styles.categoryCardActive]} onPress={() => setVehicleType(item.id)}>
                    <Image source={item.image} style={styles.vehicleImage} resizeMode="contain" />
                    <View style={styles.categoryTextWrapper}>
                      <Text style={styles.categoryTitle}>{item.title}</Text>
                      <Text style={styles.categorySubtitle}>{item.subtitle}</Text>
                    </View>
                    <Text style={styles.categoryPriceText}>{calculateVehiclePrice(item.id, estimatedDistance)} XOF</Text>
                  </TouchableOpacity>
                ))}

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('ADDRESS')}>
                    <Text style={styles.cancelButtonOutlineText}>Voltar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={() => setBookingStep('PAYMENT')}>
                    <Text style={styles.requestButtonText}>Continuar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'PAYMENT' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>Forma de Pagamento</Text>
                <TouchableOpacity style={[styles.paymentBtn, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnActive]} onPress={() => setPaymentMethod('ORANGE_MONEY')}>
                  <Text style={styles.paymentBtnText}>Orange Money</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.paymentBtn, paymentMethod === 'MTN_MOMO' && styles.paymentBtnActive]} onPress={() => setPaymentMethod('MTN_MOMO')}>
                  <Text style={styles.paymentBtnText}>MTN Mobile Money</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.paymentBtn, paymentMethod === 'CASH' && styles.paymentBtnActive]} onPress={() => setPaymentMethod('CASH')}>
                  <Text style={styles.paymentBtnText}>Dinheiro em Espécie</Text>
                </TouchableOpacity>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.cancelButtonOutlineText}>Voltar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={handleInitialRequestRide}>
                    <Text style={styles.requestButtonText}>Pedir Agora</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* DADOS DO MOTORISTA E AÇÕES DA CORRIDA ATIVA */}
            {['accepted', 'arrived', 'in_progress'].includes(rideStatus) && driverInfo && (
              <View style={styles.activeRideContainer}>
                <View style={styles.driverCardCompact}>
                  <Image source={{ uri: driverInfo.photoUrl || 'https://via.placeholder.com/100' }} style={styles.driverAvatarCompact} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.driverNameCompact}>{driverInfo.name}</Text>
                    <Text style={styles.vehicleModelCompact}>{driverInfo.carModel || 'Veículo'} • {driverInfo.carColor || ''}</Text>
                    <View style={styles.plateBadgeCompact}>
                      <Text style={styles.plateTextCompact}>{driverInfo.licensePlate?.toUpperCase() || 'SEM PLACA'}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.actionRowGrid}>
                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleSosPress}>
                    <Ionicons name="shield-checkmark" size={18} color="#EF4444" />
                    <Text style={[styles.actionBtnText, { color: '#EF4444' }]}>SOS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleCallDriver}>
                    <Ionicons name="call" size={18} color="#EAB308" />
                    <Text style={[styles.actionBtnText, { color: '#EAB308' }]}>Ligar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleShareTrip}>
                    <Ionicons name="share-social" size={18} color="#3B82F6" />
                    <Text style={[styles.actionBtnText, { color: '#3B82F6' }]}>Partilhar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtnPrimary} onPress={() => setIsChatVisible(true)}>
                    <Ionicons name="chatbubble-ellipses" size={18} color="#0F172A" />
                    <Text style={styles.actionBtnPrimaryText}>Chat</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.cancelRideLink} onPress={() => setShowCancelModal(true)}>
                  <Text style={styles.cancelRideLinkText}>Cancelar Corrida</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* MODAL DE BUSCA DE ENDEREÇO */}
      <Modal visible={isSearchModalVisible} animationType="slide" onRequestClose={() => setIsSearchModalVisible(false)}>
        <SafeAreaView style={styles.searchModalContainer}>
          <View style={styles.searchHeader}>
            <TouchableOpacity onPress={() => setIsSearchModalVisible(false)} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#F8FAFC" />
            </TouchableOpacity>
            <Text style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: 16 }}>Buscar Endereço</Text>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.mapboxSearchInputWrapper}>
              <TextInput
                style={styles.mapboxSearchInput}
                placeholder="Digite a localização..."
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={(text) => { setSearchQuery(text); handleMapboxSearch(text); }}
                autoFocus
              />
            </View>

            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
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
                      setBookingStep('SERVICE_AND_PRICE');
                    }
                    setIsSearchModalVisible(false);
                  }}
                >
                  <Ionicons name="location" size={18} color="#EAB308" style={{ marginRight: 12 }} />
                  <Text style={styles.searchResultText}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* MODAL DE CHAT INTERNO */}
      <Modal visible={isChatVisible} animationType="slide" transparent onRequestClose={() => setIsChatVisible(false)}>
        <KeyboardAvoidingView style={styles.chatOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.chatContainer}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle}>Chat com {driverInfo?.name || 'Motorista'}</Text>
              <TouchableOpacity onPress={() => setIsChatVisible(false)}>
                <Ionicons name="close" size={22} color="#FFF" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={chatFlatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.messageRow, item.sender === 'passenger' ? styles.rowPassenger : styles.rowDriver]}>
                  <View style={[styles.messageBubble, item.sender === 'passenger' ? styles.messagePassenger : styles.messageDriver]}>
                    <Text style={styles.messageText}>{item.text}</Text>
                  </View>
                </View>
              )}
            />

            <View style={styles.chatInputContainer}>
              <TextInput style={styles.chatInput} value={inputText} onChangeText={setInputText} placeholder="Escreva algo..." placeholderTextColor="#94A3B8" />
              <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage}>
                <Ionicons name="send" size={16} color="#0F172A" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAIS DE CANCELAMENTO E AVALIAÇÃO */}
      <CancelModal visible={showCancelModal} userType="PASSENGER" isPenaltyApplicable={checkPenaltyApplicable()} onClose={() => setShowCancelModal(false)} onConfirm={handleConfirmCancel} />
      <RatingModal visible={showRatingModal} targetName={driverInfo?.name || 'Motorista'} onSubmit={handleSubmitRating} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ESTILOS UNIFICADOS E COMPLETO
// ---------------------------------------------------------------------------
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
  
  // MARCADORES E PINOS
  carMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EAB308',
    justify: 'center',
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
    maxHeight: '52%',
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  operatorHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  operatorTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  paymentModalBody: {
    paddingHorizontal: 20,
  },
  paymentModalSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  amountBadgeContainer: {
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  phoneInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontWeight: '700',
  },
  modalActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
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
  
  // MARCADORES 3D
  vehicle3DContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  vehicle3DImage: {
    width: 38,
    height: 38,
    resizeMode: 'contain',
    backgroundColor: 'transparent',
  },
  driverMarkerWrapper: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  driverMarkerImage: {
    width: 32,
    height: 32,
    resizeMode: 'contain',
    backgroundColor: 'transparent',
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

  // ESTILOS DO BOTÃO FLUTUANTE GUINÉ-BISSAU
  gbFloatingWidgetContainer: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 12,
  },
  gbFloatingWidgetInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 25,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#EAB308',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 10,
    gap: 8,
  },
  gbFlagBorder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  gbFlagRed: {
    width: '40%',
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gbFlagRightCol: {
    width: '60%',
    height: '100%',
  },
  gbFlagYellow: {
    height: '50%',
    backgroundColor: '#EAB308',
  },
  gbFlagGreen: {
    height: '50%',
    backgroundColor: '#16A34A',
  },
  gbWidgetInfo: {
    justifyContent: 'center',
  },
  gbWidgetStatusTitle: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
    maxWidth: 110,
  },
  gbWidgetPriceText: {
    color: '#EAB308',
    fontSize: 12,
    fontWeight: '900',
  },

  // ESTILOS DA TELA PROFISSIONAL DE CORRIDA ATIVA
  activeRideContainer: {
    width: '100%',
    paddingTop: 4,
  },
  activeRideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusPulseBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  activeRideStatusTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  priceBadgeHeader: {
    alignItems: 'flex-end',
  },
  priceBadgeLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '800',
  },
  priceBadgeValue: {
    color: '#EAB308',
    fontSize: 15,
    fontWeight: '900',
  },
  routeTimelineContainer: {
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  routeTimelineHeaderTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineIconBg: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  timelineTextWrapper: {
    flex: 1,
  },
  timelineLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  timelineValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  paymentMethodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
    gap: 6,
  },
  paymentMethodChipText: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '700',
  },
  driverCardCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  driverAvatarCompact: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#EAB308',
  },
  driverNameCompact: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  vehicleModelCompact: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  plateBadgeCompact: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  plateTextCompact: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '900',
  },
  actionRowGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAB308',
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  actionBtnPrimaryText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
  },
  cancelRideLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelRideLinkText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
});