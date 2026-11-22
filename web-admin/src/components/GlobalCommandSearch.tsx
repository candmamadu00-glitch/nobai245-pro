import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Car,
  Users,
  Navigation,
  LayoutDashboard,
  DollarSign,
  ShieldAlert,
  Ticket,
  Settings,
  BarChart3,
  Building2,
  Award,
  X,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { api } from '../services/api';

interface QuickResult {
  id: string;
  group: 'Módulos' | 'Motoristas' | 'Passageiros' | 'Corridas';
  title: string;
  subtitle: string;
  route: string;
  badge?: string;
}

const SYSTEM_MODULES: QuickResult[] = [
  { id: 'mod-dash', group: 'Módulos', title: 'Centro de Comando (Dashboard)', subtitle: 'Métricas ao vivo e pulso operacional', route: '/' },
  { id: 'mod-radar', group: 'Módulos', title: 'Radar da Frota ao Vivo', subtitle: 'Mapa GPS em tempo real dos motoristas', route: '/radar' },
  { id: 'mod-rides', group: 'Módulos', title: 'Monitor de Corridas', subtitle: 'Histórico, despacho manual e telemetria', route: '/rides' },
  { id: 'mod-sos', group: 'Módulos', title: 'Central de Emergência SOS', subtitle: 'Alertas críticos e áudios de pânico', route: '/sos' },
  { id: 'mod-req', group: 'Módulos', title: 'Aprovações & Documentos', subtitle: 'Novos cadastros e alterações de frota', route: '/driver-requests' },
  { id: 'mod-drv', group: 'Módulos', title: 'Gestão de Motoristas', subtitle: 'Frota completa, carteiras e bloqueios', route: '/drivers' },
  { id: 'mod-pax', group: 'Módulos', title: 'Gestão de Passageiros', subtitle: 'Base de clientes, saldos e histórico', route: '/passengers' },
  { id: 'mod-fin', group: 'Módulos', title: 'Tesouraria & Financeiro', subtitle: 'Caixa, comissões, repasses e fechamento', route: '/financial' },
  { id: 'mod-corp', group: 'Módulos', title: 'Empresas & Frotistas B2B', subtitle: 'Contas corporativas e donos de frota', route: '/corporate' },
  { id: 'mod-gov', group: 'Módulos', title: 'Governança, DRE & Auditoria', subtitle: 'Antifraude, logs de auditoria e DRE 6 meses', route: '/governance' },
  { id: 'mod-bi', group: 'Módulos', title: 'Inteligência & BI', subtitle: 'Receita por canal, corredores e retenção', route: '/analytics' },
  { id: 'mod-tkt', group: 'Módulos', title: 'Suporte & Chamados', subtitle: 'Atendimento a motoristas e passageiros', route: '/tickets' },
  { id: 'mod-cfg', group: 'Módulos', title: 'Tarifas & Configurações', subtitle: 'Preços por km, taxa dinâmica e Mobile Money', route: '/settings' },
];

