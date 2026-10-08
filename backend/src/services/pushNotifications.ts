// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

export const PUSH_CHANNELS = {
  NEW_RIDE_ALARM: 'new-ride-alarm',
  RIDE_UPDATE: 'ride-updates',
  CHAT: 'chat-messages',
} as const;

export interface PushNotificationPayload {
  to?: string | null;
  pushToken?: string | null;
  title: string;
  body: string;
  data?: Record<string, any>;
  channelId?: string;
}

export async function sendPushNotification(
  tokenOrPayload: string | null | undefined | PushNotificationPayload | PushNotificationPayload[],
  title?: string,
  body?: string,
  data: Record<string, any> = {},
  channelId: string = PUSH_CHANNELS.RIDE_UPDATE
): Promise<void> {
  // Trata chamada com objeto único { to, title, body, data } ou Array de objetos
  if (typeof tokenOrPayload === 'object' && tokenOrPayload !== null) {
    if (Array.isArray(tokenOrPayload)) {
      for (const item of tokenOrPayload) {
        await sendPushNotification(item);
      }
      return;
    }

    const payload = tokenOrPayload as PushNotificationPayload;
    return sendPushNotification(
      payload.pushToken || payload.to,
      payload.title,
      payload.body,
      payload.data || {},
      payload.channelId || PUSH_CHANNELS.RIDE_UPDATE
    );
  }

  const pushToken = tokenOrPayload;
  console.log(`\n🔔 [PUSH ATTEMPT] Tentando enviar notificação...`);
  console.log(`   - Destination Token: "${pushToken}"`);
  console.log(`   - Canal: "${channelId}"`);
  console.log(`   - Título: "${title}"`);

  if (!pushToken || typeof pushToken !== 'string' || !Expo.isExpoPushToken(pushToken)) {
    console.error(`❌ [PUSH REJECTED] Token inválido, nulo ou fora do formato Expo: "${pushToken}"`);
    return;
  }

  const messages = [
    {
      to: pushToken,
      sound: 'default' as const,
      title: title || '',
      body: body || '',
      data: { ...data, channelId },
      priority: 'high' as const,
      channelId,
    },
  ];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

      ticketChunk.forEach((ticket: any) => {
        if (ticket.status === 'ok') {
          console.log(`✅ [PUSH EXPO SUCCESS] Notificação entregue! Ticket ID: ${ticket.id}`);
        } else {
          console.error(`❌ [PUSH EXPO ERROR] Recusado pelo Expo:`, ticket.message, ticket.details);
        }
      });
    }
  } catch (error) {
    console.error('💥 [PUSH FATAL ERROR] Erro na conexão com API do Expo:', error);
  }
}