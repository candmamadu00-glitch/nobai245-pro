import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Building2,
  Plane,
  Car,
  Clock,
  Send,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
  Phone,
  ShieldCheck,
  UserCheck,
  MapPin,
  XCircle,
  ExternalLink,
  Search,
  Package,
  Users,
  UserPlus,
  Trash2,
  Share2,
  BarChart3,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Sparkles,
  TrendingUp,
  CreditCard,
  Navigation
} from 'lucide-react';
import { API_URL } from '../services/api';

interface PresetPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
}

interface CorporateProfile {
  id: string;
  name: string;
  accountType: 'HOTEL' | 'CORPORATE' | 'DELIVERY' | string;
  taxId?: string | null;
  contactName?: string | null;
  contactPhone: string;
  contactEmail?: string | null;
  costCenter?: string | null;
  creditLimitXof: number;
  currentBalanceXof: number;
  availableCreditXof: number;
  defaultPickupAddress?: string | null;
  defaultPickupLat?: number | null;
  defaultPickupLng?: number | null;
}

interface CorporateEmployeeItem {
  id: string;
  fullName: string;
  phone: string;
  department?: string | null;
  monthlyLimitXof?: number | null;
  isActive: boolean;
}

interface B2BRideItem {
  id: string;
  rideId: string;
  guestName: string;
  guestPhone?: string | null;
  roomNumber?: string | null;
  flightNumber?: string | null;
  tripCategory: string;
  requestedBy?: string | null;
  notes?: string | null;
  fareXof: number;
  corporateStatus: string;
  rideStatus: string;
  startOtp?: string | null;
  originAddress: string;
  destinationAddress: string;
  distanceKm: number;
  durationMin: number;
  vehicleType: string;
  createdAt: string;
  finishedAt?: string | null;
  driver?: {
    id: string;
    fullName: string;
    phone: string;
    vehiclePlate?: string | null;
    vehicleModel?: string | null;
    vehicleColor?: string | null;
    ratingAverage: number;
  } | null;
}

const b2bApi = axios.create({
  baseURL: `${API_URL}/b2b`,
  timeout: 20000
});

