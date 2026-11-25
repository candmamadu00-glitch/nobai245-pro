import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ONGOING_RIDE_NOTIFICATION_ID = 'nobai245-active-ride-status';
const ONGOING_CHANNEL_ID = 'active-ride-ongoing-silent';

let lastSignature = '';

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

  try {
    await Notifications.setNotificationChannelAsync(ONGOING_CHANNEL_ID, {
      name: 'Status da Corrida Ativa',
      importance: Notifications.AndroidImportance.LOW,
      sound: undefined,
      enableVibrate: false,
      vibrationPattern: [0],
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    const mainTitle = etaMinutes ? `Chegando em: ${etaMinutes} min` : title;
    const mainBody = vehiclePlate && vehicleModel
      ? `${vehicleModel} • Placa: ${vehiclePlate}\n${body}`
      : body;

    const signature = `${mainTitle}|${mainBody}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    await Notifications.scheduleNotificationAsync({
      identifier: ONGOING_RIDE_NOTIFICATION_ID,
      content: {
        title: `🇬🇼 ${mainTitle}`,
        body: mainBody,
        sticky: true,
        sound: false,
        vibrate: [],
        priority: Notifications.AndroidNotificationPriority.LOW,
        categoryIdentifier: 'active-ride',
      },
      trigger: null,
    });
  } catch (e) {
    // Falha silenciosa para nao interromper fluxo da corrida
  }
}

export async function dismissOngoingRideNotification() {
  lastSignature = '';
  try {
    await Notifications.dismissNotificationAsync(ONGOING_RIDE_NOTIFICATION_ID);
  } catch (e) {
    // Ignora erro se nao existir notificacao ativa
  }
}
