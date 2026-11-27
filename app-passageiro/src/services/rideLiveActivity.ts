import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';

const LIVE_RIDE_CHANNEL_ID = 'nobai245_live_ride_pill';
const LIVE_RIDE_NOTIFICATION_ID = 'nobai245-active-ride-pill';
const FloatingRidePill = NativeModules.FloatingRidePill;

let channelInitialized = false;
let cachedPhotoUrl: string | null = null;
let cachedPhotoLocalUri: string | null = null;
let lastRenderedSignature = '';
let overlayPromptedThisSession = false;

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

export async function ensureOverlayPermissionOnce(): Promise<boolean> {
  if (Platform.OS !== 'android' || !FloatingRidePill?.canDrawOverlays) return false;
  try {
    const allowed = await FloatingRidePill.canDrawOverlays();
    if (!allowed && !overlayPromptedThisSession) {
      overlayPromptedThisSession = true;
      FloatingRidePill.requestOverlayPermission?.();
    }
    return Boolean(allowed);
  } catch {
    return false;
  }
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
    const activeStatuses = ['searching', 'queued', 'accepted', 'arrived', 'in_progress'];
    if (!activeStatuses.includes(payload.rideStatus)) {
      await clearPassengerLiveRidePill();
      return;
    }

    const plate = (payload.licensePlate || 'NÔ BAI 245').toUpperCase();
    const carLabel = [payload.carModel, payload.carColor].filter(Boolean).join(' • ');
    const driverFirstName = (payload.driverName || 'Motorista').trim().split(' ')[0];
    const eta = typeof payload.etaMinutes === 'number' && payload.etaMinutes > 0
      ? Math.max(1, Math.round(payload.etaMinutes))
      : null;

    let pillTitle = plate;
    let pillSubtitle = carLabel ? `${driverFirstName} • ${carLabel}` : driverFirstName;
    let notifTitle = plate;
    let notifBody = '';

    if (payload.rideStatus === 'searching') {
      pillTitle = 'Solicitando';
      pillSubtitle = 'Buscando motorista...';
      notifTitle = 'Solicitando corrida • Nô Bai 245';
      notifBody = 'Aguarde, estamos encontrando o motorista mais próximo.';
    } else if (payload.rideStatus === 'queued' || payload.rideStatus === 'accepted') {
      const etaText = eta ? `Chegando em ${eta} min` : 'A caminho';
      pillTitle = plate;
      pillSubtitle = etaText;
      notifTitle = `${plate} • ${etaText}`;
      notifBody = `${driverFirstName}${carLabel ? ` (${carLabel})` : ''} está indo até você.`;
    } else if (payload.rideStatus === 'arrived') {
      const otpSuffix = payload.startOtp ? ` • PIN ${payload.startOtp}` : '';
      pillTitle = plate;
      pillSubtitle = `Chegou!${otpSuffix}`;
      notifTitle = `${plate} • Motorista chegou!${otpSuffix}`;
      notifBody = `${driverFirstName}${carLabel ? ` (${carLabel})` : ''} aguarda no embarque.`;
    } else if (payload.rideStatus === 'in_progress') {
      const etaText = eta ? `Chegada em ${eta} min` : 'Em viagem';
      pillTitle = plate;
      pillSubtitle = etaText;
      notifTitle = `${plate} • ${etaText}`;
      notifBody = `Viagem em andamento com ${driverFirstName}.`;
    }

    const signature = `${payload.rideId || 'search'}|${payload.rideStatus}|${pillTitle}|${pillSubtitle}|${payload.driverPhoto || ''}`;
    if (!forceRefresh && signature === lastRenderedSignature) {
      return;
    }
    lastRenderedSignature = signature;

    // 1. Pílula flutuante real sobre a tela inicial do Android (estilo 99)
    if (Platform.OS === 'android' && FloatingRidePill?.showOrUpdate) {
      FloatingRidePill.showOrUpdate(pillTitle, pillSubtitle, payload.driverPhoto || '');
    }

    // 2. Fallback na barra de notificações caso o usuário ainda não tenha concedido Sobrepor Apps
    await ensureLiveRideChannel();
    const localPhotoUri = await resolveDriverPhotoAttachment(payload.driverPhoto);

    await Notifications.scheduleNotificationAsync({
      identifier: LIVE_RIDE_NOTIFICATION_ID,
      content: {
        title: notifTitle,
        subtitle: pillSubtitle,
        body: notifBody,
        sticky: true,
        autoDismiss: false,
        color: '#EAB308',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: {
          type: 'LIVE_RIDE_PILL',
          rideId: String(payload.rideId || ''),
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
    if (Platform.OS === 'android' && FloatingRidePill?.hide) {
      FloatingRidePill.hide();
    }
  } catch {}
  try {
    await Notifications.dismissNotificationAsync(LIVE_RIDE_NOTIFICATION_ID);
  } catch {}
  try {
    await Notifications.cancelScheduledNotificationAsync(LIVE_RIDE_NOTIFICATION_ID);
  } catch {}
}
