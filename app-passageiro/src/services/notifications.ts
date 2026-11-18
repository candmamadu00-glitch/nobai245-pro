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

export async function registerAndSendPushToken(accessToken?: string): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) {
    console.warn('⚠️ [PUSH] Notificações remotas requerem um dispositivo físico.');
    return null;
  }

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
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await api.put(
            '/passengers/device-token',
            { deviceToken: pushToken },
            accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
          );
          await AsyncStorage.setItem('@nobai245:last_passenger_push_token', pushToken).catch(() => {});
          break;
        } catch (err: any) {
          if (attempt === 3) {
            console.warn('⚠️ [PUSH] Falha ao salvar deviceToken HTTP após 3 tentativas:', err?.message);
          } else {
            await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }
      }
      if (socket && socket.connected) {
        socket.emit('passenger:update_device_token', { deviceToken: pushToken });
      }
    }

    return pushToken;
  } catch (error) {
    return null;
  }
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