import { Linking, Platform, Alert } from 'react-native';

export type NavigationApp = 'google-maps' | 'waze' | 'apple-maps' | 'mapbox';

interface NavigationTarget {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Abre a navegação externa (Google Maps, Waze, Apple Maps ou app de mapas padrão)
 * mantendo o tracking da corrida em segundo plano sincronizado com o passageiro.
 */
export async function openExternalNavigation(
  target: NavigationTarget,
  app: NavigationApp = 'google-maps'
): Promise<void> {
  const { latitude, longitude, label } = target;
  const encodedLabel = encodeURIComponent(label || 'Destino Nô Bai 245');

  let primaryUrl = '';
  let fallbackUrl = '';

  switch (app) {
    case 'google-maps':
      primaryUrl =
        Platform.OS === 'ios'
          ? `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`
          : `google.navigation:q=${latitude},${longitude}&mode=d`;
      fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
      break;
    case 'waze':
      primaryUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
      fallbackUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
      break;
    case 'apple-maps':
      primaryUrl = `maps://?daddr=${latitude},${longitude}&q=${encodedLabel}`;
      fallbackUrl = `https://maps.apple.com/?daddr=${latitude},${longitude}&q=${encodedLabel}`;
      break;
    case 'mapbox':
    default:
      primaryUrl =
        Platform.OS === 'ios'
          ? `maps://?daddr=${latitude},${longitude}&q=${encodedLabel}`
          : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedLabel})`;
      fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
      break;
  }

  try {
    const supported = await Linking.canOpenURL(primaryUrl);
    if (supported) {
      await Linking.openURL(primaryUrl);
      return;
    }
    if (fallbackUrl) {
      await Linking.openURL(fallbackUrl);
      return;
    }
    Alert.alert(
      'Navegação Integrada',
      'Utilize o mapa Mapbox integrado na tela principal para seguir a rota passo a passo.'
    );
  } catch (error) {
    try {
      if (fallbackUrl) {
        await Linking.openURL(fallbackUrl);
        return;
      }
    } catch (_) {}
    console.error('Erro ao abrir navegação externa:', error);
  }
}