export function GlobalCommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [cachedEntities, setCachedEntities] = useState<QuickResult[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 40);

    // Atualiza índice de busca a cada 60s quando aberto
    if (Date.now() - lastFetchedAt < 60000 && cachedEntities.length > 0) return;

    let mounted = true;
    const loadSearchIndex = async () => {
      try {
        setLoadingData(true);
        const [drvRes, paxRes, rideRes] = await Promise.allSettled([
          api.get('/admin/drivers'),
          api.get('/admin/passengers'),
          api.get('/admin/rides'),
        ]);

        if (!mounted) return;
        const items: QuickResult[] = [];

        if (drvRes.status === 'fulfilled') {
          const list = Array.isArray(drvRes.value.data?.drivers)
            ? drvRes.value.data.drivers
            : Array.isArray(drvRes.value.data)
            ? drvRes.value.data
            : [];
          list.slice(0, 150).forEach((d: any) => {
            items.push({
              id: `drv-${d.id}`,
              group: 'Motoristas',
              title: `${d.fullName || 'Motorista'} (${d.vehiclePlate || 'S/ Placa'})`,
              subtitle: `Tel: ${d.phone || '-'} • Veículo: ${d.vehicleBrand || d.vehicleType || '-'}`,
              route: '/drivers',
              badge: d.status,
            });
          });
        }

        if (paxRes.status === 'fulfilled') {
          const list = Array.isArray(paxRes.value.data?.passengers)
            ? paxRes.value.data.passengers
            : Array.isArray(paxRes.value.data)
            ? paxRes.value.data
            : [];
          list.slice(0, 150).forEach((p: any) => {
            items.push({
              id: `pax-${p.id}`,
              group: 'Passageiros',
              title: p.fullName || 'Passageiro',
              subtitle: `Tel: ${p.phone || '-'}${p.email ? ` • ${p.email}` : ''}`,
              route: '/passengers',
              badge: p.status,
            });
          });
        }

        if (rideRes.status === 'fulfilled') {
          const list = Array.isArray(rideRes.value.data?.rides)
            ? rideRes.value.data.rides
            : Array.isArray(rideRes.value.data)
            ? rideRes.value.data
            : [];
          list.slice(0, 120).forEach((r: any) => {
            items.push({
              id: `ride-${r.id}`,
              group: 'Corridas',
              title: `Corrida #${String(r.id).slice(0, 8)} • ${r.passengerName || r.passenger?.fullName || 'Passageiro'}`,
              subtitle: `${r.originAddress || 'Origem'} → ${r.destinationAddress || 'Destino'}`,
              route: '/rides',
              badge: r.status,
            });
          });
        }

        setCachedEntities(items);
        setLastFetchedAt(Date.now());
      } finally {
        if (mounted) setLoadingData(false);
      }
    };

    loadSearchIndex();
    return () => {
      mounted = false;
    };
  }, [open, lastFetchedAt, cachedEntities.length]);

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SYSTEM_MODULES.slice(0, 7);

    const pool = [...SYSTEM_MODULES, ...cachedEntities];
    return pool
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q)
      )
      .slice(0, 18);
  }, [query, cachedEntities]);

  const getIcon = (group: QuickResult['group']) => {
    switch (group) {
      case 'Motoristas':
        return <Car size={16} color="#059669" />;
      case 'Passageiros':
        return <Users size={16} color="#0284C7" />;
      case 'Corridas':
        return <Navigation size={16} color="#7C3AED" />;
      default:
        return <LayoutDashboard size={16} color="#475569" />;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="global-cmd-trigger"
        title="Busca Global Rápida (Ctrl + K)"
      >
        <Search size={15} />
        <span className="cmd-trigger-text">Buscar motorista, placa, corrida...</span>
        <kbd className="cmd-kbd">Ctrl K</kbd>
      </button>

      {open && (
        <div className="cmd-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="cmd-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="cmd-input-row">
              <Search size={18} color="#64748B" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite nome, telefone, placa, ID da corrida ou módulo..."
                className="cmd-search-input"
              />
              {loadingData && <Loader2 size={16} className="spinner" color="#059669" />}
              <button type="button" onClick={() => setOpen(false)} className="cmd-close-btn">
                <X size={17} />
              </button>
            </div>

            <div className="cmd-results-list">
              {filteredResults.length === 0 ? (
                <div className="cmd-empty">
                  Nenhum resultado encontrado para <strong>"{query}"</strong>.
                </div>
              ) : (
                filteredResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="cmd-result-item"
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      navigate(item.route);
                    }}
                  >
                    <div className="cmd-result-icon">{getIcon(item.group)}</div>
                    <div className="cmd-result-body">
                      <div className="cmd-result-top">
                        <span className="cmd-group-tag">{item.group}</span>
                        <strong>{item.title}</strong>
                      </div>
                      <small>{item.subtitle}</small>
                    </div>
                    {item.badge && <span className="cmd-status-pill">{item.badge}</span>}
                    <ArrowRight size={14} color="#94A3B8" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
