import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === 'expo';

if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function registerAndSendPushToken(accessToken?: string): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) {
    return null;
  }

  try {
    const userStored = await AsyncStorage.getItem('@bai245:user');
    if (!userStored && !accessToken) {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Geral',
        importance: Notifications.AndroidImportance.DEFAULT,
      });

      await Notifications.setNotificationChannelAsync('ride-updates', {
        name: 'Atualizações da Viagem',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EAB308',
      });

      await Notifications.setNotificationChannelAsync('chat-messages', {
        name: 'Mensagens do Chat',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 150, 150, 150],
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
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('⚠️ [PUSH PASSAGEIRO] projectId não configurado no app.json.');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData?.data;

    if (pushToken) {
      await api.put('/passengers/device-token', { deviceToken: pushToken });
      console.log('✅ [PUSH PASSAGEIRO] Token registrado com sucesso!');
      return pushToken;
    }
  } catch (err) {
    console.warn('⚠️ [PUSH PASSAGEIRO] Erro ao registrar Push Token:', err);
  }

  return null;
}

export const registerForPushNotifications = registerAndSendPushToken;

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
      if (subReceived && typeof subReceived.remove === 'function') {
        subReceived.remove();
      }
      if (subResponse && typeof subResponse.remove === 'function') {
        subResponse.remove();
      }
    } catch (e) {
      // Ignora falhas na desativação dos escutadores
    }
  };
}

const notificationsService = {
  registerAndSendPushToken,
  registerForPushNotifications,
  setupNotificationListeners,
};

export default notificationsService;