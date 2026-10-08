import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Alert, Linking, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { api } from '../services/api';
import { Ride } from '../types/ride';

const SUPPORT_WHATSAPP_NUMBER = '245966626730';

type RootStackParamList = {
  RideDetails: { rideId: string; ride?: Ride };
};

export function RideDetails() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RideDetails'>>();
  const { t } = useTranslation();
  const { rideId, ride: initialRide } = route.params || {};

  const [ride, setRide] = useState<Ride | undefined>(initialRide);
  const [loading, setLoading] = useState(!initialRide);
  const [isSendingSupport, setIsSendingSupport] = useState(false);

  useEffect(() => {
    if (!initialRide && rideId) {
      api.get(`/passengers/rides/${rideId}`)
        .then(res => setRide(res.data?.ride || res.data))
        .catch(() => Alert.alert(t('error_title', 'Erro'), t('error_load_ride_details', 'Não foi possível carregar os detalhes da viagem.')))
        .finally(() => setLoading(false));
    }
  }, [rideId, initialRide, t]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#EAB308" />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <Text style={styles.errorText}>{t('ride_not_found', 'Dados da corrida não encontrados.')}</Text>
      </SafeAreaView>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) 
      ? t('date_not_available', 'Data não disponível') 
      : `${date.toLocaleDateString('pt-BR')} ${t('at_time', 'às')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const handleSupportRequest = () => {
    Alert.alert(
      t('support_and_help_title', 'Atendimento e Suporte'), 
      t('support_prompt_msg', 'Como deseja falar com a equipe de suporte do BAI 245?'), 
      [
        {
          text: t('send_app_ticket', 'Enviar chamado pelo App'),
          onPress: async () => {
            setIsSendingSupport(true);
            try {
              await api.post(`/passengers/rides/${ride.id}/support`, {
                rideId: ride.id,
                message: 'Solicitação de ajuda registrada via detalhes da viagem.'
              });
              Alert.alert(t('success', 'Sucesso'), t('ticket_recorded_msg', 'Seu chamado foi registrado! Entraremos em contato em breve.'));
            } catch (error) {
              if (axios.isAxiosError(error)) {
                Alert.alert(t('error_title', 'Erro'), error.response?.data?.error || error.response?.data?.message || t('ticket_error_msg', 'Não foi possível registrar o chamado.'));
              } else {
                Alert.alert(t('error_title', 'Erro'), t('unexpected_error_msg', 'Ocorreu um erro inesperado ao processar sua solicitação.'));
              }
            } finally {
              setIsSendingSupport(false);
            }
          }
        },
        {
          text: t('talk_whatsapp', 'Falar no WhatsApp'),
          onPress: async () => {
            const messageText = t('whatsapp_support_text', `Olá! Preciso de ajuda com a corrida ID: ${ride.id}`);
            const message = encodeURIComponent(messageText);
            const url = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${message}`;
            try {
              const supported = await Linking.canOpenURL(url);
              if (supported) await Linking.openURL(url);
              else Alert.alert(t('error_title', 'Erro'), t('cant_open_whatsapp', 'Não foi possível abrir o WhatsApp.'));
            } catch {
              Alert.alert(t('error_title', 'Erro'), t('failed_open_msg_app', 'Falha ao tentar abrir o aplicativo de mensagens.'));
            }
          }
        },
        { text: t('back_btn', 'Cancelar'), style: 'cancel' }
      ]
    );
  };

 // Pega a URL da foto exata do seu banco de dados
  const driverPhoto = ride.driver?.profilePicture;
  const photoUri = driverPhoto?.startsWith('http') ? driverPhoto : `${api.defaults.baseURL}/uploads/${driverPhoto}`;
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A202C" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('ride_details_header', 'Detalhes da Viagem')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{t('amount_charged', 'Valor Cobrado')}</Text>
          <Text style={styles.totalValue}>{Number(ride.priceXof || 0).toLocaleString('pt-PT')} XOF</Text>
          <Text style={styles.dateSub}>{formatDate(ride.createdAt)}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t('route_title', 'Trajeto')}</Text>
        <View style={styles.infoCard}>
          <View style={styles.routePoint}>
            <Ionicons name="ellipse" size={12} color="#EAB308" />
            <View style={styles.addressWrapper}>
              <Text style={styles.addressLabel}>{t('origin_label', 'Origem')}</Text>
              <Text style={styles.addressText}>{ride.originAddress || t('origin_not_informed', 'Origem não informada')}</Text>
            </View>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routePoint}>
            <Ionicons name="location" size={14} color="#1A202C" />
            <View style={styles.addressWrapper}>
              <Text style={styles.addressLabel}>{t('destination_label', 'Destino')}</Text>
              <Text style={styles.addressText}>{ride.destinationAddress || t('destination_not_informed', 'Destino não informado')}</Text>
            </View>
          </View>
        </View>

        {ride.driver && (
          <>
            <Text style={styles.sectionTitle}>{t('driver_title', 'Motorista')}</Text>
            <View style={styles.infoCard}>
              <View style={styles.driverRow}>
                {driverPhoto ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarFallback} resizeMode="cover" />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Ionicons name="person" size={24} color="#64748B" />
                  </View>
                )}
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.driverName}>{ride.driver.fullName}</Text>
  <Text style={styles.carInfo}>
    {ride.driver.vehicleBrand ? `${ride.driver.vehicleBrand} • ` : ''}
    {ride.driver.vehiclePlate || t('plate_ni', 'Placa N/I')}
  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>{t('payment_summary_title', 'Resumo do Pagamento')}</Text>
        <View style={styles.infoCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('calculated_fare', 'Tarifa calculada')}</Text>
            <Text style={styles.summaryValue}>{Number(ride.priceXof || 0).toLocaleString('pt-PT')} XOF</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelBold}>{t('total_label', 'Total')}</Text>
            <Text style={styles.summaryValueBold}>{Number(ride.priceXof || 0).toLocaleString('pt-PT')} XOF</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.supportButton} onPress={handleSupportRequest} disabled={isSendingSupport}>
          {isSendingSupport ? (
            <ActivityIndicator color="#1A202C" />
          ) : (
            <>
              <Ionicons name="help-circle-outline" size={20} color="#1A202C" />
              <Text style={styles.supportButtonText}>{t('need_help_ride_btn', 'Precisa de ajuda com esta corrida?')}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  errorText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A202C' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  totalCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#F1F5F9' },
  totalLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  totalValue: { fontSize: 28, fontWeight: '900', color: '#1A202C', marginVertical: 6 },
  dateSub: { fontSize: 13, color: '#94A3B8' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1A202C', marginBottom: 8, marginLeft: 4 },
  infoCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#F1F5F9' },
  routePoint: { flexDirection: 'row', alignItems: 'center' },
  addressWrapper: { marginLeft: 12, flex: 1 },
  addressLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '700', textTransform: 'uppercase' },
  addressText: { fontSize: 14, color: '#334155', fontWeight: '600', marginTop: 2 },
  routeLine: { width: 2, height: 20, backgroundColor: '#E2E8F0', marginLeft: 5, marginVertical: 4 },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  driverName: { fontSize: 16, fontWeight: '800', color: '#1A202C' },
  carInfo: { fontSize: 13, color: '#64748B', marginTop: 2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { fontSize: 14, color: '#64748B' },
  summaryValue: { fontSize: 14, color: '#1A202C', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 8 },
  summaryLabelBold: { fontSize: 15, fontWeight: '800', color: '#1A202C' },
  summaryValueBold: { fontSize: 16, fontWeight: '900', color: '#1A202C' },
  supportButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  supportButtonText: { fontSize: 14, fontWeight: '700', color: '#1A202C' },
});