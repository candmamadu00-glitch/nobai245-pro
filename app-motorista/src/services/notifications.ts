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
      Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;

    if (!projectId) return null;

    const pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = pushTokenData?.data;

    if (pushToken) {
      await api.put('/drivers/device-token', {
        deviceToken: pushToken,
        deviceId,
      }).catch(() => {});
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