import { Linking, Platform, Alert } from 'react-native';

export type NavigationApp = 'google-maps' | 'waze' | 'apple-maps';

interface NavigationTarget {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Abre o aplicativo de navegação selecionado com as coordenadas informadas.
 */
export async function openExternalNavigation(
  target: NavigationTarget,
  app: NavigationApp = 'google-maps'
): Promise<void> {
  const { latitude, longitude, label } = target;
  const encodedLabel = encodeURIComponent(label || 'Destino Nobai245');

  let url = '';

  switch (app) {
    case 'google-maps':
      if (Platform.OS === 'android') {
        url = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedLabel})`;
      } else {
        url = `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
      }
      break;

    case 'waze':
      url = `waze://?ll=${latitude},${longitude}&navigate=yes`;
      break;

    case 'apple-maps':
      url = `maps://?daddr=${latitude},${longitude}&q=${encodedLabel}`;
      break;

    default:
      url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }

  try {
    const supported = await Linking.canOpenURL(url);

    if (supported) {
      await Linking.openURL(url);
    } else {
      // Fallback para Google Maps via Web
      const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
      const webSupported = await Linking.canOpenURL(webUrl);

      if (webSupported) {
        await Linking.openURL(webUrl);
      } else {
        Alert.alert(
          'Aplicativo não encontrado',
          'Não foi possível abrir o aplicativo de navegação selecionado.'
        );
      }
    }
  } catch (error) {
    console.error('Erro ao abrir navegação externa:', error);
    Alert.alert('Erro', 'Não foi possível iniciar a navegação.');
  }
}