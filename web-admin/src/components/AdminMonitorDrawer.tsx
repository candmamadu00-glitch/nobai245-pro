import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { Loader2 } from 'lucide-react';
import type {
  MonitoredChatMessage,
  MonitoredCallLog,
  SharedTripAlert,
} from '../hooks/useAdminSocket';

interface AdminMonitorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRideId: string | null;
  chats: MonitoredChatMessage[];
  calls: MonitoredCallLog[];
  sharedTrips: SharedTripAlert[];
}

export const AdminMonitorDrawer: React.FC<AdminMonitorDrawerProps> = ({
  isOpen,
  onClose,
  selectedRideId,
  chats,
  calls,
  sharedTrips,
}) => {
  const [historicalChats, setHistoricalChats] = useState<MonitoredChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // 1. Busca o histórico de mensagens salvas no Banco de Dados ao abrir a gaveta
  useEffect(() => {
    if (isOpen && selectedRideId) {
      setIsLoading(true);
      // Nota: Certifique-se de que a rota abaixo confere com o seu backend (ex: /admin/rides/:id/chat)
      api.get(`/admin/rides/${selectedRideId}/chat`)
        .then(response => {
          const formattedHistory = response.data.map((msg: any) => ({
            id: msg.id,
            rideId: msg.rideId || selectedRideId,
            senderId: msg.senderId,
            senderType: msg.senderType,
            message: msg.message,
            createdAt: msg.createdAt,
          }));
          setHistoricalChats(formattedHistory);
        })
        .catch(error => console.error("Erro ao carregar auditoria do chat:", error))
        .finally(() => setIsLoading(false));
    } else {
      setHistoricalChats([]); // Limpa o estado ao fechar
    }
  }, [isOpen, selectedRideId]);

  // 2. Mescla o histórico da API com as mensagens novas do Socket (evitando duplicações)
  const combinedChats = React.useMemo(() => {
    const liveRideChats = chats.filter((c) => c.rideId === selectedRideId);
    const allChats = [...historicalChats, ...liveRideChats];
    
    // Remove mensagens duplicadas (caso o socket tenha disparado junto com o fetch da API)
    const uniqueChats = Array.from(new Map(allChats.map(item => [item.id, item])).values());
    
    // Ordena por data (mais antigas em cima, mais novas embaixo)
    return uniqueChats.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [historicalChats, chats, selectedRideId]);

  // 3. Auto-scroll para a última mensagem do chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [combinedChats]);

  if (!isOpen || !selectedRideId) return null;

  const rideCalls = calls.filter((c) => c.rideId === selectedRideId);
  const isTripShared = sharedTrips.some((s) => s.rideId === selectedRideId);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl z-50 p-6 flex flex-col border-l border-gray-200">
      <div className="flex justify-between items-center pb-4 border-b">
        <h3 className="text-lg font-bold text-gray-800">
          Auditoria da Corrida
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-800 transition-colors font-bold text-xl"
        >
          ✕
        </button>
      </div>

      <div className="text-xs text-gray-500 my-3 bg-gray-50 p-2 rounded border border-gray-100">
        ID: <span className="font-mono text-gray-700">{selectedRideId}</span>
      </div>

      {isTripShared && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-3 mb-4 rounded text-xs text-blue-700 font-medium">
          ⚠️ Corrida compartilhada publicamente pelo passageiro.
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar" ref={chatScrollRef}>
        {/* Histórico/Log de Ligações */}
        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            📞 Log de Ligações <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">{rideCalls.length}</span>
          </h4>
          {rideCalls.length === 0 ? (
            <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded text-center">
              Nenhuma ligação registrada.
            </p>
          ) : (
            <div className="space-y-2">
              {rideCalls.map((call) => (
                <div
                  key={call.id}
                  className="bg-gray-50 p-2.5 rounded border border-gray-200 text-xs flex justify-between items-center"
                >
                  <span className="text-gray-700">
                    <strong className="text-gray-900">{call.callerType === 'DRIVER' ? 'Motorista' : 'Passageiro'}</strong> iniciou chamada
                  </span>
                  <span className="text-gray-400 font-mono">
                    {new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat Espelhado */}
        <div className="pb-4">
          <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            💬 Histórico do Chat <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">{combinedChats.length}</span>
          </h4>
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-6 text-gray-400">
              <Loader2 className="animate-spin mb-2" size={24} />
              <span className="text-xs">Carregando auditoria...</span>
            </div>
          ) : combinedChats.length === 0 ? (
            <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded text-center">
              Nenhuma mensagem trocada nesta corrida.
            </p>
          ) : (
            <div className="space-y-3">
              {combinedChats.map((msg) => {
                const isDriver = msg.senderType === 'DRIVER';
                return (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg text-xs max-w-[85%] shadow-sm ${
                      isDriver
                        ? 'bg-[#FEF3C7] ml-auto border border-[#FDE68A] text-gray-800'
                        : 'bg-white mr-auto border border-gray-200 text-gray-800'
                    }`}
                  >
                    <div className="font-bold mb-1.5 text-[10px] text-gray-500 uppercase tracking-wider flex justify-between items-center">
                      <span>{isDriver ? '🚗 Motorista' : '👤 Passageiro'}</span>
                    </div>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                    <div className="text-[9px] text-gray-400 text-right mt-1.5">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};