import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ONGOING_RIDE_NOTIFICATION_ID = 'nobai245-active-ride-status';

export async function updateOngoingRideNotification({
  title,
  body,
  vehiclePlate,
  vehicleModel,
  etaMinutes,
}: {
  title: string;
  body: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  etaMinutes?: number | null;
}) {
  if (Platform.OS !== 'android') return;

  // Canal com alta prioridade no Android
  await Notifications.setNotificationChannelAsync('active-ride-ongoing', {
    name: 'Status da Corrida Ativa',
    importance: Notifications.AndroidImportance.HIGH,
    sound: undefined, // Sem som repetitivo ao atualizar
    vibrationPattern: [0],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  const mainTitle = etaMinutes ? `Chegando em: ${etaMinutes} min` : title;
  const mainBody = vehiclePlate && vehicleModel 
    ? `${vehicleModel} • Placa: ${vehiclePlate}\n${body}`
    : body;

  await Notifications.scheduleNotificationAsync({
    identifier: ONGOING_RIDE_NOTIFICATION_ID,
    content: {
      title: `🇬🇼 ${mainTitle}`,
      body: mainBody,
      sticky: true, // Impede que o usuário feche arrastando para o lado
      priority: Notifications.AndroidNotificationPriority.HIGH,
      categoryIdentifier: 'active-ride',
    },
    trigger: null, // Atualização imediata
  });
}

export async function dismissOngoingRideNotification() {
  try {
    await Notifications.dismissNotificationAsync(ONGOING_RIDE_NOTIFICATION_ID);
  } catch (e) {
    // Ignora erro se não existir notificação ativa
  }
}