import React, { useEffect, useState } from 'react';
import './Tickets.css';
import { api } from '../services/api';

interface TicketMessage {
  id: string;
  sender: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  message: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  status: string;
  priority?: string;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  passenger?: { id: string; fullName: string; phone: string };
  driver?: { id: string; fullName: string; phone: string };
  messages?: TicketMessage[];
}

export function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [newStatus, setNewStatus] = useState('');

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/tickets');
      const data = response.data?.data || response.data || [];
      const list = Array.isArray(data) ? data : [];
      setTickets(list);

      if (selectedTicket) {
        const refreshed = list.find((t: Ticket) => t.id === selectedTicket.id);
        if (refreshed) setSelectedTicket(refreshed);
      }
    } catch (error) {
      console.error('Erro ao buscar chamados:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyMessage.trim()) return;

    try {
      await api.post(`/admin/tickets/${selectedTicket.id}/reply`, {
        message: replyMessage,
        newStatus: newStatus || selectedTicket.status,
      });

      setReplyMessage('');
      fetchTickets();
    } catch (error: any) {
      console.error('Erro ao responder chamado:', error);
      // Agora o alerta vai mostrar a mensagem exata de erro que o backend enviou!
      const errorMsg = error.response?.data?.error || 'Erro ao enviar resposta ao chamado.';
      alert(errorMsg);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <h2>Central de Chamados e Suporte</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Gerencie solicitações de passageiros e motoristas em tempo real.
      </p>

      {loading && tickets.length === 0 ? (
        <div>Carregando chamados...</div>
      ) : tickets.length === 0 ? (
        <div style={{ background: '#fff', padding: '32px', borderRadius: '8px', textAlign: 'center' }}>
          Nenhum chamado encontrado.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '1fr 1fr' : '1fr', gap: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ padding: '12px 16px' }}>Usuário</th>
                  <th style={{ padding: '12px 16px' }}>Tipo</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => {
                  const user = ticket.driver || ticket.passenger;
                  const isDriver = !!ticket.driver;

                  return (
                    <tr key={ticket.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{user?.fullName || 'Usuário'}</strong>
                        <br />
                        <small style={{ color: '#6B7280' }}>{user?.phone}</small>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          background: isDriver ? '#DBEAFE' : '#F3E8FF',
                          color: isDriver ? '#1E40AF' : '#6B21A8'
                        }}>
                          {isDriver ? 'MOTORISTA' : 'PASSAGEIRO'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          background: ticket.status === 'RESOLVED' ? '#DEF7EC' : '#FEF08A',
                          color: ticket.status === 'RESOLVED' ? '#03543F' : '#713F12'
                        }}>
                          {ticket.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setNewStatus(ticket.status);
                          }}
                          style={{
                            padding: '6px 12px',
                            background: '#059669',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Atender
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedTicket && (
            <div style={{ background: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
              <h3>Atender Chamado #{selectedTicket.id.slice(0, 8)}</h3>
              <p style={{ margin: '4px 0' }}>
                <strong>Solicitante:</strong> {selectedTicket.driver?.fullName || selectedTicket.passenger?.fullName}
              </p>
              <p style={{ margin: '4px 0', fontSize: '13px', color: '#4B5563' }}>
                <strong>Categoria:</strong> {selectedTicket.category || 'Geral'}
              </p>

              <div style={{ margin: '12px 0', padding: '12px', background: '#EFF6FF', borderRadius: '6px', borderLeft: '4px solid #3B82F6' }}>
                <strong style={{ display: 'block', fontSize: '12px', color: '#1E40AF', marginBottom: '4px' }}>
                  Descrição Inicial:
                </strong>
                <p style={{ margin: 0, fontSize: '14px', color: '#1E3A8A' }}>
                  {selectedTicket.description || 'Sem descrição.'}
                </p>
              </div>

              <div style={{ margin: '16px 0', padding: '12px', background: '#F9FAFB', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                <h4 style={{ marginTop: 0, marginBottom: '8px' }}>Histórico:</h4>
                {selectedTicket.messages && selectedTicket.messages.length > 0 ? (
                  selectedTicket.messages.map((msg) => (
                    <div key={msg.id} style={{ marginBottom: '8px', fontSize: '14px' }}>
                      <strong>{msg.sender}:</strong> {msg.message}
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>Sem mensagens registradas.</p>
                )}
              </div>

              <form onSubmit={handleReply}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>Status:</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #D1D5DB' }}
                  >
                    <option value="OPEN">Aberto</option>
                    <option value="IN_PROGRESS">Em Andamento</option>
                    <option value="RESOLVED">Resolvido</option>
                    <option value="CLOSED">Fechado</option>
                  </select>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px' }}>Resposta:</label>
                  <textarea
                    rows={4}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Escreva a resposta..."
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #D1D5DB' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedTicket(null)}
                    style={{ padding: '8px 16px', background: '#E5E7EB', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '8px 16px', background: '#059669', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Enviar
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}