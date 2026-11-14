import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { BarChart3, RefreshCw, XCircle, CheckCircle2, TrendingUp, MapPin, CreditCard } from 'lucide-react';

export function Analytics() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const formatXof = (v: number) =>
    new Intl.NumberFormat('pt-GW', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(v || 0);

  const fetchAnalytics = async (periodDays: number) => {
    try {
      setLoading(true);
      const res = await api.get('/admin/analytics/overview', { params: { days: periodDays } });
      setData(res.data);
    } catch (err) {
      console.error('Erro ao carregar inteligência operacional:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(days);
  }, [days]);

  const kpis = data?.kpis || {};
  const cancelByActor = data?.cancelByActor || {};
  const topCancelReasons = Array.isArray(data?.topCancelReasons) ? data.topCancelReasons : [];
  const paymentBreakdown = data?.paymentBreakdown || {};
  const topRoutes = Array.isArray(data?.topRoutes) ? data.topRoutes : [];

  return (
    <div style={{ padding: '24px', maxWidth: '1320px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BarChart3 size={24} color="#059669" /> Inteligência Operacional & Relatórios
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '4px' }}>
            Diagnóstico de conversão, motivos de cancelamento, receitas por canal e rotas mais procuradas.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '8px 14px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
                border: days === d ? '2px solid #059669' : '1px solid #CBD5E1',
                backgroundColor: days === d ? '#ECFDF5' : '#FFFFFF',
                color: days === d ? '#047857' : '#475569'
              }}
            >
              Últimos {d} dias
            </button>
          ))}
          <button
            onClick={() => fetchAnalytics(days)}
            style={{
              padding: '8px 12px', borderRadius: '10px', border: '1px solid #CBD5E1',
              backgroundColor: '#FFFFFF', cursor: 'pointer'
            }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPIs Principais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '22px' }}>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Taxa de Conversão</span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#059669', marginTop: '4px' }}>
            {loading ? '...' : `${kpis.completionRate || 0}%`}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
            {kpis.completedRides || 0} concluídas de {kpis.totalRides || 0} pedidos
          </span>
        </div>

        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Faturamento Bruto</span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', marginTop: '4px' }}>
            {loading ? '...' : formatXof(kpis.grossRevenue || 0)}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
            Ticket médio: {formatXof(kpis.avgTicket || 0)}
          </span>
        </div>

        <div style={{ backgroundColor: '#0F172A', borderRadius: '12px', padding: '16px', color: '#FFFFFF' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>Receita Plataforma</span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#34D399', marginTop: '4px' }}>
            {loading ? '...' : formatXof(kpis.platformRevenue || 0)}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
            Repasse motoristas: {formatXof(kpis.driverNetTotal || 0)}
          </span>
        </div>

        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Cancelamentos</span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#DC2626', marginTop: '4px' }}>
            {loading ? '...' : kpis.cancelledRides || 0}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
            Passag: {cancelByActor.PASSENGER || 0} • Mot: {cancelByActor.DRIVER || 0} • Sem atrib: {cancelByActor.SYSTEM_OR_UNASSIGNED || 0}
          </span>
        </div>
      </div>

      {/* Blocos Analíticos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '18px', marginBottom: '20px' }}>
        {/* Motivos de Cancelamento */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <XCircle size={18} color="#DC2626" /> Principais Motivos de Cancelamento
          </h3>
          {topCancelReasons.length === 0 ? (
            <p style={{ color: '#94A3B8', fontSize: '0.86rem' }}>Nenhum cancelamento no período.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {topCancelReasons.map((item: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: '#FEF2F2', borderRadius: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: '#7F1D1D', fontWeight: 600 }}>{item.reason}</span>
                  <span style={{ backgroundColor: '#DC2626', color: '#FFFFFF', padding: '2px 10px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 800 }}>
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Receita por Método de Pagamento */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={18} color="#2563EB" /> Receita por Método de Pagamento
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { key: 'CASH', label: 'Dinheiro (Cash)' },
              { key: 'ORANGE_MONEY', label: 'Orange Money' },
              { key: 'MTN_MOMO', label: 'Telecel / MTN MoMo' }
            ].map((pm) => {
              const info = paymentBreakdown[pm.key] || { rides: 0, revenue: 0 };
              return (
                <div key={pm.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.9rem' }}>{pm.label}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{info.rides} corrida(s) concluída(s)</div>
                  </div>
                  <strong style={{ fontSize: '1rem', color: '#059669', fontFamily: 'monospace' }}>
                    {formatXof(info.revenue)}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Rotas / Corredores de Demanda */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MapPin size={18} color="#059669" /> Corredores Mais Procurados em Bissau
        </h3>
        {topRoutes.length === 0 ? (
          <p style={{ color: '#94A3B8', fontSize: '0.86rem' }}>Sem dados de rotas no período.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topRoutes.map((rt: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '10px' }}>
                <div style={{ fontSize: '0.86rem', color: '#1E293B' }}>
                  <strong>{rt.origin}</strong> <span style={{ color: '#94A3B8' }}>→</span> <strong>{rt.destination}</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 700 }}>{rt.completed} ok</span>
                  <span style={{ backgroundColor: '#F1F5F9', color: '#0F172A', padding: '3px 10px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700 }}>
                    {rt.total} pedido(s)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
