import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ShieldAlert, MapPin, Award, FileSpreadsheet, Database, RefreshCw, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

import { FileSpreadsheet as ExcelIcon } from 'lucide-react';
import { exportToExcel } from '../utils/excelExport';
import { BarComparisonChart } from '../components/AdminCharts';

export function Governance() {
  const [tab, setTab] = useState<'antifraud' | 'zones' | 'missions' | 'dre' | 'audit'>('antifraud');
  const [loading, setLoading] = useState(true);

  const [fraudAlerts, setFraudAlerts] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [blForm, setBlForm] = useState({ identifierType: 'PHONE', identifierValue: '', reason: '' });

  const [zones, setZones] = useState<any[]>([]);
  const [zoneForm, setZoneForm] = useState({ name: '', zoneType: 'FIXED_ROUTE', fixedPriceXof: '2500', multiplier: '1.0' });

  const [missions, setMissions] = useState<any[]>([]);
  const [missionForm, setMissionForm] = useState({
    title: '', description: '', targetRides: '10', rewardXof: '2500',
    endsAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  });

  const [dreMonths, setDreMonths] = useState<any[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditRestricted, setAuditRestricted] = useState(false);

  const formatXof = (v: number) =>
    new Intl.NumberFormat('pt-GW', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(v || 0);

  const loadData = async () => {
    try {
      setLoading(true);
      const [afRes, zRes, mRes, dreRes, auditRes] = await Promise.allSettled([
        api.get('/admin/enterprise/antifraud/scan'),
        api.get('/admin/enterprise/zones'),
        api.get('/admin/enterprise/missions'),
        api.get('/admin/enterprise/dre'),
        api.get('/admin/audit-logs')
      ]);
      if (afRes.status === 'fulfilled') {
        setFraudAlerts(Array.isArray(afRes.value.data?.alerts) ? afRes.value.data.alerts : []);
        setBlacklist(Array.isArray(afRes.value.data?.blacklist) ? afRes.value.data.blacklist : []);
      }
      if (zRes.status === 'fulfilled') {
        setZones(Array.isArray(zRes.value.data?.data) ? zRes.value.data.data : []);
      }
      if (mRes.status === 'fulfilled') {
        setMissions(Array.isArray(mRes.value.data?.data) ? mRes.value.data.data : []);
      }
      if (dreRes.status === 'fulfilled') {
        setDreMonths(Array.isArray(dreRes.value.data?.months) ? dreRes.value.data.months : []);
      }
      if (auditRes.status === 'fulfilled') {
        const rawLogs = auditRes.value.data?.logs || auditRes.value.data?.data || auditRes.value.data;
        setAuditLogs(Array.isArray(rawLogs) ? rawLogs : []);
        setAuditRestricted(false);
      } else {
        setAuditRestricted(true);
      }
    } catch (err) {
      console.error('Erro ao carregar governança:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/enterprise/blacklist', blForm);
      alert(res.data?.message || 'Bloqueio registado!');
      setBlForm({ identifierType: 'PHONE', identifierValue: '', reason: '' });
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao adicionar à lista negra.');
    }
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/enterprise/zones', zoneForm);
      alert(res.data?.message || 'Zona criada!');
      setZoneForm({ name: '', zoneType: 'FIXED_ROUTE', fixedPriceXof: '2500', multiplier: '1.0' });
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao criar zona.');
    }
  };

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/enterprise/missions', missionForm);
      alert(res.data?.message || 'Missão criada!');
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao criar missão.');
    }
  };

  const handlePayoutMission = async (m: any) => {
    if (!window.confirm(`Creditar bônus de ${formatXof(m.rewardXof)} para todos os motoristas que atingiram ${m.targetRides} corridas na missão "${m.title}"?`)) return;
    try {
      const res = await api.post(`/admin/enterprise/missions/${m.id}/payout`);
      alert(res.data?.message || 'Bônus processados!');
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao pagar bônus da missão.');
    }
  };

  const handleBackupNow = async () => {
    try {
      setBackingUp(true);
      const res = await api.post('/admin/enterprise/system/backup-now');
      alert(res.data?.message || 'Snapshot gerado com sucesso!');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao gerar snapshot.');
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1320px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
            Antifraude, Zonas Tarifárias, Missões & DRE
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '4px' }}>
            Prevenção de perdas, tarifas especiais, incentivos de frota e demonstrativo financeiro consolidado.
          </p>
        </div>
        <button onClick={loadData} style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {[
          { id: 'antifraud', label: `Antifraude & Blacklist (${fraudAlerts.length})`, icon: ShieldAlert },
          { id: 'zones', label: `Zonas & Rotas Fixas (${zones.length})`, icon: MapPin },
          { id: 'missions', label: `Missões da Frota (${missions.length})`, icon: Award },
          { id: 'dre', label: 'DRE Mensal & Backup', icon: FileSpreadsheet },
          { id: 'audit', label: `Trilha de Auditoria (${auditLogs.length})`, icon: Database }
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              style={{
                padding: '9px 15px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                border: active ? '2px solid #0F172A' : '1px solid #CBD5E1',
                backgroundColor: active ? '#0F172A' : '#FFFFFF',
                color: active ? '#FFFFFF' : '#475569'
              }}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'antifraud' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={18} color="#DC2626" /> Alertas do Scanner Antifraude (14 dias)
            </h3>
            {fraudAlerts.length === 0 ? (
              <p style={{ color: '#059669', fontSize: '0.88rem', fontWeight: 600 }}>
                Nenhum padrão de conluio ou abuso de cupom detectado nas últimas 2 semanas.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {fraudAlerts.map((a, i) => (
                  <div key={i} style={{ padding: '12px', borderRadius: '10px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <strong style={{ color: '#991B1B', fontSize: '0.88rem' }}>{a.title}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#7F1D1D', marginTop: '4px' }}>{a.details}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0F172A' }}>
              Lista Negra Multifator (Anti-Reincidência)
            </h3>
            <form onSubmit={handleAddBlacklist} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px' }}>
                <select value={blForm.identifierType} onChange={e => setBlForm({ ...blForm, identifierType: e.target.value })} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}>
                  <option value="PHONE">Telefone</option>
                  <option value="PLATE">Placa</option>
                  <option value="DOCUMENT">Documento/CNH</option>
                  <option value="DEVICE_ID">ID Aparelho</option>
                </select>
                <input required placeholder="Valor (Ex: +24595... ou RG2142)" value={blForm.identifierValue} onChange={e => setBlForm({ ...blForm, identifierValue: e.target.value })} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
              </div>
              <input required placeholder="Motivo do bloqueio definitivo..." value={blForm.reason} onChange={e => setBlForm({ ...blForm, reason: e.target.value })} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
              <button type="submit" style={{ padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: '#DC2626', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
                Bloquear Identificador
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {blacklist.map((b: any) => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: 800, color: '#DC2626' }}>[{b.identifierType}] {b.identifierValue}</span>
                    <div style={{ color: '#64748B' }}>{b.reason}</div>
                  </div>
                  <button onClick={async () => { await api.delete(`/admin/enterprise/blacklist/${b.id}`); loadData(); }} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'zones' && (
        <div>
          <form
            onSubmit={handleCreateZone}
            style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px',
              padding: '18px', marginBottom: '18px', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', alignItems: 'end'
            }}
          >
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Nome da Zona / Rota *</label>
              <input required placeholder="Ex: Aeroporto Osvaldo Vieira" value={zoneForm.name} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Modalidade</label>
              <select value={zoneForm.zoneType} onChange={e => setZoneForm({ ...zoneForm, zoneType: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}>
                <option value="FIXED_ROUTE">Tarifa Fixa (Aeroporto/Rota)</option>
                <option value="INTERCITY">Viagem Interurbana</option>
                <option value="SURGE_ZONE">Zona de Multiplicador</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Preço Fixo (XOF)</label>
              <input type="number" value={zoneForm.fixedPriceXof} onChange={e => setZoneForm({ ...zoneForm, fixedPriceXof: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Multiplicador (x)</label>
              <input type="number" step="0.05" value={zoneForm.multiplier} onChange={e => setZoneForm({ ...zoneForm, multiplier: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <button type="submit" style={{ padding: '9px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#059669', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
              + Criar Zona
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {zones.map((z: any) => (
              <div key={z.id} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{z.name}</strong>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: z.isActive ? '#059669' : '#DC2626' }}>
                    {z.isActive ? 'ATIVA' : 'PAUSADA'}
                  </span>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '6px' }}>
                  Tipo: {z.zoneType} • Preço Fixo: {z.fixedPriceXof ? formatXof(Number(z.fixedPriceXof)) : '-'} • Mult: {z.multiplier}x
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={async () => { await api.patch(`/admin/enterprise/zones/${z.id}/toggle`); loadData(); }} style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontSize: '0.78rem' }}>
                    {z.isActive ? 'Pausar' : 'Ativar'}
                  </button>
                  <button onClick={async () => { await api.delete(`/admin/enterprise/zones/${z.id}`); loadData(); }} style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: '0.78rem' }}>
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'missions' && (
        <div>
          <form
            onSubmit={handleCreateMission}
            style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px',
              padding: '18px', marginBottom: '18px', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', alignItems: 'end'
            }}
          >
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Título da Missão *</label>
              <input required placeholder="Ex: Meta Fim de Semana" value={missionForm.title} onChange={e => setMissionForm({ ...missionForm, title: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Meta Corridas *</label>
              <input type="number" min="1" required value={missionForm.targetRides} onChange={e => setMissionForm({ ...missionForm, targetRides: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Prêmio (XOF) *</label>
              <input type="number" min="100" required value={missionForm.rewardXof} onChange={e => setMissionForm({ ...missionForm, rewardXof: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Válida até *</label>
              <input type="date" required value={missionForm.endsAt} onChange={e => setMissionForm({ ...missionForm, endsAt: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <button type="submit" style={{ padding: '9px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#059669', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
              + Lançar Missão
            </button>
          </form>

          <div style={{ display: 'grid', gap: '12px' }}>
            {missions.map((m: any) => (
              <div key={m.id} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <strong style={{ fontSize: '1rem', color: '#0F172A' }}>{m.title}</strong>
                  <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '4px' }}>
                    Meta: <strong>{m.targetRides} corridas</strong> • Prêmio: <strong style={{ color: '#059669' }}>{formatXof(m.rewardXof)}</strong> • Até {new Date(m.endsAt).toLocaleDateString('pt-BR')}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#1D4ED8', fontWeight: 700, marginTop: '4px' }}>
                    {m.qualifiedDriversCount || 0} motorista(s) atingiram a meta (de {m.participatingDriversCount || 0} ativos)
                  </div>
                </div>
                <button
                  onClick={() => handlePayoutMission(m)}
                  style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#059669', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}
                >
                  Creditar Bônus aos Qualificados
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'dre' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F172A', color: '#FFFFFF', padding: '18px 22px', borderRadius: '14px', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={18} color="#34D399" /> Snapshot de Segurança & Continuidade Operacional
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#94A3B8' }}>
                Gera ponto de restauração verificado das tarifas, configurações, cupons e contadores do livro-razão.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-excel-export"
                onClick={() => {
                  if (dreMonths.length === 0) return alert('Sem dados de DRE para exportar.');
                  exportToExcel({
                    fileName: `nobai245-dre-6meses-${new Date().toISOString().slice(0, 10)}.xlsx`,
                    sheetName: 'DRE Consolidado',
                    columns: [
                      { header: 'Mês', key: (m: any) => m.monthLabel || '' },
                      { header: 'Corridas Concluídas', key: (m: any) => Number(m.completedRides || 0) },
                      { header: 'Volume Bruto (XOF)', key: (m: any) => Number(m.grossVolumeXof || 0) },
                      { header: 'Comissões Retidas (XOF)', key: (m: any) => Number(m.commissionsXof || 0) },
                      { header: 'Subsídios Cupons (XOF)', key: (m: any) => Number(m.promoSubsidiesXof || 0) },
                      { header: 'Estornos (XOF)', key: (m: any) => Number(m.refundsXof || 0) },
                      { header: 'Resultado Líquido Plataforma (XOF)', key: (m: any) => Number(m.netPlatformResultXof || 0) },
                    ],
                    rows: dreMonths,
                  });
                }}
              >
                <ExcelIcon size={16} /> Exportar DRE (Excel)
              </button>
              <button
                onClick={handleBackupNow}
                disabled={backingUp}
                style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', backgroundColor: '#10B981', color: '#0F172A', fontWeight: 800, cursor: 'pointer' }}
              >
                {backingUp ? 'Gerando Snapshot...' : 'Gerar Backup Agora'}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <BarComparisonChart
              title="Evolução Financeira DRE (Últimos 6 Meses)"
              subtitle="Volume Bruto vs. Resultado Líquido da Plataforma"
              primaryLabel="Volume Bruto"
              secondaryLabel="Resultado Líquido"
              valueFormatter={(v) => formatXof(v)}
              data={dreMonths.map((m: any) => ({
                label: m.monthLabel,
                value: Number(m.grossVolumeXof || 0),
                secondaryValue: Number(m.netPlatformResultXof || 0),
                subtitle: `${m.completedRides || 0} corridas`,
              }))}
            />
          </div>

          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '12px 16px' }}>Mês</th>
                  <th style={{ padding: '12px 16px' }}>Corridas Concluídas</th>
                  <th style={{ padding: '12px 16px' }}>Volume Bruto</th>
                  <th style={{ padding: '12px 16px' }}>Comissões Retidas</th>
                  <th style={{ padding: '12px 16px' }}>Subsídios Cupons</th>
                  <th style={{ padding: '12px 16px' }}>Estornos</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Resultado Líquido Plataforma</th>
                </tr>
              </thead>
              <tbody>
                {dreMonths.map((m: any, idx: number) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, textTransform: 'capitalize' }}>{m.monthLabel}</td>
                    <td style={{ padding: '12px 16px' }}>{m.completedRides}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>{formatXof(m.grossVolumeXof)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#059669', fontWeight: 700 }}>{formatXof(m.commissionsXof)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#D97706' }}>-{formatXof(m.promoSubsidiesXof)}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#DC2626' }}>-{formatXof(m.refundsXof)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: m.netPlatformResultXof >= 0 ? '#059669' : '#DC2626' }}>
                      {formatXof(m.netPlatformResultXof)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0F172A' }}>
                Trilha Imutável de Auditoria Administrativa (Compliance)
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748B' }}>
                Registro automático de todas as alterações financeiras, aprovações de frota, tarifas e configurações.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Filtrar por operador, ação, IP ou alvo..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                style={{
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  minWidth: '250px',
                }}
              />
              <button
                type="button"
                className="btn-excel-export"
                onClick={() => {
                  if (auditLogs.length === 0) return alert('Nenhum registro de auditoria para exportar.');
                  exportToExcel({
                    fileName: `nobai245-auditoria-${new Date().toISOString().slice(0, 10)}.xlsx`,
                    sheetName: 'Trilha de Auditoria',
                    columns: [
                      { header: 'Data / Hora', key: (l: any) => (l.createdAt ? new Date(l.createdAt).toLocaleString('pt-BR') : '') },
                      { header: 'Colaborador', key: (l: any) => l.admin?.name || l.adminId || '' },
                      { header: 'E-mail', key: (l: any) => l.admin?.email || '' },
                      { header: 'Cargo', key: (l: any) => l.admin?.role || '' },
                      { header: 'Ação Executada', key: (l: any) => l.action || '' },
                      { header: 'Módulo / Alvo', key: (l: any) => `${l.targetType || ''} ${l.targetId || ''}`.trim() },
                      { header: 'Endereço IP', key: (l: any) => l.ipAddress || '' },
                      { header: 'Detalhes (JSON)', key: (l: any) => (l.payload ? JSON.stringify(l.payload) : '') },
                    ],
                    rows: auditLogs,
                  });
                }}
              >
                <ExcelIcon size={16} /> Exportar Auditoria (Excel)
              </button>
            </div>
          </div>

          {auditRestricted ? (
            <div style={{ padding: '24px', borderRadius: '12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.9rem', fontWeight: 600 }}>
              Acesso restrito: apenas contas com perfil <strong>SUPER_ADMIN</strong> podem visualizar o histórico completo de auditoria.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
                    <th style={{ padding: '12px 14px' }}>Data / Hora</th>
                    <th style={{ padding: '12px 14px' }}>Operador</th>
                    <th style={{ padding: '12px 14px' }}>Ação</th>
                    <th style={{ padding: '12px 14px' }}>Módulo / Alvo</th>
                    <th style={{ padding: '12px 14px' }}>IP Origem</th>
                    <th style={{ padding: '12px 14px' }}>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs
                    .filter((log: any) => {
                      const q = auditSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        String(log.admin?.name || '').toLowerCase().includes(q) ||
                        String(log.admin?.email || '').toLowerCase().includes(q) ||
                        String(log.action || '').toLowerCase().includes(q) ||
                        String(log.targetType || '').toLowerCase().includes(q) ||
                        String(log.ipAddress || '').toLowerCase().includes(q)
                      );
                    })
                    .map((log: any) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', color: '#334155' }}>
                          {log.createdAt ? new Date(log.createdAt).toLocaleString('pt-BR') : '-'}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <strong style={{ display: 'block', color: '#0F172A' }}>{log.admin?.name || 'Admin'}</strong>
                          <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{log.admin?.role || log.admin?.email || ''}</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#059669' }}>
                          {log.action}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '6px', backgroundColor: '#F1F5F9', fontWeight: 700, fontSize: '0.75rem', color: '#334155' }}>
                            {log.targetType}
                          </span>
                          {log.targetId && (
                            <span style={{ display: 'block', fontSize: '0.74rem', color: '#64748B', marginTop: '2px' }}>
                              ID: {String(log.targetId).slice(0, 18)}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', fontFamily: 'monospace', color: '#475569' }}>
                          {log.ipAddress || '-'}
                        </td>
                        <td style={{ padding: '11px 14px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#64748B', fontFamily: 'monospace', fontSize: '0.76rem' }} title={log.payload ? JSON.stringify(log.payload) : ''}>
                          {log.payload ? JSON.stringify(log.payload) : '-'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
