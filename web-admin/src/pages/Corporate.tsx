import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import {
  Building2,
  Truck,
  RefreshCw,
  UserPlus,
  KeyRound,
  ExternalLink
} from 'lucide-react';

export function Corporate() {
  const [tab, setTab] = useState<'b2b' | 'partners'>('b2b');
  const [corporates, setCorporates] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [corpForm, setCorpForm] = useState({
    name: '',
    accountType: 'HOTEL',
    contactPhone: '',
    contactEmail: '',
    costCenter: '',
    creditLimitXof: '250000',
    initialBalanceXof: '0',
    accessCode: '',
    defaultPickupAddress: ''
  });

  const [partnerForm, setPartnerForm] = useState({
    ownerName: '',
    phone: '',
    orangeNumber: '',
    mtnNumber: '',
    ownerSharePercent: '50'
  });

  const formatXof = (v: number) =>
    new Intl.NumberFormat('pt-GW', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(v || 0);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [cRes, pRes, dRes] = await Promise.all([
        api.get('/admin/enterprise/corporates'),
        api.get('/admin/enterprise/fleet-partners'),
        api.get('/admin/drivers', { params: { limit: 150 } })
      ]);
      setCorporates(Array.isArray(cRes.data?.data) ? cRes.data.data : []);
      setPartners(Array.isArray(pRes.data?.data) ? pRes.data.data : []);
      const dList = Array.isArray(dRes.data?.data) ? dRes.data.data : (Array.isArray(dRes.data) ? dRes.data : []);
      setDrivers(dList.filter((d: any) => d.status === 'APPROVED'));
    } catch (err) {
      console.error('Erro ao carregar dados corporativos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateCorporate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/enterprise/corporates', corpForm);
      alert(res.data?.message || 'Parceiro B2B cadastrado!');
      setCorpForm({
        name: '',
        accountType: 'HOTEL',
        contactPhone: '',
        contactEmail: '',
        costCenter: '',
        creditLimitXof: '250000',
        initialBalanceXof: '0',
        accessCode: '',
        defaultPickupAddress: ''
      });
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao cadastrar parceiro B2B.');
    }
  };

  const handleConfigureAccess = async (corp: any) => {
    const newPin = window.prompt(
      `Definir novo PIN / Senha de acesso ao Portal B2B (/portal-b2b) para ${corp.name} (mín. 4 dígitos - deixe vazio para manter o atual):`
    );
    const newLimit = window.prompt(
      `Definir Limite de Crédito Mensal (XOF) para ${corp.name}:`,
      String(Math.round(Number(corp.creditLimitXof || 250000)))
    );
    if (newPin === null && newLimit === null) return;

    try {
      const payload: any = {};
      if (newPin && newPin.trim().length >= 4) payload.accessCode = newPin.trim();
      if (newLimit !== null && newLimit.trim() !== '' && !isNaN(Number(newLimit))) {
        payload.creditLimitXof = Number(newLimit);
      }
      const res = await api.patch(`/admin/enterprise/corporates/${corp.id}/access`, payload);
      alert(res.data?.message || 'Credenciais e limite atualizados!');
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao atualizar acesso B2B.');
    }
  };

  const handleAdjustFatura = async (corp: any) => {
    const val = window.prompt(
      `Registrar pagamento de fatura (use valor NEGATIVO, ex: -50000) ou acréscimo de consumo (POSITIVO) para ${corp.name}:`,
      '-50000'
    );
    if (!val) return;
    try {
      const res = await api.patch(`/admin/enterprise/corporates/${corp.id}/balance`, { amountXof: Number(val) });
      alert(res.data?.message || 'Fatura atualizada!');
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao atualizar fatura.');
    }
  };

  const handleAddEmployee = async (corp: any) => {
    const fullName = window.prompt(`Nome do colaborador autorizado em ${corp.name}:`);
    if (!fullName) return;
    const phone = window.prompt(`Telefone do colaborador (+245...):`);
    if (!phone) return;
    const limit = window.prompt(`Limite mensal individual deste colaborador em XOF (deixe vazio para usar o limite da empresa):`, '');
    try {
      await api.post(`/admin/enterprise/corporates/${corp.id}/employees`, {
        fullName,
        phone,
        monthlyLimitXof: limit ? Number(limit) : null
      });
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao vincular colaborador.');
    }
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/enterprise/fleet-partners', partnerForm);
      alert(res.data?.message || 'Frotista cadastrado!');
      setPartnerForm({ ownerName: '', phone: '', orangeNumber: '', mtnNumber: '', ownerSharePercent: '50' });
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao cadastrar frotista.');
    }
  };

  const handleAssignVehicle = async (partnerId: string, driverId: string) => {
    if (!driverId) return;
    try {
      await api.post(`/admin/enterprise/fleet-partners/${partnerId}/assign-driver`, { driverId });
      loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao vincular veículo.');
    }
  };

  const getTypeBadge = (type: string) => {
    if (type === 'HOTEL') {
      return { label: '🏨 HOTELARIA & CONCIERGE', bg: '#E0F2FE', color: '#0369A1' };
    }
    if (type === 'DELIVERY') {
      return { label: '📦 DELIVERY & ENTREGAS', bg: '#FEF3C7', color: '#B45309' };
    }
    return { label: '🏢 EMPRESA / ONG / EMBAIXADA', bg: '#ECFDF5', color: '#047857' };
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1320px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
            Ecossistema B2B (Hotéis, Empresas & Delivery) e Frotistas
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '4px' }}>
            Gerencie recepções de hotéis, empresas com colaboradores, lojas de delivery e proprietários de frota.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a
            href="/portal-b2b"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '9px 14px',
              borderRadius: '10px',
              background: '#0F172A',
              color: '#FFF',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <ExternalLink size={15} /> Abrir Portal B2B (/portal-b2b)
          </a>
          <button onClick={loadAll} style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontWeight: 600 }}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button
          onClick={() => setTab('b2b')}
          style={{
            padding: '10px 18px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            border: tab === 'b2b' ? '2px solid #059669' : '1px solid #CBD5E1',
            backgroundColor: tab === 'b2b' ? '#ECFDF5' : '#FFFFFF',
            color: tab === 'b2b' ? '#047857' : '#475569'
          }}
        >
          <Building2 size={18} /> Parceiros B2B ({corporates.length})
        </button>
        <button
          onClick={() => setTab('partners')}
          style={{
            padding: '10px 18px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            border: tab === 'partners' ? '2px solid #1D4ED8' : '1px solid #CBD5E1',
            backgroundColor: tab === 'partners' ? '#EFF6FF' : '#FFFFFF',
            color: tab === 'partners' ? '#1D4ED8' : '#475569'
          }}
        >
          <Truck size={18} /> Frotistas / Donos de Carros ({partners.length})
        </button>
      </div>

      {tab === 'b2b' ? (
        <>
          <form
            onSubmit={handleCreateCorporate}
            style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px',
              padding: '18px', marginBottom: '20px', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '12px', alignItems: 'end'
            }}
          >
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Modalidade B2B *</label>
              <select
                value={corpForm.accountType}
                onChange={e => setCorpForm({ ...corpForm, accountType: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }}
              >
                <option value="HOTEL">🏨 Hotel / Resort (Recepção)</option>
                <option value="CORPORATE">🏢 Empresa / ONG / Embaixada</option>
                <option value="DELIVERY">📦 Loja / Restaurante / Farmácia (Delivery)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Nome do Parceiro *</label>
              <input required placeholder="Ex: Hotel Ledger / UNICEF / Farmácia" value={corpForm.name} onChange={e => setCorpForm({ ...corpForm, name: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Telefone Login *</label>
              <input required placeholder="+245 955..." value={corpForm.contactPhone} onChange={e => setCorpForm({ ...corpForm, contactPhone: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>PIN / Senha Portal B2B *</label>
              <input required minLength={4} placeholder="Ex: 2450" value={corpForm.accessCode} onChange={e => setCorpForm({ ...corpForm, accessCode: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Limite de Crédito (XOF)</label>
              <input type="number" value={corpForm.creditLimitXof} onChange={e => setCorpForm({ ...corpForm, creditLimitXof: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Endereço Base (Opcional)</label>
              <input placeholder="Ex: Av. Pansau Na Isna, Bissau" value={corpForm.defaultPickupAddress} onChange={e => setCorpForm({ ...corpForm, defaultPickupAddress: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>

            <button type="submit" style={{ padding: '9px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#059669', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
              + Criar Parceiro B2B
            </button>
          </form>

          <div style={{ display: 'grid', gap: '16px' }}>
            {corporates.map((c: any) => {
              const badge = getTypeBadge(c.accountType);
              const limit = Number(c.creditLimitXof || 0);
              const used = Number(c.currentBalanceXof || 0);
              const available = Math.max(0, limit - used);

              return (
                <div key={c.id} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0F172A' }}>{c.name}</h3>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', backgroundColor: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                        {c.accessCodeHash ? (
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: '#DCFCE7', color: '#166534' }}>
                            Portal Ativo
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                            Sem PIN configurado
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
                        Login: <strong>{c.contactPhone}</strong> {c.costCenter ? `• CC: ${c.costCenter}` : ''} • Limite: <strong>{formatXof(limit)}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ backgroundColor: '#ECFDF5', color: '#047857', padding: '6px 12px', borderRadius: '10px', fontWeight: 800, fontFamily: 'monospace', fontSize: '0.82rem' }}>
                        Disponível: {formatXof(available)} (Fatura: {formatXof(used)})
                      </span>
                      <button
                        onClick={() => handleConfigureAccess(c)}
                        style={{ padding: '7px 11px', borderRadius: '8px', border: '1px solid #0F172A', background: '#0F172A', color: '#FFF', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}
                      >
                        <KeyRound size={14} /> PIN / Limite
                      </button>
                      <button
                        onClick={() => handleAdjustFatura(c)}
                        style={{ padding: '7px 11px', borderRadius: '8px', border: '1px solid #059669', background: '#FFF', color: '#059669', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        Baixar Fatura
                      </button>
                      <button
                        onClick={() => handleAddEmployee(c)}
                        style={{ padding: '7px 11px', borderRadius: '8px', border: 'none', background: '#1D4ED8', color: '#FFF', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' }}
                      >
                        <UserPlus size={14} /> + Colaborador App
                      </button>
                    </div>
                  </div>

                  {Array.isArray(c.employees) && c.employees.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '10px', borderTop: '1px solid #F1F5F9' }}>
                      {c.employees.map((emp: any) => (
                        <span key={emp.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: '4px 10px', borderRadius: '999px', fontSize: '0.8rem' }}>
                          <strong>{emp.fullName}</strong> ({emp.phone})
                          {emp.monthlyLimitXof ? <span style={{ color: '#059669', fontWeight: 700 }}>• Teto: {formatXof(Number(emp.monthlyLimitXof))}</span> : null}
                          <button
                            onClick={async () => { await api.delete(`/admin/enterprise/corporates/employees/${emp.id}`); loadAll(); }}
                            style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', padding: 0 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <form
            onSubmit={handleCreatePartner}
            style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px',
              padding: '18px', marginBottom: '20px', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', alignItems: 'end'
            }}
          >
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Proprietário da Frota *</label>
              <input required placeholder="Ex: Mamadu Djaló" value={partnerForm.ownerName} onChange={e => setPartnerForm({ ...partnerForm, ownerName: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Telefone *</label>
              <input required placeholder="+245..." value={partnerForm.phone} onChange={e => setPartnerForm({ ...partnerForm, phone: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Orange Money</label>
              <input placeholder="24595..." value={partnerForm.orangeNumber} onChange={e => setPartnerForm({ ...partnerForm, orangeNumber: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Parte do Dono (%)</label>
              <input type="number" min="0" max="100" value={partnerForm.ownerSharePercent} onChange={e => setPartnerForm({ ...partnerForm, ownerSharePercent: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }} />
            </div>
            <button type="submit" style={{ padding: '9px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#1D4ED8', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
              + Cadastrar Frotista
            </button>
          </form>

          <div style={{ display: 'grid', gap: '16px' }}>
            {partners.map((p: any) => (
              <div key={p.id} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0F172A' }}>{p.ownerName}</h3>
                    <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
                      Tel: {p.phone} • Divisão Acordada: <strong>{p.ownerSharePercent}% Dono</strong> / {100 - p.ownerSharePercent}% Motorista
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ backgroundColor: '#F1F5F9', padding: '6px 12px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700 }}>
                      Veículos: {p.summary?.vehicleCount || 0} • Corridas: {p.summary?.totalCompletedRides || 0}
                    </span>
                    <span style={{ backgroundColor: '#ECFDF5', color: '#047857', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 800 }}>
                      Repasse Dono Est.: {formatXof(p.summary?.estimatedOwnerShareXof || 0)}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <select
                    defaultValue=""
                    onChange={(e) => { handleAssignVehicle(p.id, e.target.value); e.target.value = ''; }}
                    style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
                  >
                    <option value="">+ Vincular motorista/placa a este frotista...</option>
                    {drivers.map((d: any) => (
                      <option key={d.id} value={d.id}>{d.fullName} ({d.vehiclePlate})</option>
                    ))}
                  </select>
                </div>

                {Array.isArray(p.vehicles) && p.vehicles.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                    {p.vehicles.map((v: any) => (
                      <div key={v.linkId} style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: '0.88rem' }}>{v.fullName}</strong>
                          <div style={{ fontSize: '0.76rem', color: '#64748B' }}>
                            Placa: {v.vehiclePlate} • {v.completedRides} corridas • Líquido: {formatXof(v.netEarningsXof)}
                          </div>
                        </div>
                        <button
                          onClick={async () => { await api.delete(`/admin/enterprise/fleet-partners/drivers/${v.linkId}`); loadAll(); }}
                          style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 700 }}
                          title="Desvincular"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
