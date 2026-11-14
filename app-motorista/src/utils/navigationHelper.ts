import { Linking, Platform, Alert } from 'react-native';

export type NavigationApp = 'mapbox' | 'waze' | 'apple-maps';

interface NavigationTarget {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Abre a navegação externa nativa (geo/Mapbox/Apple Maps) sem dependências do Google Maps.
 */
export async function openExternalNavigation(
  target: NavigationTarget,
  app: NavigationApp = 'mapbox'
): Promise<void> {
  const { latitude, longitude, label } = target;
  const encodedLabel = encodeURIComponent(label || 'Destino Nô Bai 245');

  let url = '';
  switch (app) {
    case 'waze':
      url = `waze://?ll=${latitude},${longitude}&navigate=yes`;
      break;
    case 'apple-maps':
      url = `maps://?daddr=${latitude},${longitude}&q=${encodedLabel}`;
      break;
    case 'mapbox':
    default:
      url = Platform.OS === 'ios'
        ? `maps://?daddr=${latitude},${longitude}&q=${encodedLabel}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedLabel})`;
      break;
  }

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert(
        'Navegação Integrada',
        'Utilize o mapa Mapbox integrado na tela principal para seguir a rota passo a passo.'
      );
    }
  } catch (error) {
    console.error('Erro ao abrir navegação externa:', error);
  }
}
