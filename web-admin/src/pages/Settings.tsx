import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Settings as SettingsIcon, 
  Save, 
  Edit2, 
  X, 
  AlertCircle, 
  Smartphone, 
  Building2,
  CheckCircle2,
  Percent,
  Sliders
} from 'lucide-react';
import './Settings.css';

interface Tariff {
  id: string;
  vehicleType: string;
  baseFare: number;
  perKmFare: number;
  perMinuteFare: number;
  minimumFare: number;
  commissionRate: number;
}

interface SystemConfig {
  adminOrangeNumber: string;
  adminMtnNumber: string;
  defaultCommissionRate: number;
}

export function Settings() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>({ 
    adminOrangeNumber: '', 
    adminMtnNumber: '', 
    defaultCommissionRate: 15 
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Tariff>>({});
  
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [systemForm, setSystemForm] = useState<SystemConfig>({ 
    adminOrangeNumber: '', 
    adminMtnNumber: '', 
    defaultCommissionRate: 15 
  });

  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tariffsRes, configRes] = await Promise.all([
        api.get('/admin/settings/tariffs'),
        api.get('/admin/settings/system')
      ]);
      setTariffs(tariffsRes.data || []);
      setSystemConfig(configRes.data || { adminOrangeNumber: '', adminMtnNumber: '', defaultCommissionRate: 15 });
      setSystemForm(configRes.data || { adminOrangeNumber: '', adminMtnNumber: '', defaultCommissionRate: 15 });
    } catch (error) {
      console.error("Erro ao carregar dados", error);
    } finally {
      setLoading(false);
    }
  };

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const startEditing = (tariff: Tariff) => {
    setEditingId(tariff.id);
    setEditForm(tariff);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveTariff = async (id: string) => {
    try {
      await api.put(`/admin/settings/tariffs/${id}`, editForm);
      setEditingId(null);
      fetchData();
      notify('success', 'Tarifa atualizada com sucesso!');
    } catch (error) {
      notify('error', 'Erro ao salvar a tarifa.');
    }
  };

  const saveSystemConfig = async () => {
    try {
      await api.put('/admin/settings/system', systemForm);
      setSystemConfig(systemForm);
      setIsEditingSystem(false);
      notify('success', 'Contas de recebimento e comissões atualizadas com sucesso!');
    } catch (error) {
      notify('error', 'Erro ao salvar contas da empresa.');
    }
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="spinner"></div>
        <span>Carregando parâmetros do sistema...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      {/* Top Banner Feedbacks */}
      {feedbackMsg && (
        <div className={`feedback-toast ${feedbackMsg.type}`}>
          <CheckCircle2 size={18} />
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Header */}
      <header className="settings-header">
        <div className="header-icon-box">
          <SettingsIcon size={26} />
        </div>
        <div>
          <h1>Configurações e Tarifário</h1>
          <p>Gerencie as contas oficiais de liquidação e o algoritmo de precificação da frota.</p>
        </div>
      </header>

      {/* Bloco 1: Contas de Recebimento da Empresa */}
      <section className="settings-card">
        <div className="card-header">
          <div className="header-title">
            <Building2 size={20} className="icon-primary" />
            <h2>Contas de Recebimento da Empresa</h2>
          </div>

          {!isEditingSystem ? (
            <button onClick={() => setIsEditingSystem(true)} className="btn-secondary">
              <Edit2 size={15} /> Editar Contas
            </button>
          ) : (
            <div className="button-group">
              <button onClick={() => { setIsEditingSystem(false); setSystemForm(systemConfig); }} className="btn-cancel">
                <X size={15} /> Cancelar
              </button>
              <button onClick={saveSystemConfig} className="btn-primary">
                <Save size={15} /> Salvar Alterações
              </button>
            </div>
          )}
        </div>

        <div className="accounts-grid">
          {/* Orange Money Card */}
          <div className="account-box orange-theme">
            <div className="account-badge">
              <Smartphone size={16} />
              <span>Orange Money</span>
            </div>
            <div className="account-body">
              {isEditingSystem ? (
                <input 
                  type="text" 
                  className="input-field"
                  value={systemForm.adminOrangeNumber}
                  onChange={e => setSystemForm({...systemForm, adminOrangeNumber: e.target.value})}
                  placeholder="Ex: 245950000000"
                />
              ) : (
                <span className="account-number">
                  {systemConfig.adminOrangeNumber || 'Não configurado'}
                </span>
              )}
              <p className="account-desc">
                Conta oficial que receberá as taxas e repasses automatizados via Orange Money.
              </p>
            </div>
          </div>

          {/* MTN MoMo Card */}
          <div className="account-box mtn-theme">
            <div className="account-badge">
              <Smartphone size={16} />
              <span>MTN Mobile Money</span>
            </div>
            <div className="account-body">
              {isEditingSystem ? (
                <input 
                  type="text" 
                  className="input-field"
                  value={systemForm.adminMtnNumber}
                  onChange={e => setSystemForm({...systemForm, adminMtnNumber: e.target.value})}
                  placeholder="Ex: 245960000000"
                />
              ) : (
                <span className="account-number">
                  {systemConfig.adminMtnNumber || 'Não configurado'}
                </span>
              )}
              <p className="account-desc">
                Conta oficial que receberá as taxas e repasses automatizados via MTN MoMo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Notice Banner */}
      <div className="info-banner">
        <AlertCircle size={20} />
        <div>
          <strong>Atualização em Tempo Real:</strong> Qualquer alteração no tarifário abaixo é refletida instantaneamente no cálculo das próximas corridas da plataforma.
        </div>
      </div>

      {/* Bloco 2: Tabela de Tarifas */}
      <section className="settings-card">
        <div className="card-header">
          <div className="header-title">
            <Sliders size={20} className="icon-primary" />
            <h2>Tarifário Dinâmico por Categoria</h2>
          </div>
          <span className="status-badge-live">
            <span className="pulse-dot"></span> Motor de Cálculo Ativo
          </span>
        </div>

        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Base (XOF)</th>
                <th>Por KM (XOF)</th>
                <th>Por Min (XOF)</th>
                <th>Mínimo (XOF)</th>
                <th>Comissão (%)</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {tariffs.map((tariff) => {
                const isEditing = editingId === tariff.id;

                return (
                  <tr key={tariff.id} className={isEditing ? "editing-row" : ""}>
                    <td className="font-bold category-cell">
                      <span className="category-pill">{tariff.vehicleType}</span>
                    </td>

                    {isEditing ? (
                      <>
                        <td>
                          <input 
                            type="number" 
                            className="input-table" 
                            value={editForm.baseFare ?? ''} 
                            onChange={e => setEditForm({...editForm, baseFare: Number(e.target.value)})} 
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            className="input-table" 
                            value={editForm.perKmFare ?? ''} 
                            onChange={e => setEditForm({...editForm, perKmFare: Number(e.target.value)})} 
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            className="input-table" 
                            value={editForm.perMinuteFare ?? ''} 
                            onChange={e => setEditForm({...editForm, perMinuteFare: Number(e.target.value)})} 
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            className="input-table" 
                            value={editForm.minimumFare ?? ''} 
                            onChange={e => setEditForm({...editForm, minimumFare: Number(e.target.value)})} 
                          />
                        </td>
                        <td>
                          <div className="input-with-icon">
                            <input 
                              type="number" 
                              className="input-table" 
                              value={editForm.commissionRate ?? ''} 
                              onChange={e => setEditForm({...editForm, commissionRate: Number(e.target.value)})} 
                            />
                            <Percent size={12} />
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="table-actions-edit">
                            <button onClick={() => saveTariff(tariff.id)} className="btn-icon-save" title="Salvar">
                              <Save size={16} />
                            </button>
                            <button onClick={cancelEditing} className="btn-icon-cancel" title="Cancelar">
                              <X size={16} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{tariff.baseFare?.toLocaleString()} FCFA</td>
                        <td>{tariff.perKmFare?.toLocaleString()} FCFA</td>
                        <td>{tariff.perMinuteFare?.toLocaleString()} FCFA</td>
                        <td>{tariff.minimumFare?.toLocaleString()} FCFA</td>
                        <td>
                          <span className="commission-tag">{tariff.commissionRate}%</span>
                        </td>
                        <td className="text-right">
                          <button onClick={() => startEditing(tariff)} className="btn-table-edit">
                            <Edit2 size={14} /> Editar
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}