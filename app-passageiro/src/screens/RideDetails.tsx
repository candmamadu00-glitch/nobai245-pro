import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Alert, Linking, ActivityIndicator, Image, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { Ride } from '../types/ride';

const SUPPORT_WHATSAPP_NUMBER = '245966626730';

type RootStackParamList = {
  RideDetails: { rideId: string; ride?: Ride };
};

export function RideDetails() {
  const navigation = useNavigation<any>();
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

  const handleShareReceipt = async () => {
    try {
      const amount = Number(ride.priceXof || 0).toLocaleString('pt-PT');
      const driverLine = ride.driver?.fullName
        ? `Motorista: ${ride.driver.fullName}${ride.driver.vehiclePlate ? ` (${ride.driver.vehiclePlate})` : ''}
`
        : '';
      const receiptText =
        `🇬🇼 COMPROVANTE DE VIAGEM - NÔ BAI 245
` +
        `Código: #${String(ride.id).slice(0, 8).toUpperCase()}
` +
        `Data: ${formatDate(ride.createdAt || '')}
` +
        driverLine +
        `Origem: ${ride.originAddress || 'Não informada'}
` +
        `Destino: ${ride.destinationAddress || 'Não informado'}
` +
        `Valor Total: ${amount} XOF`;

      await Share.share({
        message: receiptText,
        title: 'Comprovante Nô Bai 245',
      });
    } catch {}
  };

  const handleRepeatRide = () => {
    const dLat = Number(ride.destinationLat);
    const dLng = Number(ride.destinationLng);
    const oLat = Number(ride.originLat);
    const oLng = Number(ride.originLng);
    const hasDest = !isNaN(dLat) && !isNaN(dLng) && dLat !== 0 && dLng !== 0;
    const hasOrig = !isNaN(oLat) && !isNaN(oLng) && oLat !== 0 && oLng !== 0;

    navigation.navigate('Home', {
      repeatRide: {
        originAddress: ride.originAddress || '',
        originLat: hasOrig ? oLat : undefined,
        originLng: hasOrig ? oLng : undefined,
        destinationAddress: ride.destinationAddress || '',
        destinationLat: hasDest ? dLat : undefined,
        destinationLng: hasDest ? dLng : undefined,
      },
    });
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
            } catch (error: any) {
              const errorMsg = error?.response?.data?.error || error?.response?.data?.message || t('ticket_error_msg', 'Não foi possível registrar o chamado.');
              Alert.alert(t('error_title', 'Erro'), errorMsg);
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

  const driverPhoto = ride.driver?.profilePicture;
  const cleanAssetBase = (api.defaults.baseURL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');
  const photoUri = driverPhoto?.startsWith('http')
    ? driverPhoto
    : `${cleanAssetBase}${driverPhoto?.startsWith('/') ? '' : '/uploads/'}${driverPhoto}`;

  const canRepeat = Boolean(ride.destinationAddress && Number(ride.destinationLat) !== 0 && Number(ride.destinationLng) !== 0);
  const isCompleted = ['FINISHED', 'COMPLETED'].includes(String(ride.status || '').toUpperCase());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('ride_details_header', 'Comprovante da Viagem')}</Text>
        <TouchableOpacity onPress={handleShareReceipt} style={styles.backButton} accessibilityLabel="Compartilhar comprovante">
          <Ionicons name="share-outline" size={21} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <View style={[styles.receiptBadge, { backgroundColor: isCompleted ? '#ECFDF5' : '#F1F5F9' }]}>
            <Ionicons name={isCompleted ? 'checkmark-circle' : 'receipt-outline'} size={14} color={isCompleted ? '#059669' : '#475569'} />
            <Text style={[styles.receiptBadgeText, { color: isCompleted ? '#059669' : '#475569' }]}>
              {isCompleted ? 'RECIBO OFICIAL • CONCLUÍDA' : 'COMPROVANTE NÔ BAI 245'}
            </Text>
          </View>
          <Text style={styles.totalLabel}>{t('amount_charged', 'Valor Total')}</Text>
          <Text style={styles.totalValue}>{Number(ride.priceXof || 0).toLocaleString('pt-PT')} XOF</Text>
          <Text style={styles.dateSub}>{formatDate(ride.createdAt || '')}</Text>
          <Text style={styles.rideCodeSub}>ID #{String(ride.id).slice(0, 8).toUpperCase()}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t('route_title', 'Trajeto')}</Text>
        <View style={styles.infoCard}>
          <View style={styles.routePoint}>
            <View style={styles.dotYellow} />
            <View style={styles.addressWrapper}>
              <Text style={styles.addressLabel}>{t('origin_label', 'Origem')}</Text>
              <Text style={styles.addressText}>{ride.originAddress || t('origin_not_informed', 'Origem não informada')}</Text>
            </View>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routePoint}>
            <View style={styles.dotBlack} />
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
                <View style={styles.verifiedTag}>
                  <Ionicons name="shield-checkmark" size={14} color="#059669" />
                  <Text style={styles.verifiedTagText}>Verificado</Text>
                </View>
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>{t('payment_summary_title', 'Resumo do Pagamento')}</Text>
        <View style={styles.infoCard}>
          {typeof ride.distanceKm === 'number' && ride.distanceKm > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Distância percorrida</Text>
              <Text style={styles.summaryValue}>{ride.distanceKm.toFixed(1)} km</Text>
            </View>
          )}
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

        {canRepeat && (
          <TouchableOpacity style={styles.repeatPrimaryBtn} onPress={handleRepeatRide} activeOpacity={0.85}>
            <Ionicons name="refresh" size={19} color="#0F172A" />
            <Text style={styles.repeatPrimaryBtnText}>{t('repeat_this_ride', 'Pedir esta viagem novamente')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.shareButton} onPress={handleShareReceipt} activeOpacity={0.8}>
          <Ionicons name="share-social-outline" size={19} color="#0F172A" />
          <Text style={styles.shareButtonText}>{t('share_receipt', 'Compartilhar Comprovante')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.supportButton} onPress={handleSupportRequest} disabled={isSendingSupport}>
          {isSendingSupport ? (
            <ActivityIndicator color="#475569" />
          ) : (
            <>
              <Ionicons name="help-circle-outline" size={19} color="#475569" />
              <Text style={styles.supportButtonText}>{t('need_help_ride_btn', 'Precisa de ajuda com esta corrida?')}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  errorText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  totalCard: { backgroundColor: '#FFF', borderRadius: 24, padding: 22, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  receiptBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginBottom: 12 },
  receiptBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  totalLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  totalValue: { fontSize: 30, fontWeight: '900', color: '#0F172A', marginVertical: 4 },
  dateSub: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  rideCodeSub: { fontSize: 11, color: '#94A3B8', fontWeight: '700', marginTop: 6, letterSpacing: 0.8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#E2E8F0' },
  routePoint: { flexDirection: 'row', alignItems: 'center' },
  dotYellow: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#EAB308' },
  dotBlack: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#0F172A' },
  addressWrapper: { marginLeft: 12, flex: 1 },
  addressLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '700', textTransform: 'uppercase' },
  addressText: { fontSize: 14, color: '#0F172A', fontWeight: '600', marginTop: 2 },
  routeLine: { width: 2, height: 20, backgroundColor: '#E2E8F0', marginLeft: 4.5, marginVertical: 4 },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  avatarFallback: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  driverName: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  carInfo: { fontSize: 13, color: '#64748B', marginTop: 2 },
  verifiedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  verifiedTagText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { fontSize: 14, color: '#64748B' },
  summaryValue: { fontSize: 14, color: '#0F172A', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 8 },
  summaryLabelBold: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  summaryValueBold: { fontSize: 17, fontWeight: '900', color: '#0F172A' },
  repeatPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAB308', paddingVertical: 15, borderRadius: 16, gap: 8, marginBottom: 10 },
  repeatPrimaryBtnText: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  shareButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: '#CBD5E1', gap: 8, marginBottom: 10 },
  shareButtonText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  supportButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', paddingVertical: 12, borderRadius: 14, gap: 6 },
  supportButtonText: { fontSize: 13.5, fontWeight: '600', color: '#475569' },
});
