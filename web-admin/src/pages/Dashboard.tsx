import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { 
  TrendingUp, Activity, Users, Car, AlertTriangle, 
  CheckCircle, XCircle, RefreshCw, Clock, AlertCircle
} from 'lucide-react';
import './Dashboard.css'; 

interface DashboardMetrics {
  lucroHoje: number;
  corridasHoje: number;
  corridasCompletas: number;
  corridasCanceladas: number;
  motoristasOnline: number;
  passageirosAtivos: number;
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchMetrics = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    setError(false);

    try {
      const response = await api.get<DashboardMetrics>('/admin/dashboard/metrics');
      setMetrics(response.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[DASHBOARD] Erro ao carregar métricas:', err);
      setError(true);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(() => fetchMetrics(false), 60000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pt-GW', { 
      style: 'currency', 
      currency: 'XOF', 
      maximumFractionDigits: 0 
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="skeleton-title"></div>
        <div className="skeleton-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-card"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container animate-fade-in">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Centro de Comando</h1>
          <p className="dashboard-subtitle">
            <Clock size={14} /> Última sincronização: {lastUpdated.toLocaleTimeString('pt-BR')}
          </p>
        </div>
        
        <div className="dashboard-actions">
          <div className={`status-badge ${error ? 'status-error' : ''}`}>
            {error ? (
              <>
                <AlertCircle size={14} />
                Instabilidade na API
              </>
            ) : (
              <>
                <Activity size={14} className="animate-pulse" /> 
                Sistema Operacional
              </>
            )}
          </div>
          <button 
            onClick={() => fetchMetrics(true)}
            disabled={isRefreshing}
            className="btn-refresh"
          >
            <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="dashboard-error-banner">
          <AlertTriangle size={18} />
          <span>Não foi possível atualizar algumas métricas em tempo real. Verifique a conexão com o servidor.</span>
        </div>
      )}

      <div className="metrics-grid">
        {/* Card Financeiro */}
        <div className="metric-card card-dark">
          <div className="card-header">
            <h3>Lucro (Hoje)</h3>
            <div className="icon-wrapper icon-emerald">
              <TrendingUp size={20} />
            </div>
          </div>
          <span className="card-value">{formatCurrency(metrics?.lucroHoje || 0)}</span>
          <span className="card-footer">Tarifas da Plataforma</span>
        </div>

        {/* Card Corridas */}
        <div className="metric-card">
          <div className="card-header">
            <h3>Corridas (Hoje)</h3>
            <div className="icon-wrapper icon-blue">
              <Car size={20} />
            </div>
          </div>
          <span className="card-value text-dark">{metrics?.corridasHoje || 0}</span>
          <div className="card-stats">
            <span className="stat-ok"><CheckCircle size={14} /> {metrics?.corridasCompletas || 0} Ok</span>
            <span className="stat-error"><XCircle size={14} /> {metrics?.corridasCanceladas || 0} Canc.</span>
          </div>
        </div>

        {/* Card Motoristas */}
        <div className="metric-card">
          <div className="card-header">
            <h3>Motoristas Online</h3>
            <div className="icon-wrapper icon-amber">
              <Users size={20} />
            </div>
          </div>
          <span className="card-value text-dark">{metrics?.motoristasOnline || 0}</span>
          <span className="card-badge">Passageiros Ativos: {metrics?.passageirosAtivos || 0}</span>
        </div>

        {/* Card Alertas */}
        <div className="metric-card">
          <div className="card-header">
            <h3>Ações Pendentes</h3>
            <div className="icon-wrapper icon-red">
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="alert-list">
            <div className="alert-item">
              <span>Aprovar Motoristas</span>
              <span className="alert-badge bg-gray">0</span>
            </div>
            <div className="alert-item">
              <span>Tickets de Suporte</span>
              <span className="alert-badge bg-gray">0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}