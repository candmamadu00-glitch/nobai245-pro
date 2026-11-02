import React, { useState } from 'react';
import api from '../services/api';
import './Landmarks.css';

export default function Landmarks() {
  const [neighborhoodName, setNeighborhoodName] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [popularName, setPopularName] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [loadingGps, setLoadingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Captura localização pelo navegador do PC/Telemóvel
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

  const handleSaveLandmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neighborhoodName.trim() || !placeName.trim() || !latitude || !longitude) {
      alert('Preencha Bairro, Nome do Ponto, Latitude e Longitude.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/landmarks', {
        neighborhoodName,
        name: placeName,
        popularName,
        referenceNotes,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      });

      alert(`Sucesso! 📍 "${placeName}" cadastrado em ${neighborhoodName}.`);
      setPlaceName('');
      setPopularName('');
      setReferenceNotes('');
    } catch (err) {
      alert('Erro ao salvar ponto no banco de dados.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="landmarks-container">
      <div className="landmarks-card">
        <h2>Cadastro de Pontos e Bairros 🇬🇼</h2>
        <p className="subtitle">Mapeamento Oficial Nobai245</p>

        <form onSubmit={handleSaveLandmark}>
          <div className="gps-box">
            <button
              type="button"
              className="btn-gps"
              onClick={handleGetBrowserLocation}
              disabled={loadingGps}
            >
              {loadingGps ? 'Obtendo GPS...' : '📍 Usar Posição Atual do GPS'}
            </button>
            <div className="coords-inputs">
              <div>
                <label>Latitude:</label>
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
                <label>Longitude:</label>
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
              placeholder="Ex: Na esquina perto da bomba de água"
              value={referenceNotes}
              onChange={(e) => setReferenceNotes(e.target.value)}
              rows={3}
            />
          </div>

          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? 'Salvando...' : 'Cadastrar Ponto Exato'}
          </button>
        </form>
      </div>
    </div>
  );
}