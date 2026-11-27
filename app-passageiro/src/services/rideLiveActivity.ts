import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';

const LIVE_RIDE_CHANNEL_ID = 'nobai245_live_ride_pill';
const LIVE_RIDE_NOTIFICATION_ID = 'nobai245-active-ride-pill';

let channelInitialized = false;
let cachedPhotoUrl: string | null = null;
let cachedPhotoLocalUri: string | null = null;
let lastRenderedSignature = '';

export interface LiveRidePillPayload {
  rideId: string | number | null;
  rideStatus: string;
  driverName?: string;
  driverPhoto?: string | null;
  licensePlate?: string;
  carModel?: string;
  carColor?: string;
  etaMinutes?: number | null;
  startOtp?: string | null;
}

async function ensureLiveRideChannel(): Promise<void> {
  if (Platform.OS !== 'android' || channelInitialized) return;
  try {
    await Notifications.setNotificationChannelAsync(LIVE_RIDE_CHANNEL_ID, {
      name: 'Corrida em Andamento (Nô Bai 245)',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });
    channelInitialized = true;
  } catch {}
}

async function resolveDriverPhotoAttachment(photoUrl?: string | null): Promise<string | null> {
  if (!photoUrl || typeof photoUrl !== 'string' || !photoUrl.startsWith('http')) {
    return null;
  }
  if (cachedPhotoUrl === photoUrl && cachedPhotoLocalUri) {
    return cachedPhotoLocalUri;
  }
  try {
    const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDir) return null;
    const ext = photoUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const targetUri = `${baseDir}live_driver_avatar.${ext}`;
    const downloadRes = await FileSystem.downloadAsync(photoUrl, targetUri);
    if (downloadRes?.status === 200 && downloadRes?.uri) {
      cachedPhotoUrl = photoUrl;
      cachedPhotoLocalUri = downloadRes.uri;
      return downloadRes.uri;
    }
  } catch {}
  return null;
}

export async function updatePassengerLiveRidePill(
  payload: LiveRidePillPayload,
  forceRefresh = false
): Promise<void> {
  try {
    const activeStatuses = ['accepted', 'arrived', 'in_progress'];
    if (!payload.rideId || !activeStatuses.includes(payload.rideStatus)) {
      await clearPassengerLiveRidePill();
      return;
    }

    await ensureLiveRideChannel();

    const plate = (payload.licensePlate || 'NO-BAI').toUpperCase();
    const carLabel = [payload.carModel, payload.carColor].filter(Boolean).join(' • ');
    const driverFirstName = (payload.driverName || 'Motorista').trim().split(' ')[0];
    const eta = typeof payload.etaMinutes === 'number' && payload.etaMinutes > 0
      ? Math.max(1, Math.round(payload.etaMinutes))
      : null;

    let title = `${plate}`;
    let subtitle = carLabel ? `${driverFirstName} • ${carLabel}` : driverFirstName;
    let body = '';

    if (payload.rideStatus === 'accepted') {
      const etaText = eta ? `Chegando em ${eta} min` : 'Motorista a caminho';
      title = `${plate} • ${etaText}`;
      body = `${driverFirstName}${carLabel ? ` (${carLabel})` : ''} está indo até você. Toque para acompanhar no mapa.`;
    } else if (payload.rideStatus === 'arrived') {
      const otpSuffix = payload.startOtp ? ` • PIN ${payload.startOtp}` : '';
      title = `${plate} • Motorista chegou!${otpSuffix}`;
      body = `${driverFirstName}${carLabel ? ` (${carLabel})` : ''} aguarda no ponto de embarque.`;
    } else if (payload.rideStatus === 'in_progress') {
      const etaText = eta ? `Chegada em ${eta} min` : 'Em viagem';
      title = `${plate} • ${etaText}`;
      body = `Viagem em andamento com ${driverFirstName}${carLabel ? ` • ${carLabel}` : ''}. Toque para abrir.`;
    }

    const signature = `${payload.rideId}|${payload.rideStatus}|${title}|${body}|${payload.driverPhoto || ''}`;
    if (!forceRefresh && signature === lastRenderedSignature) {
      return;
    }
    lastRenderedSignature = signature;

    const localPhotoUri = await resolveDriverPhotoAttachment(payload.driverPhoto);

    await Notifications.scheduleNotificationAsync({
      identifier: LIVE_RIDE_NOTIFICATION_ID,
      content: {
        title,
        subtitle,
        body,
        sticky: true,
        autoDismiss: false,
        color: '#EAB308',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: {
          type: 'LIVE_RIDE_PILL',
          rideId: String(payload.rideId),
        },
        ...(localPhotoUri
          ? {
              attachments: [
                {
                  identifier: 'driver-photo',
                  url: localPhotoUri,
                  type: 'image/jpeg',
                },
              ],
            }
          : {}),
      },
      trigger:
        Platform.OS === 'android'
          ? { channelId: LIVE_RIDE_CHANNEL_ID }
          : null,
    });
  } catch {}
}

export async function clearPassengerLiveRidePill(): Promise<void> {
  lastRenderedSignature = '';
  try {
    await Notifications.dismissNotificationAsync(LIVE_RIDE_NOTIFICATION_ID);
  } catch {}
  try {
    await Notifications.cancelScheduledNotificationAsync(LIVE_RIDE_NOTIFICATION_ID);
  } catch {}
}
