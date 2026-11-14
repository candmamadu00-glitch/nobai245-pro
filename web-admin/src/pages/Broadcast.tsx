import React, { useState } from 'react';
import { api } from '../services/api';
import { Megaphone, Send, Users, Car, Bell, CheckCircle2 } from 'lucide-react';

export function Broadcast() {
  const [targetGroup, setTargetGroup] = useState('ALL_DRIVERS');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const presets = [
    {
      label: 'Bônus Fim de Semana (Motoristas)',
      target: 'ALL_DRIVERS',
      title: 'Bônus Especial Nô Bai 245!',
      body: 'Complete 10 corridas hoje em Bissau e ganhe bônus direto na sua carteira. Fique online!'
    },
    {
      label: 'Aviso de Saldo Baixo (Motoristas)',
      target: 'LOW_BALANCE_DRIVERS',
      title: 'Recarregue sua carteira Nô Bai 245',
      body: 'Seu saldo de comissão está baixo. Recarregue via Orange Money ou Telecel para continuar recebendo corridas.'
    },
    {
      label: 'Promoção para Passageiros',
      target: 'ALL_PASSENGERS',
      title: 'Viaje rápido e seguro em Bissau!',
      body: 'Táxis e motos disponíveis agora perto de você no Nô Bai 245. Peça sua corrida em segundos.'
    }
  ];

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    if (!window.confirm('Confirmar envio imediato desta notificação para o grupo selecionado?')) return;

    try {
      setSending(true);
      setLastResult(null);
      const res = await api.post('/admin/broadcast/push', {
        targetGroup,
        title: title.trim(),
        body: body.trim()
      });
      setLastResult(res.data?.message || 'Comunicado disparado com sucesso!');
      setTitle('');
      setBody('');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Falha ao enviar comunicado.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0F172A', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Megaphone size={24} color="#059669" /> Central de Comunicados & Push
        </h1>
        <p style={{ color: '#64748B', fontSize: '0.9rem', marginTop: '4px' }}>
          Envie alertas operacionais, campanhas de incentivo e avisos importantes diretamente para os aplicativos.
        </p>
      </div>

      {lastResult && (
        <div style={{
          backgroundColor: '#ECFDF5', border: '1px solid #6EE7B7', color: '#047857',
          padding: '14px 16px', borderRadius: '12px', marginBottom: '18px',
          display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600
        }}>
          <CheckCircle2 size={20} /> {lastResult}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px', alignItems: 'start' }}>
        <form
          onSubmit={handleSend}
          style={{
            backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px',
            padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px'
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              Público-Alvo
            </label>
            <select
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontWeight: 600 }}
            >
              <option value="ALL_DRIVERS">Todos os Motoristas Aprovados</option>
              <option value="ONLINE_DRIVERS">Apenas Motoristas Online Agora</option>
              <option value="LOW_BALANCE_DRIVERS">Motoristas com Saldo Baixo (≤ 500 XOF)</option>
              <option value="ALL_PASSENGERS">Todos os Passageiros Ativos</option>
              <option value="ALL_USERS">Toda a Base (Motoristas + Passageiros)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              Título da Notificação
            </label>
            <input
              type="text"
              required
              maxLength={80}
              placeholder="Ex: Alta demanda no Centro de Bissau!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #CBD5E1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              Mensagem
            </label>
            <textarea
              required
              rows={4}
              maxLength={240}
              placeholder="Escreva a mensagem clara e objetiva que aparecerá na tela do celular..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #CBD5E1', resize: 'vertical' }}
            />
            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#94A3B8', marginTop: '3px' }}>
              {body.length}/240 caracteres
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            style={{
              padding: '12px 18px', borderRadius: '10px', border: 'none',
              backgroundColor: '#059669', color: '#FFFFFF', fontWeight: 700,
              fontSize: '0.95rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <Send size={16} /> {sending ? 'Enviando Notificações...' : 'Disparar Comunicado Agora'}
          </button>
        </form>

        {/* Modelos Rápidos */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Bell size={17} color="#2563EB" /> Modelos Prontos
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {presets.map((p, idx) => (
              <div
                key={idx}
                onClick={() => {
                  setTargetGroup(p.target);
                  setTitle(p.title);
                  setBody(p.body);
                }}
                style={{
                  padding: '12px', borderRadius: '10px', border: '1px solid #E2E8F0',
                  backgroundColor: '#F8FAFC', cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0F172A' }}>{p.label}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '4px' }}>{p.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
