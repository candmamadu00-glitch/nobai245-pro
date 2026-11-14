import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Tag, Plus, RefreshCw, CheckCircle, XCircle, Trash2, Percent, DollarSign } from 'lucide-react';

interface PromoItem {
  id: string;
  code: string;
  description: string | null;
  discountPercentage: number | null;
  discountFixed: number | null;
  maxDiscountAmount: number | null;
  minRideAmount: number;
  maxUsageTotal: number | null;
  currentUsage: number;
  maxUsagePerUser: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export function Promos() {
  const [promos, setPromos] = useState<PromoItem[]>([]);
  const [summary, setSummary] = useState({
    totalPromos: 0,
    activePromos: 0,
    totalRedemptions: 0,
    totalDiscountGrantedXof: 0
  });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    code: '',
    description: '',
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
    discountValue: '15',
    maxDiscountAmount: '500',
    minRideAmount: '800',
    maxUsageTotal: '100',
    maxUsagePerUser: '1',
    expiresAt: ''
  });

  const formatXof = (v: number) =>
    new Intl.NumberFormat('pt-GW', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(v || 0);

  const fetchPromos = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/promos');
      setPromos(Array.isArray(res.data?.data) ? res.data.data : []);
      if (res.data?.summary) setSummary(res.data.summary);
    } catch (err) {
      console.error('Erro ao carregar cupons:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPromos();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await api.post('/admin/promos', form);
      alert(res.data?.message || 'Cupom criado!');
      setShowModal(false);
      setForm({
        code: '',
        description: '',
        discountType: 'PERCENTAGE',
        discountValue: '15',
        maxDiscountAmount: '500',
        minRideAmount: '800',
        maxUsageTotal: '100',
        maxUsagePerUser: '1',
        expiresAt: ''
      });
      fetchPromos();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao criar cupom.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api.patch(`/admin/promos/${id}/toggle`);
      fetchPromos();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao alterar cupom.');
    }
  };

  const handleDelete = async (promo: PromoItem) => {
    if (!window.confirm(`Remover ou desativar o cupom ${promo.code}?`)) return;
    try {
      const res = await api.delete(`/admin/promos/${promo.id}`);
      alert(res.data?.message || 'Cupom atualizado.');
      fetchPromos();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao remover cupom.');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1320px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
            Cupons & Campanhas Promocionais
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '4px' }}>
            Crie códigos de desconto para atrair passageiros e impulsionar corridas em Bissau.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={fetchPromos}
            style={{
              padding: '9px 14px', borderRadius: '10px', border: '1px solid #CBD5E1',
              backgroundColor: '#FFFFFF', color: '#0F172A', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar
          </button>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '9px 16px', borderRadius: '10px', border: 'none',
              backgroundColor: '#059669', color: '#FFFFFF', fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <Plus size={16} /> Novo Cupom
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Cupons Cadastrados</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0F172A', marginTop: '4px' }}>{summary.totalPromos}</div>
        </div>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Campanhas Ativas</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#059669', marginTop: '4px' }}>{summary.activePromos}</div>
        </div>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Total de Resgates</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>{summary.totalRedemptions}</div>
        </div>
        <div style={{ backgroundColor: '#0F172A', borderRadius: '12px', padding: '16px', color: '#FFFFFF' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>Subsídio Concedido</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#34D399', marginTop: '4px' }}>
            {formatXof(summary.totalDiscountGrantedXof)}
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#475569' }}>
              <th style={{ padding: '12px 16px' }}>Código</th>
              <th style={{ padding: '12px 16px' }}>Benefício</th>
              <th style={{ padding: '12px 16px' }}>Regras</th>
              <th style={{ padding: '12px 16px' }}>Uso</th>
              <th style={{ padding: '12px 16px' }}>Validade</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>Carregando campanhas...</td></tr>
            ) : promos.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>Nenhum cupom promocional criado ainda. Clique em "Novo Cupom".</td></tr>
            ) : (
              promos.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      backgroundColor: '#ECFDF5', color: '#047857', border: '1px dashed #34D399',
                      padding: '4px 10px', borderRadius: '8px', fontWeight: 800, fontFamily: 'monospace'
                    }}>
                      <Tag size={13} /> {p.code}
                    </span>
                    {p.description && <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '4px' }}>{p.description}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0F172A' }}>
                    {p.discountPercentage
                      ? `${p.discountPercentage}% OFF${p.maxDiscountAmount ? ` (máx. ${formatXof(p.maxDiscountAmount)})` : ''}`
                      : `${formatXof(Number(p.discountFixed || 0))} OFF`}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569', fontSize: '0.82rem' }}>
                    Mínimo corrida: <strong>{formatXof(p.minRideAmount)}</strong><br />
                    Limite por passageiro: <strong>{p.maxUsagePerUser}x</strong>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                    {p.currentUsage} / {p.maxUsageTotal ?? '∞'}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>
                    {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('pt-BR') : 'Sem expiração'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.isActive ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#059669', backgroundColor: '#ECFDF5', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '0.78rem' }}>
                        <CheckCircle size={13} /> Ativo
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#DC2626', backgroundColor: '#FEF2F2', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '0.78rem' }}>
                        <XCircle size={13} /> Pausado
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => handleToggle(p.id)}
                        style={{
                          padding: '6px 10px', borderRadius: '8px', border: '1px solid #CBD5E1',
                          backgroundColor: '#FFFFFF', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem'
                        }}
                      >
                        {p.isActive ? 'Pausar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        style={{
                          padding: '6px 8px', borderRadius: '8px', border: '1px solid #FCA5A5',
                          backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer'
                        }}
                        title="Excluir cupom"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Criar Cupom */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{ backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '24px', maxWidth: '500px', width: '94%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1.15rem', color: '#0F172A' }}>Criar Novo Cupom Promocional</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Código *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: BISSAU20"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Tipo de Desconto</label>
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value as any })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  >
                    <option value="PERCENTAGE">Percentual (%)</option>
                    <option value="FIXED">Valor Fixo (XOF)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Descrição da Campanha</label>
                <input
                  type="text"
                  placeholder="Ex: Desconto de boas-vindas para novas corridas"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>
                    {form.discountType === 'PERCENTAGE' ? 'Percentual (%) *' : 'Valor Desconto (XOF) *'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.discountValue}
                    onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Teto Máx. Desconto (XOF)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Opcional"
                    value={form.maxDiscountAmount}
                    onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Corrida Mín. (XOF)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.minRideAmount}
                    onChange={(e) => setForm({ ...form, minRideAmount: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Limite Total Usos</label>
                  <input
                    type="number"
                    min="1"
                    value={form.maxUsageTotal}
                    onChange={(e) => setForm({ ...form, maxUsageTotal: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Usos / Cliente</label>
                  <input
                    type="number"
                    min="1"
                    value={form.maxUsagePerUser}
                    onChange={(e) => setForm({ ...form, maxUsagePerUser: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Data de Expiração (Opcional)</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#059669', color: '#FFF', fontWeight: 700, cursor: 'pointer' }}>
                  {submitting ? 'Salvando...' : 'Ativar Campanha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
