import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { storage } from './storage';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === 'expo';

// 🟢 CORREÇÃO 1: Exibe alertas, banners e som mesmo com o app do motorista aberto
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let lastSentPushKey = '';
export async function registerAndSendPushToken(deviceId?: string, accessToken?: string): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) return null;

  try {
    const driverStored = await storage.getDriver();
    if (!driverStored && !accessToken) return null;

    if (Platform.OS === 'android') {
      // Canal de Nova Corrida (Alarme Alto)
      await Notifications.setNotificationChannelAsync('new-ride-alarm', {
        name: 'Chamada de Nova Corrida',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500, 200, 500],
        lightColor: '#059669',
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });

      // Canal de Atualizações Gerais
      await Notifications.setNotificationChannelAsync('ride-updates', {
        name: 'Atualizações da Corrida',
        importance: Notifications.AndroidImportance.HIGH,
      });

      // 🟢 CORREÇÃO 2: Canal de Mensagens do Chat exclusivo para o Motorista
      await Notifications.setNotificationChannelAsync('chat-messages', {
        name: 'Mensagens do Chat',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 200, 200],
        lightColor: '#EAB308',
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

    let pushTokenData: Notifications.ExpoPushToken | null = null;
    try {
      pushTokenData = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
    } catch {
      pushTokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
    }

    const pushToken = pushTokenData?.data || null;

    if (pushToken) {
      const currentKey = `${pushToken}:${deviceId || ''}`;
      if (lastSentPushKey === currentKey) return pushToken;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await api.put(
            '/drivers/device-token',
            { deviceToken: pushToken, deviceId },
            accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
          );
          lastSentPushKey = currentKey;
          break;
        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }
      }
      return pushToken;
    }
  } catch (err) {
    console.error('💥 [MOTORISTA PUSH] Falha no fluxo do token:', err);
  }
  return null;
}

export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void
) {
  if (isExpoGo) return () => {};

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

export default {
  registerAndSendPushToken,
  setupNotificationListeners,
};