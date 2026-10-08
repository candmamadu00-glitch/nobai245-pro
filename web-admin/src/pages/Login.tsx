import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import './Login.css';

interface ApiError {
  response?: {
    data?: {
      error?: string;
    };
  };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    setError('');

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('Por favor, insira um e-mail corporativo válido.');
      return;
    }

    try {
      setIsSubmitting(true);
      await signIn(cleanEmail, password);
      
      // Substitui a rota no histórico para impedir o retorno ao login pelo botão 'Voltar'
      navigate('/', { replace: true }); 
    } catch (err: unknown) {
      const apiError = (err as ApiError)?.response?.data?.error;
      setError(apiError || 'Erro ao conectar com o servidor. Verifique suas credenciais.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <ShieldCheck size={32} aria-hidden="true" />
          </div>
          <h1 className="login-title">BAI 245 Admin</h1>
          <p className="login-subtitle">Acesso restrito ao sistema de controle</p>
        </div>

        {error && (
          <div className="error-message" role="alert" aria-live="polite" id="login-error">
            <AlertCircle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email-input" className="form-label">
              E-mail Corporativo
            </label>
            <div className="input-wrapper">
              <Mail className="input-icon" size={20} aria-hidden="true" />
              <input
                id="email-input"
                type="email"
                className="form-input"
                placeholder="admin@nobai245.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                autoComplete="email"
                aria-describedby={error ? 'login-error' : undefined}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password-input" className="form-label">
              Senha de Acesso
            </label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={20} aria-hidden="true" />
              <input
                id="password-input"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                autoComplete="current-password"
                aria-describedby={error ? 'login-error' : undefined}
                required
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                disabled={isSubmitting}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="spinner" size={20} aria-hidden="true" />
                <span>Autenticando...</span>
              </>
            ) : (
              <span>Entrar no Sistema</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}