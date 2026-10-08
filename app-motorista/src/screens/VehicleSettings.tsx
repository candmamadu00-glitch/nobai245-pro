import React from 'react';
import { 
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, 
  ScrollView, Platform, StatusBar 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export function VehicleSettings() {
  const navigation = useNavigation<any>();
  const { driver } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#059669" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Veículo e Documentos</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* CARD DADOS DO VEÍCULO */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}>
              <Ionicons name="car" size={22} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Dados do Veículo</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Marca / Modelo</Text>
            <Text style={styles.value}>{(driver as any)?.vehicleBrand || 'Não informado'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Cor do Veículo</Text>
            <Text style={styles.value}>{(driver as any)?.vehicleColor || 'Não informada'}</Text>
          </View>

          <View style={[styles.infoRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <Text style={styles.label}>Placa Cadastrada</Text>
            <Text style={styles.plateBadge}>{driver?.vehiclePlate || 'N/A'}</Text>
          </View>
        </View>

        {/* CARD DOCUMENTAÇÃO */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}>
              <Ionicons name="document-text" size={22} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Documentação</Text>
          </View>

          <View style={[styles.infoRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <Text style={styles.label}>Nº do Documento</Text>
            <Text style={styles.value}>{(driver as any)?.documentNumber || 'Não informado'}</Text>
          </View>

          <View style={styles.statusBox}>
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
            <Text style={styles.statusText}>Documentos verificados e aprovados pela central.</Text>
          </View>
        </View>

        {/* CARD INFORMATIVO / AÇÃO */}
        <View style={styles.noticeCard}>
          <Ionicons name="information-circle-outline" size={24} color="#059669" style={{ marginBottom: 8 }} />
          <Text style={styles.noticeTitle}>Deseja alterar seus dados?</Text>
          <Text style={styles.noticeText}>
            Para garantir a segurança, alterações de placa, veículo ou documento precisam ser aprovadas pela central de atendimento.
          </Text>
          <TouchableOpacity 
            style={styles.actionBtn} 
            onPress={() => navigation.navigate('Profile')}
          >
            <Text style={styles.actionBtnText}>Ir ao Perfil para Solicitar Alteração</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F4F4F5', 
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justify: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 14, 
    backgroundColor: '#FFF', 
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    elevation: 2 
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1F2937' },
  content: { padding: 16 },
  card: { 
    backgroundColor: '#FFF', 
    padding: 20, 
    borderRadius: 16, 
    marginBottom: 16, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#ECFDF5', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  infoRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  value: { fontSize: 14, color: '#111827', fontWeight: '700' },
  plateBadge: { backgroundColor: '#111827', color: '#FFF', fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, fontSize: 13 },
  statusBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', padding: 12, borderRadius: 10, marginTop: 14, gap: 8 },
  statusText: { fontSize: 12, color: '#065F46', fontWeight: '700', flex: 1 },
  noticeCard: { backgroundColor: '#FFF', padding: 20, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#D1FAE5' },
  noticeTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 4 },
  noticeText: { fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  actionBtn: { backgroundColor: '#059669', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, width: '100%', alignItems: 'center' },
  actionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
});