b2bApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('@bai245:b2b_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  SEARCHING: { label: 'Procurando Viatura...', bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  ACCEPTED: { label: 'A Caminho da Coleta', bg: '#dbeafe', color: '#1e40af', dot: '#3b82f6' },
  ARRIVED: { label: 'No Local de Embarque', bg: '#e0e7ff', color: '#3730a3', dot: '#6366f1' },
  IN_PROGRESS: { label: 'Em Viagem / Entrega', bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
  COMPLETED: { label: 'Concluída (Faturada)', bg: '#f1f5f9', color: '#334155', dot: '#64748b' },
  CANCELLED: { label: 'Cancelada', bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' }
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  AIRPORT_TRANSFER: { label: 'Aeroporto OXB', color: '#0284c7' },
  CITY_RIDE: { label: 'Corrida Executiva', color: '#10b981' },
  EXPRESS_DELIVERY: { label: 'Delivery Expresso', color: '#f59e0b' },
  HOURLY_CHARTER: { label: 'Carro à Disposição', color: '#8b5cf6' }
};

const GLOBAL_STYLES = `
@keyframes b2bAuroraFloat {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(30px, -24px, 0) scale(1.08); }
}
@keyframes b2bAuroraFloatReverse {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-28px, 22px, 0) scale(1.06); }
}
@keyframes b2bDashFlow {
  to { stroke-dashoffset: -120; }
}
@keyframes b2bPulseRing {
  0% { transform: scale(0.85); opacity: 0.9; }
  70% { transform: scale(2.1); opacity: 0; }
  100% { transform: scale(2.1); opacity: 0; }
}
@keyframes b2bCardFloat {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-7px); }
}
@keyframes b2bFadeSlide {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.b2b-animate-panel {
  animation: b2bFadeSlide 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.b2b-tab-btn {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.b2b-tab-btn:hover {
  transform: translateY(-1px);
}
.b2b-card-hover {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.b2b-card-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px -10px rgba(15, 23, 42, 0.12);
}
`;

export function B2BPortal() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('@bai245:b2b_token'));
  const [identifier, setIdentifier] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'dispatch' | 'analytics' | 'employees' | 'statements'>('dispatch');
  const [profile, setProfile] = useState<CorporateProfile | null>(null);
  const [employees, setEmployees] = useState<CorporateEmployeeItem[]>([]);
  const [stats, setStats] = useState({ activeCount: 0, monthRidesCount: 0, monthSpendXof: 0 });
  const [presets, setPresets] = useState<PresetPlace[]>([]);
  const [rides, setRides] = useState<B2BRideItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empDept, setEmpDept] = useState('');
  const [empLimit, setEmpLimit] = useState('');
  const [savingEmp, setSavingEmp] = useState(false);

  const [tripCategory, setTripCategory] = useState<'AIRPORT_TRANSFER' | 'CITY_RIDE' | 'HOURLY_CHARTER' | 'EXPRESS_DELIVERY'>('CITY_RIDE');
  const [airportDirection, setAirportDirection] = useState<'TO_AIRPORT' | 'FROM_AIRPORT'>('TO_AIRPORT');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [notes, setNotes] = useState('');

  const [originPresetId, setOriginPresetId] = useState('hotel-ledger');
  const [originAddress, setOriginAddress] = useState('Bissau Centro');
  const [originLat, setOriginLat] = useState(11.8639);
  const [originLng, setOriginLng] = useState(-15.5977);

  const [destPresetId, setDestPresetId] = useState('oxb-airport');
  const [destinationAddress, setDestinationAddress] = useState('Aeroporto Internacional Osvaldo Vieira (OXB), Bissalanca, Bissau');
  const [destinationLat, setDestinationLat] = useState(11.8948);
  const [destinationLng, setDestinationLng] = useState(-15.6536);

  const [vehicleType, setVehicleType] = useState('PARTICULAR');
  const [estimates, setEstimates] = useState<Array<{ vehicleType: string; priceXOF: number }>>([]);
  const [estimating, setEstimating] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'ACTIVE' | 'CANCELLED'>('ALL');
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await b2bApi.post('/login', { identifier, accessCode });
      if (res.data?.token) {
        localStorage.setItem('@bai245:b2b_token', res.data.token);
        setToken(res.data.token);
        const corp: CorporateProfile = res.data.corporate;
        setProfile(corp);
        if (corp.accountType === 'HOTEL') setTripCategory('AIRPORT_TRANSFER');
        if (corp.accountType === 'DELIVERY') setTripCategory('EXPRESS_DELIVERY');
      }
    } catch (err: any) {
      setLoginError(err?.response?.data?.error || 'Falha ao entrar no Portal B2B.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('@bai245:b2b_token');
    setToken(null);
    setProfile(null);
    setRides([]);
    setEmployees([]);
  };

  const fetchPortalData = async (silent = false) => {
    if (!token) return;
    if (!silent) setLoadingData(true);
    try {
      const [meRes, ridesRes] = await Promise.all([
        b2bApi.get('/me'),
        b2bApi.get('/rides')
      ]);

      if (meRes.data?.corporate) {
        const corp: CorporateProfile = meRes.data.corporate;
        setProfile(corp);
        setEmployees(Array.isArray(meRes.data.employees) ? meRes.data.employees : []);
        setStats(meRes.data.stats || { activeCount: 0, monthRidesCount: 0, monthSpendXof: 0 });
        if (Array.isArray(meRes.data.presets)) {
          setPresets(meRes.data.presets);
        }
        if (!silent) {
          if (corp.accountType === 'HOTEL') setTripCategory('AIRPORT_TRANSFER');
          if (corp.accountType === 'DELIVERY') {
            setTripCategory('EXPRESS_DELIVERY');
            setVehicleType('MOTO');
          }
          if (corp.defaultPickupAddress) {
            setOriginAddress(corp.defaultPickupAddress);
            if (corp.defaultPickupLat && corp.defaultPickupLng) {
              setOriginLat(corp.defaultPickupLat);
              setOriginLng(corp.defaultPickupLng);
            }
          }
        }
      }
      if (Array.isArray(ridesRes.data?.data)) {
        setRides(ridesRes.data.data);
      }
    } catch (err: any) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        handleLogout();
      }
    } finally {
      if (!silent) setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchPortalData(false);
    const interval = setInterval(() => fetchPortalData(true), 7000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (tripCategory !== 'AIRPORT_TRANSFER') return;
    const oxb = presets.find((p) => p.id === 'oxb-airport') || {
      name: 'Aeroporto Internacional Osvaldo Vieira (OXB)',
      address: 'Aeroporto Internacional Osvaldo Vieira (OXB), Bissalanca, Bissau',
      lat: 11.8948,
      lng: -15.6536
    };
    const hqAddress = profile?.defaultPickupAddress || 'Hotel Ledger Bissau, Av. Pansau Na Isna';
    const hqLat = profile?.defaultPickupLat || 11.8639;
    const hqLng = profile?.defaultPickupLng || -15.5977;

    if (airportDirection === 'TO_AIRPORT') {
      setOriginAddress(hqAddress);
      setOriginLat(hqLat);
      setOriginLng(hqLng);
      setDestinationAddress(oxb.address);
      setDestinationLat(oxb.lat);
      setDestinationLng(oxb.lng);
    } else {
      setOriginAddress(oxb.address);
      setOriginLat(oxb.lat);
      setOriginLng(oxb.lng);
      setDestinationAddress(hqAddress);
      setDestinationLat(hqLat);
      setDestinationLng(hqLng);
    }
  }, [tripCategory, airportDirection, profile]);

  const handleCalculateEstimate = async () => {
    setEstimating(true);
    try {
      const svc =
        tripCategory === 'HOURLY_CHARTER'
          ? 'RENTAL'
          : tripCategory === 'EXPRESS_DELIVERY'
            ? 'DELIVERY'
            : 'RIDE';
      const res = await b2bApi.post('/estimate', {
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        serviceType: svc
      });
      if (Array.isArray(res.data?.estimates)) {
        setEstimates(res.data.estimates);
        if (res.data.estimates.length > 0 && !res.data.estimates.some((e: any) => e.vehicleType === vehicleType)) {
          setVehicleType(res.data.estimates[0].vehicleType);
        }
      }
    } catch {
      // Silencioso durante digitacao
    } finally {
      setEstimating(false);
    }
  };

  useEffect(() => {
    if (token && originLat && destinationLat) {
      handleCalculateEstimate();
    }
  }, [token, originLat, originLng, destinationLat, destinationLng, tripCategory]);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setFeedback({ type: 'err', text: 'Informe o nome completo do hóspede, colaborador ou destinatário.' });
      return;
    }
    setDispatching(true);
    setFeedback(null);
    try {
      const svc =
        tripCategory === 'HOURLY_CHARTER'
          ? 'RENTAL'
          : tripCategory === 'EXPRESS_DELIVERY'
            ? 'DELIVERY'
            : 'RIDE';

      const res = await b2bApi.post('/rides/dispatch', {
        guestName,
        guestPhone,
        roomNumber,
        flightNumber,
        tripCategory,
        requestedBy,
        notes,
        originAddress,
        originLat,
        originLng,
        destinationAddress,
        destinationLat,
        destinationLng,
        vehicleType,
        serviceType: svc
      });

      setFeedback({
        type: 'ok',
        text: `${res.data?.message || 'Solicitação enviada!'} PIN de confirmação: ${res.data?.ride?.startOtp || '----'}`
      });
      setGuestName('');
      setGuestPhone('');
      setRoomNumber('');
      setFlightNumber('');
      setNotes('');
      fetchPortalData(true);
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.response?.data?.error || 'Erro ao enviar solicitação.'
      });
    } finally {
      setDispatching(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empPhone.trim()) return;
    setSavingEmp(true);
    try {
      const res = await b2bApi.post('/employees', {
        fullName: empName,
        phone: empPhone,
        department: empDept,
        monthlyLimitXof: empLimit ? Number(empLimit) : null
      });
      setFeedback({ type: 'ok', text: res.data?.message || 'Colaborador adicionado com sucesso!' });
      setEmpName('');
      setEmpPhone('');
      setEmpDept('');
      setEmpLimit('');
      fetchPortalData(true);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.response?.data?.error || 'Erro ao adicionar colaborador.' });
    } finally {
      setSavingEmp(false);
    }
  };

  const handleRemoveEmployee = async (empId: string, name: string) => {
    if (!window.confirm(`Remover autorização de ${name} para usar o saldo corporativo no app?`)) return;
    try {
      await b2bApi.delete(`/employees/${empId}`);
      fetchPortalData(true);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao remover colaborador.');
    }
  };

  const handleCancelRide = async (rideId: string, guest: string) => {
    if (!window.confirm(`Deseja cancelar a solicitação para ${guest}? O valor será estornado ao limite da empresa.`)) {
      return;
    }
    try {
      await b2bApi.post(`/rides/${rideId}/cancel`);
      setFeedback({ type: 'ok', text: `Solicitação de ${guest} cancelada e crédito estornado.` });
      fetchPortalData(true);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.response?.data?.error || 'Não foi possível cancelar.' });
    }
  };

  const copyTrackingWhatsApp = (r: B2BRideItem) => {
    const trackUrl = `${window.location.origin}/track/${r.rideId}`;
    const msg =
      r.tripCategory === 'EXPRESS_DELIVERY'
        ? `Olá ${r.guestName}! Seu pedido da *${profile?.name}* já saiu para entrega com a Nô Bai 245.\n📍 Acompanhe ao vivo: ${trackUrl}\n🔐 Código PIN de recebimento: *${r.startOtp || '----'}*`
        : `Olá ${r.guestName}! Seu transporte executivo agendado por *${profile?.name}* está a caminho.\n📍 Acompanhe o motorista ao vivo: ${trackUrl}\n🔐 PIN de embarque: *${r.startOtp || '----'}*`;
    navigator.clipboard?.writeText(msg);
    setFeedback({ type: 'ok', text: `Link de rastreio e PIN de ${r.guestName} copiados para colar no WhatsApp!` });
  };

  const exportCsvStatement = () => {
    const headers = ['Data', 'Ref/Quarto/Pedido', 'Passageiro/Destinatario', 'Telefone', 'Voo', 'Categoria', 'Origem', 'Destino', 'Motorista', 'Valor_XOF', 'Status'];
    const rows = filteredRides.map((r) => [
      new Date(r.createdAt).toLocaleString('pt-PT'),
      r.roomNumber || '-',
      r.guestName,
      r.guestPhone || '-',
      r.flightNumber || '-',
      r.tripCategory,
      `"${(r.originAddress || '').replace(/"/g, '""')}"`,
      `"${(r.destinationAddress || '').replace(/"/g, '""')}"`,
      r.driver?.fullName || 'N/A',
      r.fareXof,
      r.rideStatus
    ]);
    const csv = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Extrato_B2B_${(profile?.name || 'Empresa').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeRides = useMemo(
    () => rides.filter((r) => ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'QUEUED'].includes(r.rideStatus)),
    [rides]
  );

  const filteredRides = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return rides.filter((r) => {
      if (statusFilter === 'COMPLETED' && r.rideStatus !== 'COMPLETED') return false;
      if (statusFilter === 'CANCELLED' && r.rideStatus !== 'CANCELLED') return false;
      if (statusFilter === 'ACTIVE' && !['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'QUEUED'].includes(r.rideStatus)) return false;
      if (!q) return true;
      return (
        r.guestName.toLowerCase().includes(q) ||
        (r.roomNumber || '').toLowerCase().includes(q) ||
        (r.flightNumber || '').toLowerCase().includes(q) ||
        (r.driver?.fullName || '').toLowerCase().includes(q)
      );
    });
  }, [rides, searchFilter, statusFilter]);

  // Analytics computed metrics for custom SVG charts
  const analyticsData = useMemo(() => {
    const validRides = rides.filter((r) => r.rideStatus !== 'CANCELLED');
    const totalSpend = validRides.reduce((sum, r) => sum + Number(r.fareXof || 0), 0);
    const avgTicket = validRides.length > 0 ? Math.round(totalSpend / validRides.length) : 0;
    const completedCount = rides.filter((r) => r.rideStatus === 'COMPLETED').length;
    const completionRate = rides.length > 0 ? Math.round((completedCount / rides.length) * 100) : 100;

    // Last 10 days trend
    const days: Array<{ key: string; label: string; totalXof: number; count: number }> = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
      days.push({ key, label, totalXof: 0, count: 0 });
    }
    validRides.forEach((r) => {
      const key = new Date(r.createdAt).toISOString().slice(0, 10);
      const bucket = days.find((b) => b.key === key);
      if (bucket) {
        bucket.totalXof += Number(r.fareXof || 0);
        bucket.count += 1;
      }
    });

    // Category breakdown
    const catMap: Record<string, { count: number; totalXof: number }> = {};
    validRides.forEach((r) => {
      const cat = r.tripCategory || 'CITY_RIDE';
      if (!catMap[cat]) catMap[cat] = { count: 0, totalXof: 0 };
      catMap[cat].count += 1;
      catMap[cat].totalXof += Number(r.fareXof || 0);
    });
    const categories = Object.entries(catMap)
      .map(([key, val]) => ({
        key,
        label: CATEGORY_META[key]?.label || key,
        color: CATEGORY_META[key]?.color || '#059669',
        count: val.count,
        totalXof: val.totalXof,
        pct: totalSpend > 0 ? Math.round((val.totalXof / totalSpend) * 100) : 0
      }))
      .sort((a, b) => b.totalXof - a.totalXof);

    // Vehicle tier breakdown
    const vehMap: Record<string, { count: number; totalXof: number }> = {};
    validRides.forEach((r) => {
      const v = r.vehicleType || 'PARTICULAR';
      if (!vehMap[v]) vehMap[v] = { count: 0, totalXof: 0 };
      vehMap[v].count += 1;
      vehMap[v].totalXof += Number(r.fareXof || 0);
    });
    const vehicles = Object.entries(vehMap)
      .map(([key, val]) => ({
        key,
        count: val.count,
        totalXof: val.totalXof,
        pct: validRides.length > 0 ? Math.round((val.count / validRides.length) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count);

    return { totalSpend, avgTicket, completionRate, validCount: validRides.length, days, categories, vehicles };
  }, [rides]);

  const selectedPrice = estimates.find((e) => e.vehicleType === vehicleType)?.priceXOF ?? estimates[0]?.priceXOF ?? 0;
  const isDeliveryMode = tripCategory === 'EXPRESS_DELIVERY';

  const creditLimit = Number(profile?.creditLimitXof || 0);
  const availableCredit = Number(profile?.availableCreditXof || 0);
  const creditPercent = creditLimit > 0 ? Math.min(100, Math.max(0, Math.round((availableCredit / creditLimit) * 100))) : 100;

  // ============================================================================
  // TELA DE LOGIN EXECUTIVA COM ANIMAÇÃO DE MOBILIDADE CORPORATIVA
  // ============================================================================
  if (!token) {
    return (
      <div
        style={{
          minHeight: '100vh',
          position: 'relative',
          overflow: 'hidden',
          background: 'radial-gradient(circle at 20% 20%, #064e3b 0%, #041f1e 42%, #020617 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        }}
      >
        <style>{GLOBAL_STYLES}</style>

        {/* Auroras animadas de fundo */}
        <div
          style={{
            position: 'absolute',
            top: '-12%',
            left: '-8%',
            width: '540px',
            height: '540px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16, 185, 129, 0.28) 0%, rgba(16, 185, 129, 0) 70%)',
            filter: 'blur(40px)',
            animation: 'b2bAuroraFloat 11s ease-in-out infinite',
            pointerEvents: 'none'
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-16%',
            right: '-6%',
            width: '620px',
            height: '620px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.18) 0%, rgba(5, 150, 105, 0.08) 45%, transparent 72%)',
            filter: 'blur(48px)',
            animation: 'b2bAuroraFloatReverse 14s ease-in-out infinite',
            pointerEvents: 'none'
          }}
        />

        {/* Malha / Mapa Corporativo Animado SVG (Rotas Executivas Bissau) */}
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0.45,
            pointerEvents: 'none'
          }}
        >
          <defs>
            <pattern id="b2bGrid" width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(16, 185, 129, 0.09)" strokeWidth="1" />
            </pattern>
            <linearGradient id="routeGlowEmerald" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#34d399" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="routeGlowGold" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          <rect width="1440" height="900" fill="url(#b2bGrid)" />

          {/* Rota 1: Aeroporto OXB -> Hotéis & Centro Empresarial */}
          <path
            id="corpRoute1"
            d="M 110 220 C 340 160, 480 410, 760 350 C 980 300, 1140 170, 1340 240"
            fill="none"
            stroke="url(#routeGlowEmerald)"
            strokeWidth="2.5"
            strokeDasharray="10 10"
            style={{ animation: 'b2bDashFlow 6s linear infinite' }}
          />
          {/* Rota 2: Porto de Bissau -> Embaixadas / ONGs */}
          <path
            id="corpRoute2"
            d="M 80 680 C 310 560, 520 720, 790 590 C 1020 480, 1190 640, 1380 540"
            fill="none"
            stroke="url(#routeGlowGold)"
            strokeWidth="2"
            strokeDasharray="8 12"
            style={{ animation: 'b2bDashFlow 8s linear infinite' }}
          />
          {/* Rota 3: Conexão Vertical */}
          <path
            d="M 380 90 C 420 320, 320 560, 440 830"
            fill="none"
            stroke="rgba(52, 211, 153, 0.25)"
            strokeWidth="1.5"
            strokeDasharray="6 10"
            style={{ animation: 'b2bDashFlow 9s linear infinite' }}
          />

          {/* Veículo Executivo animado percorrendo a Rota 1 */}
          <circle r="6" fill="#34d399">
            <animateMotion dur="9s" repeatCount="indefinite">
              <mpath href="#corpRoute1" />
            </animateMotion>
          </circle>
          <circle r="14" fill="rgba(52, 211, 153, 0.25)">
            <animateMotion dur="9s" repeatCount="indefinite">
              <mpath href="#corpRoute1" />
            </animateMotion>
          </circle>

          {/* Veículo Delivery/Frota animado percorrendo a Rota 2 */}
          <circle r="5" fill="#fbbf24">
            <animateMotion dur="11s" repeatCount="indefinite">
              <mpath href="#corpRoute2" />
            </animateMotion>
          </circle>

          {/* Hubs Corporativos Pulsantes */}
          <g transform="translate(260, 215)">
            <circle r="18" fill="rgba(16, 185, 129, 0.22)" style={{ animation: 'b2bPulseRing 3s infinite' }} />
            <circle r="5" fill="#10b981" />
            <text x="12" y="4" fill="rgba(226, 232, 240, 0.7)" fontSize="11" fontWeight="700">AEROPORTO OXB</text>
          </g>
          <g transform="translate(760, 350)">
            <circle r="18" fill="rgba(251, 191, 36, 0.25)" style={{ animation: 'b2bPulseRing 3.4s infinite' }} />
            <circle r="5" fill="#fbbf24" />
            <text x="12" y="4" fill="rgba(226, 232, 240, 0.7)" fontSize="11" fontWeight="700">HOTELARIA & CONCIERGE</text>
          </g>
          <g transform="translate(520, 650)">
            <circle r="16" fill="rgba(56, 189, 248, 0.25)" style={{ animation: 'b2bPulseRing 2.8s infinite' }} />
            <circle r="5" fill="#38bdf8" />
            <text x="12" y="4" fill="rgba(226, 232, 240, 0.7)" fontSize="11" fontWeight="700">ZONA EMPRESARIAL</text>
          </g>
        </svg>

        {/* Container Principal Split-Screen */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: '100%',
            maxWidth: '1060px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: '32px',
            alignItems: 'center'
          }}
        >
          {/* Coluna Esquerda: Apresentação Executiva Animada */}
          <div style={{ color: '#f8fafc', padding: '12px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '999px',
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1px solid rgba(52, 211, 153, 0.35)',
                color: '#6ee7b7',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                marginBottom: '18px'
              }}
            >
              <Sparkles size={14} />
              NÔ BAI 245 • PLATAFORMA B2B GUINÉ-BISSAU
            </div>

            <h1
              style={{
                margin: '0 0 14px',
                fontSize: 'clamp(28px, 3.6vw, 40px)',
                fontWeight: 900,
                lineHeight: 1.15,
                letterSpacing: '-0.02em',
                color: '#ffffff'
              }}
            >
              Mobilidade Executiva & Entregas para a sua Empresa.
            </h1>

            <p style={{ margin: '0 0 26px', fontSize: '15px', color: '#cbd5e1', lineHeight: 1.6 }}>
              Controle centralizado para <strong>Hotéis, Embaixadas, ONGs, Empresas e Lojas</strong> em Bissau. Chame viaturas para hóspedes, autorize colaboradores no aplicativo e acompanhe tudo com faturamento mensal em XOF.
            </p>

            {/* Mini Cards Flutuantes Animados */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.58)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: '14px',
                  padding: '13px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  animation: 'b2bCardFloat 5s ease-in-out infinite'
                }}
              >
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plane size={19} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff' }}>Transfers Aeroporto OXB & Concierge</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Link de rastreio ao vivo no WhatsApp + PIN de embarque seguro.</div>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.58)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: '14px',
                  padding: '13px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  animation: 'b2bCardFloat 6s ease-in-out infinite'
                }}
              >
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <CreditCard size={19} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#fff' }}>Zero Dinheiro no Trajeto • Fatura Única</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Limites por colaborador, centro de custo e extrato exportável em Excel.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Coluna Direita: Cartão Glassmorphism de Acesso */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(20px)',
              borderRadius: '22px',
              padding: '34px 30px',
              boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.2)',
              maxWidth: '440px',
              width: '100%',
              margin: '0 auto'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '13px', marginBottom: '22px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 10px 20px -5px rgba(5, 150, 105, 0.45)'
                }}
              >
                <Building2 size={24} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Acesso Restrito Corporativo
                </div>
                <h2 style={{ margin: 0, fontSize: '21px', fontWeight: 900, color: '#0f172a' }}>
                  Entrar no Painel B2B
                </h2>
              </div>
            </div>

            {loginError && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '13px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Telefone Corporativo, E-mail ou NIF
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Ex: +245 955 000 000"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '11px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    color: '#0f172a',
                    background: '#f8fafc',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Código PIN / Senha B2B
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPin ? 'text' : 'password'}
                    required
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    placeholder="••••••"
                    style={{
                      width: '100%',
                      padding: '12px 42px 12px 14px',
                      borderRadius: '11px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '14px',
                      color: '#0f172a',
                      background: '#f8fafc',
                      boxSizing: 'border-box',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex'
                    }}
                  >
                    {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                style={{
                  marginTop: '6px',
                  padding: '14px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '14px',
                  cursor: loginLoading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 12px 24px -6px rgba(5, 150, 105, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <ShieldCheck size={18} />
                {loginLoading ? 'Autenticando Credenciais...' : 'Acessar Painel da Empresa'}
              </button>
            </form>

            <div
              style={{
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#64748b'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                <CheckCircle2 size={14} color="#059669" /> Ambiente Criptografado SSL
              </span>
              <span>Suporte B2B Bissau</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // PAINEL EXECUTIVO AUTENTICADO (MAIS MODERNO E COM ABAS + GRÁFICOS INTERATIVOS)
  // ============================================================================
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', color: '#0f172a', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Top Executive Header */}
      <header
        style={{
          background: 'linear-gradient(90deg, #020617 0%, #062822 55%, #0f172a 100%)',
          color: '#ffffff',
          padding: '16px 26px',
          borderBottom: '1px solid rgba(52, 211, 153, 0.2)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
          backdropFilter: 'blur(12px)'
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px -4px rgba(16, 185, 129, 0.45)'
              }}
            >
              <Building2 size={22} color="#fff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900, fontSize: '18px', letterSpacing: '-0.01em' }}>
                  {profile?.name || 'Parceiro B2B'}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '3px 10px',
                    borderRadius: '999px',
                    background: profile?.accountType === 'HOTEL' ? 'rgba(2, 132, 199, 0.25)' : profile?.accountType === 'DELIVERY' ? 'rgba(217, 119, 6, 0.25)' : 'rgba(16, 185, 129, 0.22)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: '#a7f3d0'
                  }}
                >
                  {profile?.accountType === 'HOTEL' ? '🏨 HOTELARIA & CONCIERGE' : profile?.accountType === 'DELIVERY' ? '📦 DELIVERY & ENTREGAS' : '🏢 CONTA CORPORATIVA'}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#6ee7b7', fontWeight: 600 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                  Frota Bissau Online
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                Nô Bai 245 Business • Centro de Custo: <strong style={{ color: '#e2e8f0' }}>{profile?.costCenter || 'Geral'}</strong> • Faturamento Centralizado XOF
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => fetchPortalData(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 14px',
                borderRadius: '10px',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                background: 'rgba(30, 41, 59, 0.75)',
                color: '#e2e8f0',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={14} /> Atualizar
            </button>
            <button
              onClick={handleLogout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 14px',
                borderRadius: '10px',
                border: '1px solid rgba(248, 113, 113, 0.3)',
                background: 'rgba(220, 38, 38, 0.18)',
                color: '#fca5a5',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <LogOut size={14} /> Encerrar Sessão
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        {/* KPI Cards Row com Barra de Progresso de Crédito */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="b2b-card-hover" style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Crédito Disponível</span>
              <span style={{ padding: '4px 8px', borderRadius: '8px', background: '#ecfdf5', color: '#059669', fontSize: '11px', fontWeight: 800 }}>
                {creditPercent}% livre
              </span>
            </div>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#059669', marginTop: '6px', letterSpacing: '-0.02em' }}>
              {availableCredit.toLocaleString('pt-PT')} <span style={{ fontSize: '14px', fontWeight: 700 }}>XOF</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '999px', marginTop: '10px', overflow: 'hidden' }}>
              <div style={{ width: `${creditPercent}%`, height: '100%', background: 'linear-gradient(90deg, #10b981, #059669)', borderRadius: '999px', transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
              Teto aprovado: {creditLimit.toLocaleString('pt-PT')} XOF
            </div>
          </div>

          <div className="b2b-card-hover" style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fatura Aberta</span>
              <CreditCard size={16} color="#0f172a" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#0f172a', marginTop: '6px', letterSpacing: '-0.02em' }}>
              {(profile?.currentBalanceXof ?? 0).toLocaleString('pt-PT')} <span style={{ fontSize: '14px', fontWeight: 700 }}>XOF</span>
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '10px' }}>
              Consumo no mês: <strong>{stats.monthSpendXof.toLocaleString('pt-PT')} XOF</strong> ({stats.monthRidesCount} viagens)
            </div>
          </div>

          <div className="b2b-card-hover" style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Em Andamento Agora</span>
              <Navigation size={16} color="#2563eb" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '6px' }}>
              <span style={{ fontSize: '26px', fontWeight: 900, color: '#2563eb' }}>{activeRides.length}</span>
              {activeRides.length > 0 && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '2px 8px', borderRadius: '999px' }}>
                  Ao vivo no radar
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '10px' }}>
              Viagens executivas e entregas em curso
            </div>
          </div>

          <div className="b2b-card-hover" style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Colaboradores App</span>
              <Users size={16} color="#7c3aed" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: 900, color: '#0f172a', marginTop: '6px' }}>
              {employees.length} <span style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>ativos</span>
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '10px' }}>
              Autorizados a pedir pelo app móvel
            </div>
          </div>
        </div>

        {/* Barra de Navegação em Abas Modernas */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            background: '#ffffff',
            padding: '8px',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
            marginBottom: '22px'
          }}
        >
          <button
            type="button"
            className="b2b-tab-btn"
            onClick={() => setActiveTab('dispatch')}
            style={{
              flex: '1 1 200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '11px',
              border: 'none',
              background: activeTab === 'dispatch' ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'transparent',
              color: activeTab === 'dispatch' ? '#ffffff' : '#475569',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'dispatch' ? '0 8px 18px -4px rgba(5, 150, 105, 0.4)' : 'none'
            }}
          >
            <Send size={16} />
            Central de Despacho & Radar
            {activeRides.length > 0 && (
              <span style={{ padding: '2px 7px', borderRadius: '999px', fontSize: '11px', background: activeTab === 'dispatch' ? 'rgba(255,255,255,0.22)' : '#dbeafe', color: activeTab === 'dispatch' ? '#fff' : '#1d4ed8' }}>
                {activeRides.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className="b2b-tab-btn"
            onClick={() => setActiveTab('analytics')}
            style={{
              flex: '1 1 200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '11px',
              border: 'none',
              background: activeTab === 'analytics' ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' : 'transparent',
              color: activeTab === 'analytics' ? '#ffffff' : '#475569',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'analytics' ? '0 8px 18px -4px rgba(15, 23, 42, 0.35)' : 'none'
            }}
          >
            <BarChart3 size={16} />
            Gráficos & Indicadores
          </button>

          <button
            type="button"
            className="b2b-tab-btn"
            onClick={() => setActiveTab('employees')}
            style={{
              flex: '1 1 200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '11px',
              border: 'none',
              background: activeTab === 'employees' ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' : 'transparent',
              color: activeTab === 'employees' ? '#ffffff' : '#475569',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'employees' ? '0 8px 18px -4px rgba(37, 99, 235, 0.4)' : 'none'
            }}
          >
            <Users size={16} />
            Colaboradores no App ({employees.length})
          </button>

          <button
            type="button"
            className="b2b-tab-btn"
            onClick={() => setActiveTab('statements')}
            style={{
              flex: '1 1 200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '11px',
              border: 'none',
              background: activeTab === 'statements' ? 'linear-gradient(135deg, #0f172a 0%, #064e3b 100%)' : 'transparent',
              color: activeTab === 'statements' ? '#ffffff' : '#475569',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'statements' ? '0 8px 18px -4px rgba(6, 78, 59, 0.35)' : 'none'
            }}
          >
            <FileSpreadsheet size={16} />
            Extrato & Faturamento ({rides.length})
          </button>
        </div>

        {/* ==================================================================== */}
        {/* ABA 1: CENTRAL DE DESPACHO & RADAR AO VIVO                           */}
        {/* ==================================================================== */}
        {activeTab === 'dispatch' && (
          <div className="b2b-animate-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '22px' }}>
            {/* Formulário de Solicitação */}
            <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 6px 24px rgba(15,23,42,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <Send size={19} color="#059669" />
                  {isDeliveryMode ? 'Despachar Entrega Expressa' : 'Solicitar Viatura Executiva / Hóspede'}
                </h2>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '18px' }}>
                <button
                  type="button"
                  onClick={() => setTripCategory('AIRPORT_TRANSFER')}
                  style={{
                    padding: '10px 6px',
                    borderRadius: '12px',
                    border: tripCategory === 'AIRPORT_TRANSFER' ? '2px solid #059669' : '1px solid #cbd5e1',
                    background: tripCategory === 'AIRPORT_TRANSFER' ? '#ecfdf5' : '#f8fafc',
                    color: tripCategory === 'AIRPORT_TRANSFER' ? '#065f46' : '#475569',
                    fontWeight: 800,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Plane size={16} />
                  Aeroporto OXB
                </button>

                <button
                  type="button"
                  onClick={() => setTripCategory('CITY_RIDE')}
                  style={{
                    padding: '10px 6px',
                    borderRadius: '12px',
                    border: tripCategory === 'CITY_RIDE' ? '2px solid #059669' : '1px solid #cbd5e1',
                    background: tripCategory === 'CITY_RIDE' ? '#ecfdf5' : '#f8fafc',
                    color: tripCategory === 'CITY_RIDE' ? '#065f46' : '#475569',
                    fontWeight: 800,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Car size={16} />
                  Corrida Cidade
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTripCategory('EXPRESS_DELIVERY');
                    setVehicleType('MOTO');
                  }}
                  style={{
                    padding: '10px 6px',
                    borderRadius: '12px',
                    border: tripCategory === 'EXPRESS_DELIVERY' ? '2px solid #d97706' : '1px solid #cbd5e1',
                    background: tripCategory === 'EXPRESS_DELIVERY' ? '#fffbeb' : '#f8fafc',
                    color: tripCategory === 'EXPRESS_DELIVERY' ? '#b45309' : '#475569',
                    fontWeight: 800,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Package size={16} />
                  Delivery / Envio
                </button>

                <button
                  type="button"
                  onClick={() => setTripCategory('HOURLY_CHARTER')}
                  style={{
                    padding: '10px 6px',
                    borderRadius: '12px',
                    border: tripCategory === 'HOURLY_CHARTER' ? '2px solid #059669' : '1px solid #cbd5e1',
                    background: tripCategory === 'HOURLY_CHARTER' ? '#ecfdf5' : '#f8fafc',
                    color: tripCategory === 'HOURLY_CHARTER' ? '#065f46' : '#475569',
                    fontWeight: 800,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Clock size={16} />
                  À Disposição
                </button>
              </div>

              {feedback && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    marginBottom: '14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: feedback.type === 'ok' ? '#ecfdf5' : '#fef2f2',
                    color: feedback.type === 'ok' ? '#065f46' : '#b91c1c',
                    border: `1px solid ${feedback.type === 'ok' ? '#a7f3d0' : '#fecaca'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {feedback.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <span>{feedback.text}</span>
                </div>
              )}

              <form onSubmit={handleDispatch} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                {tripCategory === 'AIRPORT_TRANSFER' && (
                  <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '5px', borderRadius: '11px' }}>
                    <button
                      type="button"
                      onClick={() => setAirportDirection('TO_AIRPORT')}
                      style={{
                        flex: 1,
                        padding: '9px',
                        borderRadius: '8px',
                        border: 'none',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: airportDirection === 'TO_AIRPORT' ? '#0f172a' : 'transparent',
                        color: airportDirection === 'TO_AIRPORT' ? '#fff' : '#475569'
                      }}
                    >
                      Hotel / Empresa → Aeroporto OXB
                    </button>
                    <button
                      type="button"
                      onClick={() => setAirportDirection('FROM_AIRPORT')}
                      style={{
                        flex: 1,
                        padding: '9px',
                        borderRadius: '8px',
                        border: 'none',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: airportDirection === 'FROM_AIRPORT' ? '#0f172a' : 'transparent',
                        color: airportDirection === 'FROM_AIRPORT' ? '#fff' : '#475569'
                      }}
                    >
                      Buscar no Aeroporto OXB → Hotel
                    </button>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                      {isDeliveryMode ? 'Nome do Cliente Destinatário *' : 'Nome do Hóspede / Passageiro *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder={isDeliveryMode ? 'Ex: Sr. Braima Camará' : 'Ex: Dr. Carlos Mendes'}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                      {isDeliveryMode ? 'Nº Pedido / Nota' : 'Nº Quarto / Centro Custo'}
                    </label>
                    <input
                      type="text"
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      placeholder={isDeliveryMode ? 'Ex: PED-409' : 'Ex: Quarto 304'}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                      {isDeliveryMode ? 'Telefone do Destinatário' : 'Nº do Voo (Opcional)'}
                    </label>
                    {isDeliveryMode ? (
                      <input
                        type="text"
                        value={guestPhone}
                        onChange={(e) => setGuestPhone(e.target.value)}
                        placeholder="+245 955..."
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value)}
                        placeholder="Ex: Voo TP 1479"
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                      Operador / Solicitante
                    </label>
                    <input
                      type="text"
                      value={requestedBy}
                      onChange={(e) => setRequestedBy(e.target.value)}
                      placeholder="Ex: Recepção / Expedição"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                      {isDeliveryMode ? 'Local de Coleta (Loja / Armazém)' : 'Local de Embarque'}
                    </label>
                    <select
                      value={originPresetId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOriginPresetId(val);
                        const found = presets.find((p) => p.id === val);
                        if (found) {
                          setOriginAddress(found.address);
                          setOriginLat(found.lat);
                          setOriginLng(found.lng);
                        }
                      }}
                      style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '7px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 600 }}
                    >
                      <option value="custom-hq">Ponto Rápido...</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    required
                    value={originAddress}
                    onChange={(e) => setOriginAddress(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>

                {tripCategory !== 'HOURLY_CHARTER' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                        {isDeliveryMode ? 'Endereço / Bairro de Entrega' : 'Destino em Bissau'}
                      </label>
                      <select
                        value={destPresetId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDestPresetId(val);
                          const found = presets.find((p) => p.id === val);
                          if (found) {
                            setDestinationAddress(found.address);
                            setDestinationLat(found.lat);
                            setDestinationLng(found.lng);
                          }
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '7px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 600 }}
                      >
                        <option value="">Selecionar zona rápida...</option>
                        {presets.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      required
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                    {isDeliveryMode ? 'Ponto de Referência / Conteúdo do Pacote' : 'Instruções ao Motorista (Placa / Bagagens)'}
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={isDeliveryMode ? 'Ex: Casa azul próximo à padaria • Caixa frágil' : 'Ex: Aguardar no desembarque com placa com nome'}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>

                <div
                  style={{
                    background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
                    border: '1px solid #a7f3d0',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#047857', letterSpacing: '0.04em' }}>TARIFA FATURADA À EMPRESA</div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a' }}>
                      {estimating ? 'Calculando...' : `${selectedPrice.toLocaleString('pt-PT')} XOF`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>
                      {isDeliveryMode ? 'Cliente não paga frete na entrega • Débito B2B' : 'Sem cobrança ao passageiro • Débito em conta B2B'}
                    </div>
                  </div>
                  {estimates.length > 0 && (
                    <select
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                      style={{ padding: '9px 12px', borderRadius: '9px', border: '1.5px solid #059669', background: '#fff', fontWeight: 800, fontSize: '12px', color: '#0f172a' }}
                    >
                      {estimates.map((est) => (
                        <option key={est.vehicleType} value={est.vehicleType}>
                          {est.vehicleType} ({est.priceXOF} XOF)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={dispatching}
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    border: 'none',
                    background: isDeliveryMode
                      ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)'
                      : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '14px',
                    cursor: dispatching ? 'not-allowed' : 'pointer',
                    boxShadow: '0 10px 20px -5px rgba(5, 150, 105, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <Send size={16} />
                  {dispatching
                    ? 'Acionando Frota...'
                    : isDeliveryMode
                      ? 'Confirmar e Chamar Entregador Agora'
                      : 'Confirmar e Chamar Motorista Agora'}
                </button>
              </form>
            </div>

            {/* Radar de Operações Ativas */}
            <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 6px 24px rgba(15,23,42,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <UserCheck size={19} color="#2563eb" />
                  Radar de Operações Ativas ({activeRides.length})
                </h2>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>Atualização a cada 7s</span>
              </div>

              {activeRides.length === 0 ? (
                <div style={{ padding: '56px 24px', textAlign: 'center', border: '1.5px dashed #cbd5e1', borderRadius: '16px', background: '#f8fafc', color: '#64748b' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <Car size={28} color="#475569" />
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '15px', color: '#1e293b' }}>Nenhuma viagem ou entrega em curso</div>
                  <div style={{ fontSize: '13px', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
                    Assim que solicitar um carro ou entregador ao lado, os dados do motorista, matrícula, link WhatsApp e PIN aparecerão aqui.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '610px', overflowY: 'auto' }}>
                  {activeRides.map((r) => {
                    const badge = STATUS_LABELS[r.rideStatus] || { label: r.rideStatus, bg: '#f1f5f9', color: '#334155', dot: '#64748b' };
                    return (
                      <div key={r.id} style={{ border: '1px solid #cbd5e1', borderRadius: '14px', padding: '16px', background: '#f8fafc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: '15px', color: '#0f172a' }}>
                              {r.tripCategory === 'EXPRESS_DELIVERY' ? '📦 ' : '🚘 '}
                              {r.guestName} {r.roomNumber ? <span style={{ fontSize: '12px', color: '#059669' }}>({r.roomNumber})</span> : null}
                            </div>
                            {r.flightNumber && (
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7', marginTop: '2px' }}>
                                ✈️ Voo: {r.flightNumber}
                              </div>
                            )}
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: badge.bg, color: badge.color }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: badge.dot }} />
                            {badge.label}
                          </span>
                        </div>

                        <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div><MapPin size={12} style={{ display: 'inline', marginRight: '5px', color: '#059669' }} /> <strong>Origem:</strong> {r.originAddress}</div>
                          <div><MapPin size={12} style={{ display: 'inline', marginRight: '5px', color: '#dc2626' }} /> <strong>Destino:</strong> {r.destinationAddress}</div>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                          {r.startOtp && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '5px 11px', borderRadius: '9px', fontSize: '12px', fontWeight: 900 }}>
                              <ShieldCheck size={14} />
                              PIN: {r.startOtp}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => copyTrackingWhatsApp(r)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 11px', borderRadius: '9px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#065f46', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                          >
                            <Share2 size={13} /> Copiar Link WhatsApp
                          </button>
                        </div>

                        {r.driver ? (
                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '11px', padding: '11px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{r.driver.fullName}</div>
                              <div style={{ fontSize: '12px', color: '#475569' }}>
                                {r.driver.vehicleModel || 'Viatura'} • <strong>{r.driver.vehiclePlate || 'Placa N/D'}</strong>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <a
                                href={`tel:${r.driver.phone}`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 11px', borderRadius: '8px', background: '#059669', color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: 700 }}
                              >
                                <Phone size={13} />
                                {r.driver.phone}
                              </a>
                              <a
                                href={`/track/${r.rideId}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 11px', borderRadius: '8px', background: '#0f172a', color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: 700 }}
                              >
                                <ExternalLink size={13} />
                                Mapa Live
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 700 }}>
                            Buscando motorista/entregador mais próximo...
                          </div>
                        )}

                        {['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(r.rideStatus) && (
                          <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => handleCancelRide(r.rideId, r.guestName)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 11px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                            >
                              <XCircle size={13} />
                              Cancelar Solicitação
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* ABA 2: GRÁFICOS & INDICADORES EXECUTIVOS                           */}
        {/* ==================================================================== */}
        {activeTab === 'analytics' && (
          <div className="b2b-animate-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Mini KPIs Analíticos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>Investimento Total Registrado</div>
                <div style={{ fontSize: '24px', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                  {analyticsData.totalSpend.toLocaleString('pt-PT')} XOF
                </div>
                <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <TrendingUp size={13} /> {analyticsData.validCount} operações faturadas
                </div>
              </div>

              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>Ticket Médio por Corrida / Entrega</div>
                <div style={{ fontSize: '24px', fontWeight: 900, color: '#0284c7', marginTop: '4px' }}>
                  {analyticsData.avgTicket.toLocaleString('pt-PT')} XOF
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Média calculada sobre viagens válidas
                </div>
              </div>

              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>Taxa de Conclusão</div>
                <div style={{ fontSize: '24px', fontWeight: 900, color: '#059669', marginTop: '4px' }}>
                  {analyticsData.completionRate}%
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Eficiência operacional da frota B2B
                </div>
              </div>
            </div>

            {/* Grid de Gráficos SVG Interativos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
              {/* Gráfico 1: Área / Tendência Diária (Últimos 10 Dias) */}
              <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '22px', boxShadow: '0 4px 16px rgba(15,23,42,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 900 }}>Evolução de Consumo (Últimos 10 Dias)</h3>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Passe o cursor sobre os pontos para ver o total diário em XOF</div>
                  </div>
                  {hoveredDayIdx !== null && analyticsData.days[hoveredDayIdx] && (
                    <div style={{ background: '#0f172a', color: '#fff', padding: '6px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 800 }}>
                      {analyticsData.days[hoveredDayIdx].label}: {analyticsData.days[hoveredDayIdx].totalXof.toLocaleString('pt-PT')} XOF ({analyticsData.days[hoveredDayIdx].count}x)
                    </div>
                  )}
                </div>

                {(() => {
                  const W = 540;
                  const H = 210;
                  const padX = 34;
                  const padY = 26;
                  const maxVal = Math.max(1000, ...analyticsData.days.map((d) => d.totalXof));
                  const stepX = (W - padX * 2) / Math.max(1, analyticsData.days.length - 1);

                  const pts = analyticsData.days.map((d, idx) => {
                    const x = padX + idx * stepX;
                    const y = H - padY - ((d.totalXof / maxVal) * (H - padY * 2));
                    return { x, y, ...d };
                  });

                  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
                  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H - padY} L ${pts[0].x.toFixed(1)} ${H - padY} Z`;

                  return (
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="b2bAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
                        </linearGradient>
                      </defs>

                      {[0.25, 0.5, 0.75, 1].map((ratio) => {
                        const gy = H - padY - ratio * (H - padY * 2);
                        return (
                          <line key={ratio} x1={padX} y1={gy} x2={W - padX} y2={gy} stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth="1" />
                        );
                      })}

                      <path d={areaPath} fill="url(#b2bAreaGrad)" />
                      <path d={linePath} fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                      {pts.map((p, idx) => (
                        <g
                          key={p.key}
                          onMouseEnter={() => setHoveredDayIdx(idx)}
                          onMouseLeave={() => setHoveredDayIdx(null)}
                          style={{ cursor: 'pointer' }}
                        >
                          <circle cx={p.x} cy={p.y} r={hoveredDayIdx === idx ? 7 : 4.5} fill={hoveredDayIdx === idx ? '#047857' : '#10b981'} stroke="#fff" strokeWidth="2" />
                          <text x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600">
                            {p.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  );
                })()}
              </div>

              {/* Gráfico 2: Distribuição por Categoria (Anel SVG + Legenda) */}
              <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '22px', boxShadow: '0 4px 16px rgba(15,23,42,0.03)' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 900 }}>Distribuição por Tipo de Serviço</h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>Participação financeira por modalidade B2B</div>

                {analyticsData.categories.length === 0 ? (
                  <div style={{ padding: '44px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    Realize a primeira corrida ou entrega para visualizar o gráfico por categoria.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                    {(() => {
                      const size = 164;
                      const r = 58;
                      const circ = 2 * Math.PI * r;
                      let offset = 0;

                      return (
                        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
                          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="18" />
                          {analyticsData.categories.map((cat) => {
                            const dash = (cat.pct / 100) * circ;
                            const el = (
                              <circle
                                key={cat.key}
                                cx={size / 2}
                                cy={size / 2}
                                r={r}
                                fill="none"
                                stroke={cat.color}
                                strokeWidth="18"
                                strokeDasharray={`${dash} ${circ - dash}`}
                                strokeDashoffset={-offset}
                                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                              />
                            );
                            offset += dash;
                            return el;
                          })}
                          <text x="50%" y="48%" textAnchor="middle" fontSize="16" fontWeight="900" fill="#0f172a">
                            {analyticsData.validCount}
                          </text>
                          <text x="50%" y="61%" textAnchor="middle" fontSize="10" fontWeight="700" fill="#64748b">
                            OPERAÇÕES
                          </text>
                        </svg>
                      );
                    })()}

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '200px' }}>
                      {analyticsData.categories.map((cat) => (
                        <div key={cat.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: cat.color }} />
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{cat.label}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{cat.count} corridas • {cat.pct}%</div>
                            </div>
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 900, color: '#0f172a' }}>
                            {cat.totalXof.toLocaleString('pt-PT')} XOF
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Gráfico 3: Utilização por Categoria de Viatura */}
            <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '22px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 900 }}>Utilização por Categoria de Viatura</h3>
              {analyticsData.vehicles.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>Sem dados de viaturas ainda.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                  {analyticsData.vehicles.map((v) => (
                    <div key={v.key} style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', fontWeight: 800 }}>
                        <span>{v.key}</span>
                        <span style={{ color: '#059669' }}>{v.count} viagens ({v.pct}%)</span>
                      </div>
                      <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ width: `${v.pct}%`, height: '100%', background: 'linear-gradient(90deg, #059669, #3b82f6)', borderRadius: '999px' }} />
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                        Volume total: <strong>{v.totalXof.toLocaleString('pt-PT')} XOF</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* ABA 3: COLABORADORES AUTORIZADOS NO APP                              */}
        {/* ==================================================================== */}
        {activeTab === 'employees' && (
          <div className="b2b-animate-panel" style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 6px 24px rgba(15,23,42,0.04)' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '9px' }}>
              <Users size={21} color="#2563eb" />
              Equipe Autorizada a Pedir Viagens pelo Aplicativo Nô Bai 245
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>
              Os colaboradores cadastrados abaixo podem abrir o aplicativo comum de passageiro da <strong>Nô Bai 245</strong> no próprio telemóvel e ativar a opção <strong>"Conta Corporativa"</strong> — o valor é faturado diretamente para <strong>{profile?.name}</strong> dentro do teto mensal definido.
            </p>

            <form
              onSubmit={handleAddEmployee}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: '12px',
                alignItems: 'end',
                background: '#f8fafc',
                padding: '18px',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                marginBottom: '22px'
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>Nome Completo *</label>
                <input required value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Ex: Ana Gomes" style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>Telefone no App (+245) *</label>
                <input required value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} placeholder="+245 955..." style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>Departamento / Área</label>
                <input value={empDept} onChange={(e) => setEmpDept(e.target.value)} placeholder="Ex: Comercial / Logística" style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>Teto Mensal (XOF - Opcional)</label>
                <input type="number" value={empLimit} onChange={(e) => setEmpLimit(e.target.value)} placeholder="Ex: 50000" style={{ width: '100%', padding: '10px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <button
                type="submit"
                disabled={savingEmp}
                style={{ padding: '11px 16px', borderRadius: '9px', border: 'none', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#fff', fontWeight: 800, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <UserPlus size={15} /> {savingEmp ? 'Salvando...' : 'Autorizar Colaborador'}
              </button>
            </form>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                    <th style={{ padding: '12px' }}>Colaborador</th>
                    <th style={{ padding: '12px' }}>Telefone Vinculado</th>
                    <th style={{ padding: '12px' }}>Departamento</th>
                    <th style={{ padding: '12px' }}>Limite Mensal</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '28px', textAlign: 'center', color: '#94a3b8' }}>
                        Nenhum colaborador autorizado ainda. Adicione acima para liberar uso no aplicativo móvel.
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px', fontWeight: 800 }}>{emp.fullName}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace' }}>{emp.phone}</td>
                        <td style={{ padding: '12px', color: '#475569' }}>{emp.department || 'Geral'}</td>
                        <td style={{ padding: '12px', fontWeight: 800, color: '#059669' }}>
                          {emp.monthlyLimitXof ? `${Number(emp.monthlyLimitXof).toLocaleString('pt-PT')} XOF` : 'Limite da Empresa'}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRemoveEmployee(emp.id, emp.fullName)}
                            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                          >
                            <Trash2 size={13} style={{ display: 'inline', marginRight: '4px' }} /> Revogar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* ABA 4: EXTRATO & FATURAMENTO DETALHADO                               */}
        {/* ==================================================================== */}
        {activeTab === 'statements' && (
          <div className="b2b-animate-panel" style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 6px 24px rgba(15,23,42,0.04)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 900 }}>Extrato de Viagens & Entregas Faturadas</h2>
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  Auditoria completa por quarto, pedido, colaborador ou centro de custo.
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
                  {(['ALL', 'COMPLETED', 'ACTIVE', 'CANCELLED'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '7px',
                        border: 'none',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: statusFilter === st ? '#0f172a' : 'transparent',
                        color: statusFilter === st ? '#fff' : '#475569'
                      }}
                    >
                      {st === 'ALL' ? 'Todas' : st === 'COMPLETED' ? 'Concluídas' : st === 'ACTIVE' ? 'Ativas' : 'Canceladas'}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filtrar nome, quarto, pedido..."
                    style={{ padding: '8px 10px 8px 30px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                  />
                </div>

                <button
                  type="button"
                  onClick={exportCsvStatement}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '9px', border: 'none', background: '#059669', color: '#fff', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}
                >
                  <Download size={14} />
                  Exportar Excel (CSV)
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                    <th style={{ padding: '12px' }}>Data / Hora</th>
                    <th style={{ padding: '12px' }}>Ref / Quarto</th>
                    <th style={{ padding: '12px' }}>Passageiro / Destinatário</th>
                    <th style={{ padding: '12px' }}>Trajeto</th>
                    <th style={{ padding: '12px' }}>Motorista</th>
                    <th style={{ padding: '12px' }}>Valor (XOF)</th>
                    <th style={{ padding: '12px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRides.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '28px', textAlign: 'center', color: '#94a3b8' }}>
                        Nenhum registro encontrado para este filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredRides.map((r) => {
                      const badge = STATUS_LABELS[r.rideStatus] || { label: r.rideStatus, bg: '#f1f5f9', color: '#334155', dot: '#64748b' };
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px', whiteSpace: 'nowrap', color: '#475569' }}>
                            {new Date(r.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '12px', fontWeight: 800 }}>{r.roomNumber || '-'}</td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 800 }}>{r.guestName}</div>
                            {r.flightNumber && <div style={{ fontSize: '11px', color: '#0284c7' }}>Voo {r.flightNumber}</div>}
                            {r.guestPhone && <div style={{ fontSize: '11px', color: '#64748b' }}>{r.guestPhone}</div>}
                          </td>
                          <td style={{ padding: '12px', maxWidth: '280px' }}>
                            <div style={{ fontSize: '12px' }}>{r.originAddress}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>→ {r.destinationAddress}</div>
                          </td>
                          <td style={{ padding: '12px' }}>
                            {r.driver ? (
                              <div>
                                <div style={{ fontWeight: 700 }}>{r.driver.fullName}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>{r.driver.vehiclePlate || ''}</div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '12px', fontWeight: 900, whiteSpace: 'nowrap' }}>
                            {r.fareXof.toLocaleString('pt-PT')} XOF
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ padding: '4px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: badge.bg, color: badge.color }}>
                              {badge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default B2BPortal;
