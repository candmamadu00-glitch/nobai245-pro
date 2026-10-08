import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import './Ratings.css';

// Tipagem corrigida batendo exatamente com o Prisma
interface RatingItem {
  id: string;
  stars: number;
  reviewerType: 'PASSENGER' | 'DRIVER';
  comment: string | null;
  tags: string[];
  isApproved: boolean;
  createdAt: string;
  ride: {
    id: string;
    passenger?: { fullName: string; phone: string };
    driver?: { fullName: string; phone: string };
  };
}

export const RatingsPage: React.FC = () => {
  const [ratings, setRatings] = useState<RatingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const fetchRatings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.append('reviewerType', filterType);
      if (search) params.append('search', search);

      const response = await api.get(`/admin/ratings?${params.toString()}`);
      setRatings(response.data.data);
    } catch (err) {
      console.error('Erro ao buscar avaliações:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    if (!window.confirm(`Deseja realmente ${currentStatus ? 'ocultar' : 'aprovar'} esta avaliação?`)) return;
    
    try {
      await api.patch(`/admin/ratings/${id}/moderation`, { isApproved: !currentStatus });
      fetchRatings();
    } catch (err) {
      alert('Erro ao alterar status da avaliação.');
    }
  };

  useEffect(() => { 
    fetchRatings(); 
  }, [filterType]);

  const renderStars = (stars: number) => {
    return '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  };

  return (
    <div className="admin-page-container">
      <div className="page-header">
        <div>
          <h2>Auditoria de Reputação</h2>
          <p>Monitore o comportamento de motoristas e passageiros.</p>
        </div>
        
        <div className="filters-container">
          <input 
            type="text" 
            placeholder="Buscar por nome ou comentário..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchRatings()}
            className="search-input"
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="filter-select">
            <option value="">Todos os perfis</option>
            <option value="PASSENGER">Passageiros avaliando</option>
            <option value="DRIVER">Motoristas avaliando</option>
          </select>
          <button onClick={fetchRatings} className="btn-primary">Filtrar</button>
        </div>
      </div>

      <div className="table-card">
        {loading ? (
          <div className="loading-state">Carregando dados...</div>
        ) : ratings.length === 0 ? (
          <div className="empty-state">Nenhuma avaliação encontrada.</div>
        ) : (
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Avaliador</th>
                <th>Avaliado</th>
                <th>Nota</th>
                <th>Feedback</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {ratings.map((item) => {
                const isPassengerReviewing = item.reviewerType === 'PASSENGER';
                const evaluator = isPassengerReviewing ? item.ride?.passenger?.fullName : item.ride?.driver?.fullName;
                const evaluated = isPassengerReviewing ? item.ride?.driver?.fullName : item.ride?.passenger?.fullName;
                const roleBadge = isPassengerReviewing ? 'badge-passenger' : 'badge-driver';

                return (
                  <tr key={item.id} className={!item.isApproved ? 'row-hidden' : ''}>
                    <td className="text-muted">{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="user-info">
                        <strong>{evaluator || 'Desconhecido'}</strong>
                        <span className={`badge ${roleBadge}`}>
                          {isPassengerReviewing ? 'Passageiro' : 'Motorista'}
                        </span>
                      </div>
                    </td>
                    <td>{evaluated || 'Desconhecido'}</td>
                    <td className="stars-cell" title={`${item.stars} estrelas`}>
                      {renderStars(item.stars)}
                    </td>
                    <td className="feedback-cell">
                      {item.tags.length > 0 && <div className="tags">{item.tags.join(' • ')}</div>}
                      <div className="comment">{item.comment || <em className="text-muted">Sem comentário</em>}</div>
                    </td>
                    <td>
                      <span className={`status-badge ${item.isApproved ? 'status-active' : 'status-inactive'}`}>
                        {item.isApproved ? 'Visível' : 'Ocultado'}
                      </span>
                    </td>
                    <td>
                      <button 
                        className={`btn-action ${item.isApproved ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => toggleStatus(item.id, item.isApproved)}
                      >
                        {item.isApproved ? 'Ocultar' : 'Aprovar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};