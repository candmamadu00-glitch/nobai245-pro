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
  RefreshCw
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

      {loading ? (
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
                  <td>{getRoleBadge(user.role)}</td>
                  <td>
                    {user.isActive ? (
                      <span className="status-tag active"><CheckCircle size={14} /> Ativo</span>
                    ) : (
                      <span className="status-tag inactive"><XCircle size={14} /> Inativo</span>
                    )}
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button 
                      className={`btn-status ${user.isActive ? 'disable' : 'enable'}`}
                      onClick={() => handleToggleStatus(user.id, user.isActive)}
                    >
                      {user.isActive ? 'Desativar' : 'Ativar'}
                    </button>
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