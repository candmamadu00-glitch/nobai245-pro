import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { storage } from './storage';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === 'expo';

export async function registerAndSendPushToken(deviceId?: string, accessToken?: string): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) return null;

  try {
    const driverStored = await storage.getDriver();
    if (!driverStored && !accessToken) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('new-ride-alarm', {
        name: 'Chamada de Nova Corrida',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500, 200, 500],
        lightColor: '#059669',
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });

      await Notifications.setNotificationChannelAsync('ride-updates', {
        name: 'Atualizações da Corrida',
        importance: Notifications.AndroidImportance.HIGH,
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
      });
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