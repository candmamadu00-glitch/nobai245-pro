import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { socket } from './passengerSocket';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === 'expo';

// Configuração para exibir alertas em primeiro e segundo plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let lastSyncedPassengerPushToken = '';
let lastSyncedPassengerPushAt = 0;
let inFlightPassengerPushPromise: Promise<string | null> | null = null;
const PUSH_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export async function registerAndSendPushToken(accessToken?: string): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) {
    return null;
  }

  if (inFlightPassengerPushPromise) {
    return inFlightPassengerPushPromise;
  }

  inFlightPassengerPushPromise = (async () => {

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Geral',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EAB308',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('chat-messages', {
        name: 'Mensagens do Chat',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 200, 200],
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId ||
      (Constants as any).manifest2?.extra?.eas?.projectId ||
      (Constants as any).manifest?.extra?.eas?.projectId;

    let tokenData: Notifications.ExpoPushToken | null = null;
    try {
      tokenData = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
    } catch {
      tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
    }

    const pushToken = tokenData?.data || null;

    if (pushToken) {
      const now = Date.now();
      const alreadySyncedRecently =
        lastSyncedPassengerPushToken === pushToken &&
        now - lastSyncedPassengerPushAt < PUSH_SYNC_COOLDOWN_MS;

      if (!alreadySyncedRecently) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await api.put(
              '/passengers/device-token',
              { deviceToken: pushToken },
              accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
            );
            lastSyncedPassengerPushToken = pushToken;
            lastSyncedPassengerPushAt = Date.now();
            await AsyncStorage.setItem('@nobai245:last_passenger_push_token', pushToken).catch(() => {});
            if (socket && socket.connected) {
              socket.emit('passenger:update_device_token', { deviceToken: pushToken });
            }
            break;
          } catch (err: any) {
            if (attempt === 2) {
              console.warn('⚠️ [PUSH] Falha ao salvar deviceToken HTTP:', err?.message);
            } else {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }
      }
    }

    return pushToken;
  } catch (error) {
    return null;
  } finally {
    inFlightPassengerPushPromise = null;
  }
  })();

  return inFlightPassengerPushPromise;
}

export const registerForPushNotifications = registerAndSendPushToken;

export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void
) {
  const subReceived = Notifications.addNotificationReceivedListener((notification) => {
    if (onNotificationReceived) onNotificationReceived(notification);
  });

  const subResponse = Notifications.addNotificationResponseReceivedListener((response) => {
    if (onNotificationResponse) onNotificationResponse(response);
  });

  return () => {
    try {
      subReceived?.remove();
      subResponse?.remove();
    } catch (e) {}
  };
}

const notificationsService = {
  registerAndSendPushToken,
  registerForPushNotifications,
  setupNotificationListeners,
};

export default notificationsService;