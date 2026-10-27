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
    console.warn('⚠️ [PUSH PASSAGEIRO] Notificações remotas requerem um dispositivo físico (fora do Expo Go).');
    return null;
  }

  try {
    const userStored = await AsyncStorage.getItem('@bai245:user');
    if (!userStored && !accessToken) {
      console.warn('⚠️ [PUSH PASSAGEIRO] Usuário não autenticado no storage local.');
      return null;
    }

    // 1️⃣ Configuração dos Canais para Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Geral',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('ride-updates', {
        name: 'Atualizações da Viagem',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EAB308',
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('chat-messages', {
        name: 'Mensagens do Chat',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 150, 150, 150],
        sound: 'default',
      });
    }

    // 2️⃣ Solicitação de Permissão
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('⚠️ [PUSH PASSAGEIRO] Permissão de notificação negada pelo usuário.');
      return null;
    }

    // 3️⃣ Obtenção do Expo Push Token
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('⚠️ [PUSH PASSAGEIRO] projectId não configurado no app.json.');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData?.data;

    if (!pushToken) {
      console.warn('⚠️ [PUSH PASSAGEIRO] Não foi possível gerar o token da Expo.');
      return null;
    }

    console.log('📱 [PUSH PASSAGEIRO TOKEN GENERATED]:', pushToken);

    // 4️⃣ Envio via HTTP REST (Com tratamento explícito de log)
    try {
      await api.put('/passengers/device-token', { deviceToken: pushToken });
      console.log('✅ [PUSH PASSAGEIRO DB] Token salvo via HTTP com sucesso no banco!');
    } catch (httpErr: any) {
      console.error(
        '❌ [PUSH PASSAGEIRO HTTP ERR] Erro ao salvar token via HTTP:',
        httpErr?.response?.status,
        httpErr?.response?.data || httpErr?.message
      );
    }

    // 5️⃣ Envio via Socket (Com tratamento para Socket desconectado/handshake)
    const emitSocketToken = () => {
      if (socket && socket.connected) {
        socket.emit('passenger:update_device_token', { deviceToken: pushToken });
        console.log('⚡ [PUSH PASSAGEIRO SOCKET] Token emitido via Socket!');
      }
    };

    if (socket && socket.connected) {
      emitSocketToken();
    } else if (socket) {
      socket.once('connect', emitSocketToken);
    }

    return pushToken;
  } catch (error) {
    console.error('❌ [PUSH PASSAGEIRO] Erro inesperado ao registrar token:', error);
    return null;
  }
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
      // Ignora falhas na desativação
    }
  };
}

const notificationsService = {
  registerAndSendPushToken,
  registerForPushNotifications,
  setupNotificationListeners,
};

export default notificationsService;