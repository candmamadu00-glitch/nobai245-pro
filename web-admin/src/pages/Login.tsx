import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Sparkles,
  Activity,
  Navigation,
} from 'lucide-react';
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
  const [infoBanner, setInfoBanner] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });

  const { signIn, admin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (admin) {
      navigate('/', { replace: true });
      return;
    }

    const reason = searchParams.get('reason');
    if (reason === 'inactivity') {
      setInfoBanner('Sessão encerrada automaticamente após 15 minutos de inatividade por segurança.');
    } else if (reason === 'expired') {
      setInfoBanner('Sua credencial de acesso expirou. Autentique-se novamente para continuar.');
    }
  }, [admin, navigate, searchParams]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rotateX: Number((-y * 9).toFixed(2)),
      rotateY: Number((x * 11).toFixed(2)),
    });
  };

  const handleMouseLeave = () => {
    setTilt({ rotateX: 0, rotateY: 0 });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    setError('');
    setInfoBanner('');
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
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const apiError = (err as ApiError)?.response?.data?.error;
      setError(apiError || 'Erro ao conectar com o servidor. Verifique suas credenciais.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="login-3d-viewport"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* CAMADAS DE AMBIENTE 3D & ILUMINACAO VOLUMETRICA */}
      <div className="login-3d-bg-grid" />
      <div className="login-3d-orb orb-emerald" />
      <div className="login-3d-orb orb-gold" />
      <div className="login-3d-orb orb-cyan" />

      {/* ANEIS ORBITAIS 3D FLUTUANTES */}
      <div className="login-3d-orbital-ring ring-one" />
      <div className="login-3d-orbital-ring ring-two" />

      {/* CHIPS 3D FLUTUANTES DE TELEMETRIA */}
      <div className="floating-3d-chip chip-top-left">
        <Activity size={15} />
        <span>Telemetria ao Vivo • Bissau</span>
      </div>
      <div className="floating-3d-chip chip-bottom-right">
        <Navigation size={15} />
        <span>Core Mobilidade 245 • TLS 1.3</span>
      </div>

      {/* CARTAO PRINCIPAL COM PERSPECTIVA 3D INTERATIVA */}
      <div
        className="login-3d-stage"
        style={{
          transform: `perspective(1200px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
        }}
      >
        <div className="login-card-3d">
          <div className="login-header">
            <div className="login-3d-logo-cube">
              <img
                src="/logo-pwa.png"
                alt="Nô Bai 245"
                className="login-3d-logo-img"
              />
            </div>

            <div className="login-3d-badge">
              <Sparkles size={12} />
              <span>CENTRO DE COMANDO EXECUTIVO</span>
            </div>

            <h1 className="login-title">NÔ BAI 245 Admin</h1>
            <p className="login-subtitle">
              Gestão inteligente de frotas, finanças e segurança em tempo real
            </p>
          </div>

          {infoBanner && (
            <div role="status" className="login-info-banner">
              <ShieldCheck size={18} className="shrink-0" />
              <span>{infoBanner}</span>
            </div>
          )}

          {error && (
            <div className="error-message" role="alert">
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
                <Mail className="input-icon" size={19} />
                <input
                  id="email-input"
                  type="email"
                  className="form-input"
                  placeholder="admin@nobai245.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="email"
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
                <Lock className="input-icon" size={19} />
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input password-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={0}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  disabled={isSubmitting}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-submit-3d" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="spinner" size={20} />
                  <span>Autenticando no Core...</span>
                </>
              ) : (
                <span>Entrar no Sistema</span>
              )}
            </button>
          </form>

          <div className="login-3d-footer">
            <span>🇬🇼 Guiné-Bissau • Plataforma Oficial Nô Bai 245</span>
          </div>
        </div>
      </div>
    </div>
  );
}
