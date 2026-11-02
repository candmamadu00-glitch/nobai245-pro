import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api'; // Sua instância configurada do Axios

export default function CollectorScreen() {
  const [neighborhoodName, setNeighborhoodName] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [popularName, setPopularName] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loadingGps, setLoadingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    captureCurrentLocation();
  }, []);

  const captureCurrentLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão Negada', 'Permita o acesso ao GPS para cadastrar o ponto exato.');
        setLoadingGps(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest
      });

      setCoords({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
    } catch (err) {
      Alert.alert('Erro GPS', 'Não foi possível ler a posição exata.');
    } finally {
      setLoadingGps(false);
    }
  };

  const handleSaveLandmark = async () => {
    if (!neighborhoodName.trim() || !placeName.trim() || !coords) {
      Alert.alert('Campos Obrigatórios', 'Preencha o Bairro, Nome do Ponto e capture a localização.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/landmarks', {
        neighborhoodName,
        name: placeName,
        popularName,
        referenceNotes,
        latitude: coords.latitude,
        longitude: coords.longitude
      });

      Alert.alert('Sucesso! 📍', `"${placeName}" cadastrado em ${neighborhoodName}.`);
      setPlaceName('');
      setPopularName('');
      setReferenceNotes('');
    } catch (err) {
      Alert.alert('Erro', 'Falha ao salvar no banco de dados.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.headerTitle}>Cadastro de Pontos em Campo 🇬🇼</Text>
        <Text style={styles.headerSubtitle}>Mapeamento oficial Nobai245</Text>

        {/* CARD DO GPS */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsRow}>
            <Ionicons name="location" size={24} color="#10B981" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.gpsLabel}>Coordenadas Atuais do GPS:</Text>
              {loadingGps ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : coords ? (
                <Text style={styles.gpsCoords}>
                  Lat: {coords.latitude.toFixed(6)} | Lng: {coords.longitude.toFixed(6)}
                </Text>
              ) : (
                <Text style={styles.gpsError}>Nenhuma coordenada obtida</Text>
              )}
            </View>
          </View>
          <TouchableOpacity style={styles.recapBtn} onPress={captureCurrentLocation}>
            <Ionicons name="refresh" size={16} color="#FFFFFF" />
            <Text style={styles.recapBtnText}>Recapturar Posição</Text>
          </TouchableOpacity>
        </View>

        {/* FORMULÁRIO */}
        <Text style={styles.fieldLabel}>Bairro *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Cuntum Madina, Belém, Bandim"
          placeholderTextColor="#64748B"
          value={neighborhoodName}
          onChangeText={setNeighborhoodName}
        />

        <Text style={styles.fieldLabel}>Nome da Rua ou Ponto *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Paragem di Cuntum, Bar Cabacera"
          placeholderTextColor="#64748B"
          value={placeName}
          onChangeText={setPlaceName}
        />

        <Text style={styles.fieldLabel}>Nome Popular / Crioulo (Opcional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Cabacera"
          placeholderTextColor="#64748B"
          value={popularName}
          onChangeText={setPopularName}
        />

        <Text style={styles.fieldLabel}>Ponto de Referência Próximo (Opcional)</Text>
        <TextInput
          style={[styles.input, { height: 70 }]}
          placeholder="Ex: Na esquina perto da bomba de água"
          placeholderTextColor="#64748B"
          multiline
          value={referenceNotes}
          onChangeText={setReferenceNotes}
        />

        <TouchableOpacity 
          style={[styles.saveBtn, submitting && { opacity: 0.6 }]} 
          onPress={handleSaveLandmark}
          disabled={submitting}
        >
          <Text style={styles.saveBtnText}>
            {submitting ? 'Gravando no Banco...' : 'Cadastrar Ponto Exato'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  scroll: { padding: 20 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 13, color: '#94A3B8', marginBottom: 20 },
  gpsCard: { backgroundColor: '#1E293B', padding: 15, borderRadius: 10, marginBottom: 20, borderWidth: 1, borderColor: '#334155' },
  gpsRow: { flexDirection: 'row', alignItems: 'center' },
  gpsLabel: { fontSize: 12, color: '#94A3B8' },
  gpsCoords: { fontSize: 13, fontWeight: 'bold', color: '#10B981', marginTop: 2 },
  gpsError: { fontSize: 13, color: '#EF4444', marginTop: 2 },
  recapBtn: { marginTop: 12, backgroundColor: '#334155', paddingVertical: 8, borderRadius: 6, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  recapBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginLeft: 6 },
  fieldLabel: { color: '#E2E8F0', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#1E293B', color: '#FFFFFF', paddingHorizontal: 12, borderRadius: 8, height: 48, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  saveBtn: { backgroundColor: '#10B981', height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }
});