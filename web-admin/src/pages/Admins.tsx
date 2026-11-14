import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { 
  UserPlus, 
  ShieldCheck, 
  Shield, 
  User, 
  Mail, 
  CheckCircle, 
  XCircle, 
  Lock,
  Plus,
  RefreshCw,
  KeyRound,
  History
} from 'lucide-react';
import './Admins.css';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE';
  isActive: boolean;
  createdAt: string;
}

export function Admins() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE'>('OPERATOR');
  const [errorMessage, setErrorMessage] = useState('');

  const [activeTab, setActiveTab] = useState<'team' | 'audit'>('team');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchAuditLogs = async () => {
    try {
      setAuditLoading(true);
      const res = await api.get('/admin/audit-logs');
      setAuditLogs(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      console.error('Erro ao carregar trilha de auditoria:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLogs();
  }, [activeTab]);

  const handleChangeRole = async (user: AdminUser, newRole: string) => {
    if (newRole === user.role) return;
    if (!window.confirm(`Alterar permissão de ${user.name} para ${newRole}?`)) return;
    try {
      await api.patch(`/admin/users/${user.id}/role`, { role: newRole });
      fetchAdmins();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao alterar função.');
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    const newPassword = window.prompt(`Digite a nova senha para ${user.name} (mínimo 6 caracteres):`);
    if (!newPassword) return;
    try {
      const res = await api.patch(`/admin/users/${user.id}/reset-password`, { newPassword });
      alert(res.data?.message || 'Senha redefinida com sucesso!');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao redefinir senha.');
    }
  };

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/users');
      setAdmins(response.data);
    } catch (error) {
      console.error('Erro ao carregar lista de administradores:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!name || !email || !password || !role) {
      setErrorMessage('Por favor, preencha todos os campos.');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/admin/users', { name, email, password, role });
      setShowModal(false);
      setName('');
      setEmail('');
      setPassword('');
      setRole('OPERATOR');
      fetchAdmins();
    } catch (error: any) {
      setErrorMessage(error.response?.data?.error || 'Erro ao criar novo administrador.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (adminId: string, currentStatus: boolean) => {
    try {
      await api.patch(`/admin/users/${adminId}/status`, { isActive: !currentStatus });
      setAdmins(prev => 
        prev.map(a => a.id === adminId ? { ...a, isActive: !currentStatus } : a)
      );
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erro ao alterar status do usuário.');
    }
  };

  const getRoleBadge = (userRole: string) => {
    switch (userRole) {
      case 'SUPER_ADMIN':
        return <span className="role-badge super"><ShieldCheck size={14} /> Super Admin</span>;
      case 'FINANCE':
        return <span className="role-badge finance"><Shield size={14} /> Financeiro</span>;
      default:
        return <span className="role-badge operator"><User size={14} /> Operador</span>;
    }
  };

  return (
    <div className="admins-page">
      <div className="page-header">
        <div>
          <h2>Gestão da Equipe</h2>
          <p>Gerencie os privilégios de acesso e adicione novos operadores ao sistema.</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={fetchAdmins} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Atualizar
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} />
            Novo Membro
          </button>
        </div>
      </div>

      {/* Abas: Equipe vs Trilha de Auditoria */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <button
          onClick={() => setActiveTab('team')}
          style={{
            padding: '9px 16px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
            border: activeTab === 'team' ? '2px solid #059669' : '1px solid #CBD5E1',
            backgroundColor: activeTab === 'team' ? '#ECFDF5' : '#FFFFFF',
            color: activeTab === 'team' ? '#047857' : '#475569'
          }}
        >
          Membros da Equipe ({admins.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '9px 16px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            border: activeTab === 'audit' ? '2px solid #0F172A' : '1px solid #CBD5E1',
            backgroundColor: activeTab === 'audit' ? '#0F172A' : '#FFFFFF',
            color: activeTab === 'audit' ? '#FFFFFF' : '#475569'
          }}
        >
          <History size={16} /> Trilha de Auditoria (Quem fez o quê)
        </button>
      </div>

      {activeTab === 'audit' ? (
        <div className="table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data / Hora</th>
                <th>Colaborador</th>
                <th>Ação Executada</th>
                <th>Módulo / Alvo</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px' }}>Carregando histórico de auditoria...</td></tr>
              ) : auditLogs.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Nenhuma ação registrada ainda. Todas as próximas operações aparecerão aqui.</td></tr>
              ) : (
                auditLogs.map((log: any) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '0.82rem', color: '#475569' }}>
                      {new Date(log.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td>
                      <strong>{log.admin?.name || 'Admin'}</strong>
                      <div style={{ fontSize: '0.75rem', color: '#64748B' }}>{log.admin?.role}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#0F172A' }}>
                      {log.action}
                    </td>
                    <td>
                      <span style={{ backgroundColor: '#F1F5F9', padding: '2px 8px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>
                        {log.targetType}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748B' }}>{log.ipAddress || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <div className="loading-container">Carregando membros da equipe...</div>
      ) : (
        <div className="table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Função / Permissão</th>
                <th>Status</th>
                <th>Data de Cadastro</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((user) => (
                <tr key={user.id}>
                  <td className="user-name-cell">
                    <div className="avatar-small">{user.name.charAt(0).toUpperCase()}</div>
                    <span>{user.name}</span>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(e) => handleChangeRole(user, e.target.value)}
                      style={{
                        padding: '5px 8px', borderRadius: '8px', border: '1px solid #CBD5E1',
                        fontWeight: 700, fontSize: '0.8rem', backgroundColor: '#F8FAFC'
                      }}
                    >
                      <option value="OPERATOR">Operador</option>
                      <option value="FINANCE">Financeiro</option>
                      <option value="SUPER_ADMIN">Super Admin</option>
                    </select>
                  </td>
                  <td>
                    {user.isActive ? (
                      <span className="status-tag active"><CheckCircle size={14} /> Ativo</span>
                    ) : (
                      <span className="status-tag inactive"><XCircle size={14} /> Inativo</span>
                    )}
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => handleResetPassword(user)}
                        title="Redefinir Senha"
                        style={{
                          padding: '6px 10px', borderRadius: '8px', border: '1px solid #CBD5E1',
                          backgroundColor: '#FFFFFF', color: '#0F172A', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}
                      >
                        <KeyRound size={13} /> Senha
                      </button>
                      <button 
                        className={`btn-status ${user.isActive ? 'disable' : 'enable'}`}
                        onClick={() => handleToggleStatus(user.id, user.isActive)}
                      >
                        {user.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Cadastro de Novo Admin */}
      {showModal && (
        <div className="modal-backdrop">
          <div className="modal-container">
            <div className="modal-header">
              <h3><UserPlus size={20} /> Adicionar Novo Membro</h3>
              <button className="btn-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateAdmin}>
              <div className="modal-body">
                {errorMessage && <div className="modal-error">{errorMessage}</div>}

                <div className="form-group">
                  <label>Nome Completo</label>
                  <div className="input-icon-box">
                    <User size={18} />
                    <input 
                      type="text" 
                      placeholder="Ex: João Silva" 
                      value={name} 
                      onChange={e => setName(e.target.value)} 
                      required 
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>E-mail de Acesso</label>
                  <div className="input-icon-box">
                    <Mail size={18} />
                    <input 
                      type="email" 
                      placeholder="joao@bai245.com" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)} 
                      required 
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Senha Provisória</label>
                  <div className="input-icon-box">
                    <Lock size={18} />
                    <input 
                      type="password" 
                      placeholder="••••••••" 
                      value={password} 
                      onChange={e => setPassword(e.target.value)} 
                      required 
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Função (Nível de Acesso)</label>
                  <select 
                    value={role} 
                    onChange={e => setRole(e.target.value as any)}
                    className="role-select"
                  >
                    <option value="OPERATOR">Operador (Atendimento, Motoristas e SOS)</option>
                    <option value="FINANCE">Financeiro (Balanço, Extratos e Relatórios)</option>
                    <option value="SUPER_ADMIN">Super Admin (Acesso Total e Configurações)</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Salvando...' : 'Cadastrar Membro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}