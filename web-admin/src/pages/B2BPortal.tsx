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
  Share2
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

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  SEARCHING: { label: 'Procurando Motorista/Entregador...', bg: '#fef3c7', color: '#92400e' },
  ACCEPTED: { label: 'A Caminho da Coleta', bg: '#dbeafe', color: '#1e40af' },
  ARRIVED: { label: 'No Local de Embarque/Coleta', bg: '#e0e7ff', color: '#3730a3' },
  IN_PROGRESS: { label: 'Em Trânsito', bg: '#d1fae5', color: '#065f46' },
  COMPLETED: { label: 'Concluída (Faturada)', bg: '#f1f5f9', color: '#334155' },
  CANCELLED: { label: 'Cancelada', bg: '#fee2e2', color: '#991b1b' }
};

export function B2BPortal() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('@bai245:b2b_token'));
  const [identifier, setIdentifier] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<'dispatch' | 'employees'>('dispatch');
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
      alert(res.data?.message || 'Colaborador adicionado!');
      setEmpName('');
      setEmpPhone('');
      setEmpDept('');
      setEmpLimit('');
      fetchPortalData(true);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao adicionar colaborador.');
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
    if (!q) return rides;
    return rides.filter(
      (r) =>
        r.guestName.toLowerCase().includes(q) ||
        (r.roomNumber || '').toLowerCase().includes(q) ||
        (r.flightNumber || '').toLowerCase().includes(q) ||
        (r.driver?.fullName || '').toLowerCase().includes(q)
    );
  }, [rides, searchFilter]);

  const selectedPrice = estimates.find((e) => e.vehicleType === vehicleType)?.priceXOF ?? estimates[0]?.priceXOF ?? 0;
  const isDeliveryMode = tripCategory === 'EXPRESS_DELIVERY';

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #064e3b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '430px', background: '#ffffff', borderRadius: '18px', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.45)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: '#059669', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Building2 size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Nô Bai 245 • Soluções B2B</div>
              <h1 style={{ margin: 0, fontSize: '21px', fontWeight: 800, color: '#0f172a' }}>Portal Empresas, Hotéis & Delivery</h1>
            </div>
          </div>

          <p style={{ margin: '0 0 22px', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
            Acesso exclusivo para <strong>Hotéis, Empresas, ONGs, Embaixadas e Lojas/Delivery</strong> em Bissau gerirem viagens faturadas, colaboradores e entregas expressas.
          </p>

          {loginError && (
            <div style={{ padding: '11px 14px', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
                style={{ width: '100%', padding: '11px 13px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Código PIN / Senha B2B
              </label>
              <input
                type="password"
                required
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="••••••"
                style={{ width: '100%', padding: '11px 13px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                marginTop: '6px',
                padding: '13px',
                borderRadius: '10px',
                border: 'none',
                background: '#059669',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '14px',
                cursor: loginLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {loginLoading ? 'Autenticando...' : 'Entrar no Portal B2B'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ background: '#0f172a', color: '#ffffff', padding: '14px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building2 size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 800, fontSize: '17px' }}>{profile?.name || 'Parceiro B2B'}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: profile?.accountType === 'HOTEL' ? '#0284c7' : profile?.accountType === 'DELIVERY' ? '#d97706' : '#059669' }}>
                {profile?.accountType === 'HOTEL' ? 'HOTELARIA & CONCIERGE' : profile?.accountType === 'DELIVERY' ? 'DELIVERY & ENTREGAS' : 'CONTA CORPORATIVA'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              Nô Bai 245 Business • Faturamento Centralizado (Sem cobrança em dinheiro no destino)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveSection('dispatch')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: activeSection === 'dispatch' ? '#059669' : '#1e293b',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <Send size={14} /> Central de Chamadas & Entregas
          </button>

          <button
            onClick={() => setActiveSection('employees')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: activeSection === 'employees' ? '#2563eb' : '#1e293b',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <Users size={14} /> Colaboradores no App ({employees.length})
          </button>

          <button
            onClick={() => fetchPortalData(false)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <RefreshCw size={14} className={loadingData ? 'spin' : ''} />
          </button>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <LogOut size={14} /> Sair
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1360px', margin: '0 auto', padding: '22px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '22px' }}>
          <div style={{ background: '#ffffff', padding: '16px 18px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Crédito Disponível</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>
              {(profile?.availableCreditXof ?? 0).toLocaleString('pt-PT')} XOF
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Limite total: {(profile?.creditLimitXof ?? 0).toLocaleString('pt-PT')} XOF
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '16px 18px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Fatura Aberta (Consumo)</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
              {(profile?.currentBalanceXof ?? 0).toLocaleString('pt-PT')} XOF
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Centro de Custo: {profile?.costCenter || 'Geral'}
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '16px 18px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Em Andamento Agora</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb', marginTop: '4px' }}>
              {activeRides.length}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Viagens & Entregas ao vivo
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '16px 18px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Colaboradores no App</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
              {employees.length} ativos
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Total mês: {stats.monthSpendXof.toLocaleString('pt-PT')} XOF
            </div>
          </div>
        </div>

        {activeSection === 'employees' ? (
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '22px' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} color="#2563eb" />
              Equipe Autorizada a Pedir Viagens pelo Aplicativo Nô Bai 245
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#64748b' }}>
              Os colaboradores cadastrados abaixo podem abrir o aplicativo comum de passageiro da <strong>Nô Bai 245</strong> no próprio telemóvel e ativar a opção <strong>"Conta Corporativa"</strong> — o valor é faturado diretamente para <strong>{profile?.name}</strong> dentro do teto mensal definido.
            </p>

            <form
              onSubmit={handleAddEmployee}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                alignItems: 'end',
                background: '#f8fafc',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '20px'
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Nome Completo *</label>
                <input required value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Ex: Ana Gomes" style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Telefone no App (+245) *</label>
                <input required value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} placeholder="+245 955..." style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Departamento / Área</label>
                <input value={empDept} onChange={(e) => setEmpDept(e.target.value)} placeholder="Ex: Comercial / Logística" style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Teto Mensal (XOF - Opcional)</label>
                <input type="number" value={empLimit} onChange={(e) => setEmpLimit(e.target.value)} placeholder="Ex: 50000" style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }} />
              </div>
              <button
                type="submit"
                disabled={savingEmp}
                style={{ padding: '10px 14px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <UserPlus size={15} /> {savingEmp ? 'Salvando...' : 'Autorizar Colaborador'}
              </button>
            </form>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                    <th style={{ padding: '10px' }}>Colaborador</th>
                    <th style={{ padding: '10px' }}>Telefone Vinculado</th>
                    <th style={{ padding: '10px' }}>Departamento</th>
                    <th style={{ padding: '10px' }}>Limite Mensal</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                        Nenhum colaborador autorizado ainda. Adicione acima para liberar uso no aplicativo móvel.
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px', fontWeight: 700 }}>{emp.fullName}</td>
                        <td style={{ padding: '10px', fontFamily: 'monospace' }}>{emp.phone}</td>
                        <td style={{ padding: '10px', color: '#475569' }}>{emp.department || 'Geral'}</td>
                        <td style={{ padding: '10px', fontWeight: 700, color: '#059669' }}>
                          {emp.monthlyLimitXof ? `${Number(emp.monthlyLimitXof).toLocaleString('pt-PT')} XOF` : 'Limite da Empresa'}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRemoveEmployee(emp.id, emp.fullName)}
                            style={{ padding: '5px 9px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
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
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px', marginBottom: '26px' }}>
              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '22px', boxShadow: '0 4px 16px rgba(15,23,42,0.03)' }}>
                <h2 style={{ margin: '0 0 14px', fontSize: '17px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Send size={18} color="#059669" />
                  {isDeliveryMode ? 'Despachar Entrega Expressa (Delivery B2B)' : 'Solicitar Transporte Executivo / Hóspede'}
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setTripCategory('AIRPORT_TRANSFER')}
                    style={{
                      padding: '9px 6px',
                      borderRadius: '10px',
                      border: tripCategory === 'AIRPORT_TRANSFER' ? '2px solid #059669' : '1px solid #cbd5e1',
                      background: tripCategory === 'AIRPORT_TRANSFER' ? '#ecfdf5' : '#fff',
                      color: tripCategory === 'AIRPORT_TRANSFER' ? '#065f46' : '#475569',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plane size={15} />
                    Aeroporto OXB
                  </button>

                  <button
                    type="button"
                    onClick={() => setTripCategory('CITY_RIDE')}
                    style={{
                      padding: '9px 6px',
                      borderRadius: '10px',
                      border: tripCategory === 'CITY_RIDE' ? '2px solid #059669' : '1px solid #cbd5e1',
                      background: tripCategory === 'CITY_RIDE' ? '#ecfdf5' : '#fff',
                      color: tripCategory === 'CITY_RIDE' ? '#065f46' : '#475569',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Car size={15} />
                    Corrida Cidade
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTripCategory('EXPRESS_DELIVERY');
                      setVehicleType('MOTO');
                    }}
                    style={{
                      padding: '9px 6px',
                      borderRadius: '10px',
                      border: tripCategory === 'EXPRESS_DELIVERY' ? '2px solid #d97706' : '1px solid #cbd5e1',
                      background: tripCategory === 'EXPRESS_DELIVERY' ? '#fffbeb' : '#fff',
                      color: tripCategory === 'EXPRESS_DELIVERY' ? '#b45309' : '#475569',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Package size={15} />
                    Delivery / Envio
                  </button>

                  <button
                    type="button"
                    onClick={() => setTripCategory('HOURLY_CHARTER')}
                    style={{
                      padding: '9px 6px',
                      borderRadius: '10px',
                      border: tripCategory === 'HOURLY_CHARTER' ? '2px solid #059669' : '1px solid #cbd5e1',
                      background: tripCategory === 'HOURLY_CHARTER' ? '#ecfdf5' : '#fff',
                      color: tripCategory === 'HOURLY_CHARTER' ? '#065f46' : '#475569',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Clock size={15} />
                    À Disposição
                  </button>
                </div>

                {feedback && (
                  <div
                    style={{
                      padding: '11px 13px',
                      borderRadius: '10px',
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

                <form onSubmit={handleDispatch} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {tripCategory === 'AIRPORT_TRANSFER' && (
                    <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '5px', borderRadius: '10px' }}>
                      <button
                        type="button"
                        onClick={() => setAirportDirection('TO_AIRPORT')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '8px',
                          border: 'none',
                          fontWeight: 700,
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: airportDirection === 'TO_AIRPORT' ? '#0f172a' : 'transparent',
                          color: airportDirection === 'TO_AIRPORT' ? '#fff' : '#475569'
                        }}
                      >
                        Empresa/Hotel → Aeroporto OXB
                      </button>
                      <button
                        type="button"
                        onClick={() => setAirportDirection('FROM_AIRPORT')}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '8px',
                          border: 'none',
                          fontWeight: 700,
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
                        style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                        style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                          style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={flightNumber}
                          onChange={(e) => setFlightNumber(e.target.value)}
                          placeholder="Ex: Voo TP 1479"
                          style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                        placeholder="Ex: Balcão / Expedição"
                        style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                        style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
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
                      style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                          style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
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
                        style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
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
                      style={{ width: '100%', padding: '9px 11px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>TARIFA FATURADA À EMPRESA</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
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
                        style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '12px' }}
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
                      padding: '13px',
                      borderRadius: '10px',
                      border: 'none',
                      background: isDeliveryMode ? '#d97706' : '#059669',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '14px',
                      cursor: dispatching ? 'not-allowed' : 'pointer',
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

              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '22px', boxShadow: '0 4px 16px rgba(15,23,42,0.03)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserCheck size={18} color="#2563eb" />
                    Operações Ativas ao Vivo ({activeRides.length})
                  </h2>
                </div>

                {activeRides.length === 0 ? (
                  <div style={{ padding: '44px 20px', textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: '12px', color: '#64748b' }}>
                    <Car size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#334155' }}>Nenhuma viagem ou entrega em curso neste momento</div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      Assim que solicitar um carro ou entregador, os dados da viatura, matrícula, link WhatsApp e PIN aparecerão aqui.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '560px', overflowY: 'auto' }}>
                    {activeRides.map((r) => {
                      const badge = STATUS_LABELS[r.rideStatus] || { label: r.rideStatus, bg: '#f1f5f9', color: '#334155' };
                      return (
                        <div key={r.id} style={{ border: '1px solid #cbd5e1', borderRadius: '12px', padding: '14px', background: '#f8fafc' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                                {r.tripCategory === 'EXPRESS_DELIVERY' ? '📦 ' : ''}
                                {r.guestName} {r.roomNumber ? <span style={{ fontSize: '12px', color: '#059669' }}>({r.roomNumber})</span> : null}
                              </div>
                              {r.flightNumber && (
                                <div style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>
                                  ✈️ Voo: {r.flightNumber}
                                </div>
                              )}
                            </div>
                            <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: badge.bg, color: badge.color }}>
                              {badge.label}
                            </span>
                          </div>

                          <div style={{ fontSize: '12px', color: '#475569', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} /> <strong>De:</strong> {r.originAddress}</div>
                            <div><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} /> <strong>Para:</strong> {r.destinationAddress}</div>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
                            {r.startOtp && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', padding: '4px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 800 }}>
                                <ShieldCheck size={14} />
                                PIN: {r.startOtp}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => copyTrackingWhatsApp(r)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#065f46', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                            >
                              <Share2 size={12} /> Copiar Link WhatsApp
                            </button>
                          </div>

                          {r.driver ? (
                            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{r.driver.fullName}</div>
                                <div style={{ fontSize: '12px', color: '#475569' }}>
                                  {r.driver.vehicleModel || 'Viatura'} • <strong>{r.driver.vehiclePlate || 'Placa N/D'}</strong>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <a
                                  href={`tel:${r.driver.phone}`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '8px', background: '#059669', color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: 700 }}
                                >
                                  <Phone size={13} />
                                  {r.driver.phone}
                                </a>
                                <a
                                  href={`/track/${r.rideId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: '8px', background: '#0f172a', color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: 700 }}
                                >
                                  <ExternalLink size={13} />
                                  Mapa Live
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                              Notificando motoristas/entregadores próximos...
                            </div>
                          )}

                          {['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(r.rideStatus) && (
                            <div style={{ marginTop: '10px', textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={() => handleCancelRide(r.rideId, r.guestName)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '7px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                <XCircle size={13} />
                                Cancelar
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

            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '22px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>Extrato de Viagens & Entregas Faturadas</h2>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Relatório detalhado por quarto, pedido, colaborador ou centro de custo (exportável para Excel/CSV).
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Filtrar nome, quarto, pedido..."
                      style={{ padding: '7px 10px 7px 30px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={exportCsvStatement}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 13px', borderRadius: '8px', border: 'none', background: '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
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
                      <th style={{ padding: '10px' }}>Data / Hora</th>
                      <th style={{ padding: '10px' }}>Ref / Quarto</th>
                      <th style={{ padding: '10px' }}>Passageiro / Destinatário</th>
                      <th style={{ padding: '10px' }}>Trajeto</th>
                      <th style={{ padding: '10px' }}>Motorista</th>
                      <th style={{ padding: '10px' }}>Valor (XOF)</th>
                      <th style={{ padding: '10px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRides.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                          Nenhum registro encontrado.
                        </td>
                      </tr>
                    ) : (
                      filteredRides.map((r) => {
                        const badge = STATUS_LABELS[r.rideStatus] || { label: r.rideStatus, bg: '#f1f5f9', color: '#334155' };
                        return (
                          <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px', whiteSpace: 'nowrap', color: '#475569' }}>
                              {new Date(r.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '10px', fontWeight: 700 }}>{r.roomNumber || '-'}</td>
                            <td style={{ padding: '10px' }}>
                              <div style={{ fontWeight: 700 }}>{r.guestName}</div>
                              {r.flightNumber && <div style={{ fontSize: '11px', color: '#0284c7' }}>Voo {r.flightNumber}</div>}
                              {r.guestPhone && <div style={{ fontSize: '11px', color: '#64748b' }}>{r.guestPhone}</div>}
                            </td>
                            <td style={{ padding: '10px', maxWidth: '280px' }}>
                              <div style={{ fontSize: '12px' }}>{r.originAddress}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>→ {r.destinationAddress}</div>
                            </td>
                            <td style={{ padding: '10px' }}>
                              {r.driver ? (
                                <div>
                                  <div style={{ fontWeight: 600 }}>{r.driver.fullName}</div>
                                  <div style={{ fontSize: '11px', color: '#64748b' }}>{r.driver.vehiclePlate || ''}</div>
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '10px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {r.fareXof.toLocaleString('pt-PT')} XOF
                            </td>
                            <td style={{ padding: '10px' }}>
                              <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: badge.bg, color: badge.color }}>
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
          </>
        )}
      </main>
    </div>
  );
}

export default B2BPortal;
