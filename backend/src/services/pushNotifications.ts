// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

const PUSH_DEDUP_WINDOW_MS = 8_000;
const RIDE_STAGE_DEDUP_WINDOW_MS = 60_000;
const SINGLE_STAGE_RIDE_TYPES = new Set([
  'NEW_RIDE_REQUEST',
  'RIDE_ACCEPTED',
  'DRIVER_NEARBY',
  'DRIVER_ARRIVED',
  'RIDE_STARTED',
  'RIDE_COMPLETED',
  'RIDE_CANCELLED',
]);
const recentPushDispatches = new Map<string, number>();

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
  imageUrl?: string;
}

export async function sendPushNotification(
  tokenOrPayload: string | null | undefined | PushNotificationPayload | PushNotificationPayload[],
  title?: string,
  body?: string,
  data: Record<string, any> = {},
  channelId: string = PUSH_CHANNELS.RIDE_UPDATE
): Promise<void> {
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
  console.log(`\n🔔 [PUSH ATTEMPT] Enviando notificação para: "${pushToken}" | Canal: "${channelId}"`);

  if (!pushToken || typeof pushToken !== 'string' || !Expo.isExpoPushToken(pushToken)) {
    console.error(`❌ [PUSH REJECTED] Token inválido: "${pushToken}"`);
    return;
  }

  const now = Date.now();
  for (const [k, exp] of recentPushDispatches.entries()) {
    if (exp <= now) recentPushDispatches.delete(k);
  }
  const rideIdKey = data?.rideId ? String(data.rideId) : '';
  const eventTypeKey = data?.type ? String(data.type) : '';
  const isSingleRideStage = Boolean(rideIdKey && eventTypeKey && SINGLE_STAGE_RIDE_TYPES.has(eventTypeKey));
  const dedupWindowMs = isSingleRideStage ? RIDE_STAGE_DEDUP_WINDOW_MS : PUSH_DEDUP_WINDOW_MS;
  const pushSig = isSingleRideStage
    ? `${pushToken}|${channelId}|RIDE_STAGE|${rideIdKey}|${eventTypeKey}`
    : `${pushToken}|${channelId}|${title || ''}|${body || ''}|${rideIdKey}|${eventTypeKey}`;

  const existingExp = recentPushDispatches.get(pushSig);
  if (existingExp && existingExp > now) {
    console.log(`🛡️ [PUSH DEDUP] Ignorando envio duplicado (${eventTypeKey || 'GENERIC'}) para "${pushToken}"`);
    return;
  }
  recentPushDispatches.set(pushSig, now + dedupWindowMs);

  const message: any = {
    to: pushToken,
    sound: 'default',
    title: title || '',
    body: body || '',
    data: { ...data, channelId },
    priority: 'high',
    channelId,
    _displayInForeground: true,
  };

  if (data?.imageUrl) {
    message.attachments = [{ url: data.imageUrl }];
  }

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      ticketChunk.forEach((ticket: any) => {
        if (ticket.status === 'ok') {
          console.log(`✅ [PUSH EXPO SUCCESS] Ticket ID: ${ticket.id}`);
        } else {
          console.error(`❌ [PUSH EXPO ERROR]:`, ticket.message, ticket.details);
        }
      });
    }
  } catch (error) {
    console.error('💥 [PUSH FATAL ERROR]:', error);
  }
}