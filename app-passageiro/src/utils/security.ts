import { Alert, BackHandler, Platform } from 'react-native';

export function checkLocationSecurity(location: any) {
  // 1. BLOQUEIO DE FAKE GPS (Localização Simulada)
  if (Platform.OS === 'android' && location.mocked) {
    Alert.alert(
      "Segurança Nobai245", 
      "Detectamos o uso de aplicativo de localização falsa (Fake GPS). Desative-o para usar a plataforma.",
      [{ text: "OK", onPress: () => BackHandler.exitApp() }] // Fecha o app
    );
    return false;
  }

  // 2. BLOQUEIO GEOGRÁFICO (Caixa delimitadora da Guiné-Bissau)
  // Latitudes da Guiné-Bissau: ~10.9° a ~12.7°
  // Longitudes da Guiné-Bissau: ~ -16.7° a ~ -13.6°
  const lat = location.coords.latitude;
  const lng = location.coords.longitude;
  
  const isInsideGuineaBissau = (lat >= 10.9 && lat <= 12.7) && (lng >= -16.7 && lng <= -13.6);

  if (!isInsideGuineaBissau) {
    Alert.alert(
      "Fora da Área de Cobertura", 
      "O Nobai245 atualmente funciona apenas dentro do território da Guiné-Bissau.",
      // Se não quiser fechar o app aqui, basta não usar o BackHandler
    );
    return false;
  }

  return true;
}