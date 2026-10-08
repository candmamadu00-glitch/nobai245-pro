import React, { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import Mapbox from '@rnmapbox/maps';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { registerAndSendPushToken, setupNotificationListeners } from './src/services/notifications';

import { Login } from './src/screens/Login';
import { Register } from './src/screens/Register';
import { Home } from './src/screens/Home';
import { Profile } from './src/screens/Profile';
import { RideHistory } from './src/screens/RideHistory'; 
import { Earnings } from './src/screens/Earnings'; 
import { SupportHelp } from './src/screens/SupportHelp';
import { VehicleSettings } from './src/screens/VehicleSettings';
import { Wallet } from './src/screens/Wallet';
import { ForgotPassword } from './src/screens/ForgotPassword';

import './src/services/locationTask';
import './src/services/i18n';

// 🛡️ BLINDAGEM: Manipulador de Notificações atualizado para evitar crash nativo Android
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('new-ride-alarm', {
    name: 'Alarme de Nova Corrida',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 1000, 500, 1000],
    lightColor: '#059669',
    sound: undefined,
  });

  Notifications.setNotificationChannelAsync('chat-messages', {
    name: 'Mensagens do Chat',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: undefined,
  });
}

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef<any>();

// 🛡️ BLINDAGEM: Sanitização do Token Mapbox via Variável de Ambiente
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else {
  console.warn('⚠️ Mapbox token não configurado em EXPO_PUBLIC_MAPBOX_TOKEN');
}

function AppContent() {
  const { driver, loading } = useAuth();

  useEffect(() => {
    if (!driver) return;

    registerAndSendPushToken().catch(() => {});

    const cleanupListeners = setupNotificationListeners(
      (notification) => {
        const type = notification.request.content.data?.type;
        if (type === 'NEW_RIDE_REQUEST') {
          console.log('🔔 [MOTORISTA] Nova chamada de corrida em 1º plano');
        }
      },
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.type === 'NEW_RIDE_REQUEST') {
          console.log("👆 [MOTORISTA] Corrida clicada, ID:", data.rideId);
        } else if (data?.type === 'CHAT_MESSAGE' && data?.rideId) {
          if (navigationRef.isReady()) {
            navigationRef.navigate('Home', { activeRideId: data.rideId, openChat: true });
          }
        }
      }
    );

    return () => {
      cleanupListeners();
    };
  }, [driver]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0E243C' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {driver ? (
        <>
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Profile" component={Profile} />
          <Stack.Screen name="RideHistory" component={RideHistory} />
          <Stack.Screen name="Earnings" component={Earnings} />
          <Stack.Screen name="SupportHelp" component={SupportHelp} />
          <Stack.Screen name="VehicleSettings" component={VehicleSettings} />
          <Stack.Screen name="Wallet" component={Wallet} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={Login} />
          <Stack.Screen name="Register" component={Register} />
          <Stack.Screen name="ForgotPassword" component={ForgotPassword} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar style="light" />
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </NavigationContainer>
  );
}