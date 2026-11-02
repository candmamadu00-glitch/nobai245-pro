import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import './Landmarks.css';

interface Landmark {
  id: string;
  name: string;
  popularName?: string | null;
  neighborhood: string;
  referenceNotes?: string | null;
  latitude: number;
  longitude: number;
  isActive: boolean;
  createdAt?: string;
}

export default function Landmarks() {
  // Lista de Pontos e Busca
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingList, setLoadingList] = useState(true);

  // Formulário e Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  const [neighborhoodName, setNeighborhoodName] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [popularName, setPopularName] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  // Estados de Operação
  const [loadingGps, setLoadingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 🔄 Busca lista atualizada da API
  const fetchLandmarks = useCallback(async () => {
    try {
      setLoadingList(true);
      const res = await api.get('/landmarks');
      setLandmarks(res.data);
    } catch (err) {
      console.error('Erro ao carregar lista de pontos:', err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchLandmarks();
  }, [fetchLandmarks]);

  // 📍 GPS do Navegador
  const handleGetBrowserLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada pelo seu navegador.');
      return;
    }

    setLoadingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toString());
        setLongitude(position.coords.longitude.toString());
        setLoadingGps(false);
      },
      (error) => {
        alert('Erro ao obter localização do navegador: ' + error.message);
        setLoadingGps(false);
      },
      { enableHighAccuracy: true }
    );
  };

  // 💾 Salvar ou Atualizar Ponto
  const handleSaveLandmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neighborhoodName.trim() || !placeName.trim() || !latitude || !longitude) {
      alert('Preencha Bairro, Nome do Ponto, Latitude e Longitude.');
      return;
    }

    setSubmitting(true);
    const payload = {
      neighborhoodName: neighborhoodName.trim(),
      name: placeName.trim(),
      popularName: popularName.trim() || null,
      referenceNotes: referenceNotes.trim() || null,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    };

    try {
      if (editingId) {
        // Atualiza Ponto Existente
        await api.put(`/landmarks/${editingId}`, payload);
        alert(`Ponto "${placeName}" atualizado com sucesso! ✏️`);
      } else {
        // Cria Novo Ponto
        await api.post('/landmarks', payload);
        alert(`Sucesso! 📍 "${placeName}" cadastrado em ${neighborhoodName}.`);
      }

      handleResetForm();
      fetchLandmarks();
    } catch (err) {
      console.error('Erro ao salvar no banco:', err);
      alert('Erro ao processar requisição no servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  // ✏️ Preenche o formulário para editar
  const handleEdit = (landmark: Landmark) => {
    setEditingId(landmark.id);
    setNeighborhoodName(landmark.neighborhood);
    setPlaceName(landmark.name);
    setPopularName(landmark.popularName || '');
    setReferenceNotes(landmark.referenceNotes || '');
    setLatitude(landmark.latitude.toString());
    setLongitude(landmark.longitude.toString());

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 🗑️ Eliminar Ponto
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Tem certeza que deseja apagar o ponto "${name}"?`)) return;

    try {
      await api.delete(`/landmarks/${id}`);
      alert(`Ponto "${name}" removido!`);
      fetchLandmarks();
    } catch (err) {
      console.error('Erro ao remover ponto:', err);
      alert('Erro ao eliminar ponto de referência.');
    }
  };

  // ❌ Cancelar Edição / Limpar
  const handleResetForm = () => {
    setEditingId(null);
    setNeighborhoodName('');
    setPlaceName('');
    setPopularName('');
    setReferenceNotes('');
    setLatitude('');
    setLongitude('');
  };

  // 🔍 Filtro em Tempo Real
  const filteredLandmarks = landmarks.filter((item) => {
    const term = searchTerm.toLowerCase();
    return (
      item.name.toLowerCase().includes(term) ||
      item.neighborhood.toLowerCase().includes(term) ||
      (item.popularName && item.popularName.toLowerCase().includes(term))
    );
  });

  return (
    <div className="landmarks-container">
      {/* CARD DO FORMULÁRIO */}
      <div className="landmarks-card">
        <div className="card-header">
          <h2>{editingId ? '✏️ Editar Ponto de Referência' : '📍 Cadastrar Ponto e Bairro 🇬🇼'}</h2>
          <p className="subtitle">Mapeamento Oficial de Operações Nobai245</p>
        </div>

        <form onSubmit={handleSaveLandmark}>
          <div className="gps-box">
            <button
              type="button"
              className="btn-gps"
              onClick={handleGetBrowserLocation}
              disabled={loadingGps}
            >
              {loadingGps ? 'Obtendo GPS...' : '📍 Capturar Posição GPS'}
            </button>

            <div className="coords-inputs">
              <div>
                <label>Latitude *</label>
                <input
                  type="number"
                  step="any"
                  placeholder="Ex: 11.8561"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  required
                />
              </div>
              <div>
                <label>Longitude *</label>
                <input
                  type="number"
                  step="any"
                  placeholder="Ex: -15.5833"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Bairro *</label>
              <input
                type="text"
                placeholder="Ex: Cuntum Madina, Belém, Bandim"
                value={neighborhoodName}
                onChange={(e) => setNeighborhoodName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Nome da Rua ou Ponto *</label>
              <input
                type="text"
                placeholder="Ex: Paragem di Cuntum, Bar Cabacera"
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Nome Popular / Crioulo (Opcional)</label>
            <input
              type="text"
              placeholder="Ex: Cabacera"
              value={popularName}
              onChange={(e) => setPopularName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Ponto de Referência (Opcional)</label>
            <textarea
              placeholder="Ex: Perto da bomba de água, ao lado da farmácia"
              value={referenceNotes}
              onChange={(e) => setReferenceNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-submit" disabled={submitting}>
              {submitting ? 'Guardando...' : editingId ? 'Atualizar Ponto' : 'Cadastrar Ponto Exato'}
            </button>

            {editingId && (
              <button type="button" className="btn-cancel" onClick={handleResetForm}>
                Cancelar Edição
              </button>
            )}
          </div>
        </form>
      </div>

      {/* TABELA DE PONTOS CADASTRADOS */}
      <div className="landmarks-list-card">
        <div className="list-header">
          <h3>Mapeamento Existente ({filteredLandmarks.length})</h3>
          <input
            type="text"
            className="search-input"
            placeholder="🔍 Procurar por bairro, ponto ou nome popular..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loadingList ? (
          <p className="loading-text">A carregar pontos de referência...</p>
        ) : filteredLandmarks.length === 0 ? (
          <p className="empty-text">Nenhum ponto registrado ou encontrado.</p>
        ) : (
          <div className="table-wrapper">
            <table className="landmarks-table">
              <thead>
                <tr>
                  <th>Bairro</th>
                  <th>Nome do Ponto</th>
                  <th>Nome Popular</th>
                  <th>Referência</th>
                  <th>Coordenadas</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredLandmarks.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.neighborhood}</strong></td>
                    <td>{item.name}</td>
                    <td>{item.popularName || '-'}</td>
                    <td>{item.referenceNotes || '-'}</td>
                    <td className="coords-cell">
                      {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-action edit"
                          onClick={() => handleEdit(item)}
                          title="Editar"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-action delete"
                          onClick={() => handleDelete(item.id, item.name)}
                          title="Apagar"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}