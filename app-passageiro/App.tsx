import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import Mapbox from '@rnmapbox/maps';
import * as Notifications from 'expo-notifications';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { RideProvider } from './src/contexts/RideContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { navigationRef } from './src/utils/navigationHelper';
import { registerAndSendPushToken, setupNotificationListeners } from './src/services/notifications';

// Telas
import { Home } from './src/screens/Home'; 
import { Login } from './src/screens/Login';
import { Register } from './src/screens/Register';
import { Profile } from './src/screens/Profile'; 
import { RideHistory } from './src/screens/RideHistory'; 
import { RideDetails } from './src/screens/RideDetails';
import { Rewards } from './src/screens/Rewards';
import { EmergencyContacts } from './src/screens/EmergencyContacts';
import { Onboarding } from './src/components/Onboarding';
import { HelpCenter } from './src/screens/HelpCenter';
import { MapScreen } from './src/screens/MapScreen'; 
import './src/services/i18n';

// Configuração do Mapbox
const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
if (mapboxToken) {
  Mapbox.setAccessToken(mapboxToken);
}

// Configuração do Sentry
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    debug: __DEV__,
    tracesSampleRate: 1.0,
  });
}

// NOVO: Canal de Chat no Android
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('chat-messages', {
    name: 'Mensagens do Chat',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
}

const Stack = createNativeStackNavigator();

const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#F8FAFC',
  },
};

function Rotas() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;

    registerAndSendPushToken().catch(() => {});

    const cleanupListeners = setupNotificationListeners(
      (notification) => {
        console.log('🔔 [PASSAGEIRO] Notificação recebida em 1º plano:', notification.request.content.title);
      },
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.rideId) {
          console.log('👆 [PASSAGEIRO] Notificação clicada para corrida:', data.rideId);
          
          // NOVO: Navega para a Home abrindo o chat se for notificação de mensagem
          if (data?.type === 'CHAT_MESSAGE') {
            if (navigationRef.isReady()) {
              // @ts-ignore
              navigationRef.navigate('Home', { activeRideId: data.rideId, openChat: true });
            }
          }
        }
      }
    );

    return () => {
      cleanupListeners();
    };
  }, [user]);

  useEffect(() => {
    if (user && process.env.EXPO_PUBLIC_SENTRY_DSN) {
      Sentry.setUser({ id: String(user.id), username: user.phone });
    } else if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
      Sentry.setUser(null);
    }
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    async function checkOnboarding() {
      try {
        const completed = await AsyncStorage.getItem('@bai245:onboarding_complete');
        if (isMounted) setIsOnboarded(completed === 'true');
      } catch (error) {
        if (isMounted) setIsOnboarded(false);
      }
    }
    checkOnboarding();
    return () => { isMounted = false; };
  }, []);

  const renderOnboarding = useCallback((props: any) => (
    <Onboarding {...props} onComplete={() => setIsOnboarded(true)} />
  ), []);

  if (loading || isOnboarded === null) {
    return (
      <View style={styles.splashContainer}>
        <ActivityIndicator size="large" color="#EAB308" />
        <Text style={styles.splashText}>{t('loading_app_experience', 'Carregando sua experiência...')}</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator 
      screenOptions={{ 
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      {user ? (
        <Stack.Group>
          <Stack.Screen name="Home" component={Home} />
          <Stack.Screen name="Profile" component={Profile} /> 
          <Stack.Screen name="RideHistory" component={RideHistory} /> 
          <Stack.Screen name="RideDetails" component={RideDetails} />
          <Stack.Screen name="Rewards" component={Rewards} />
          <Stack.Screen name="Map" component={MapScreen} />
          <Stack.Screen name="EmergencyContacts" component={EmergencyContacts} />
          <Stack.Screen name="HelpCenter" component={HelpCenter} />
        </Stack.Group>
      ) : (
        <Stack.Group screenOptions={{ animation: 'fade' }}>
          {!isOnboarded ? (
            <Stack.Screen name="Onboarding">
              {renderOnboarding}
            </Stack.Screen>
          ) : (
            <>
              <Stack.Screen name="Login" component={Login} />
              <Stack.Screen name="Register" component={Register} />
            </>
          )}
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <NavigationContainer ref={navigationRef} theme={AppTheme}>
          <StatusBar style="dark" backgroundColor="transparent" translucent />
          <AuthProvider>
            <RideProvider>
              <Rotas />
            </RideProvider>
          </AuthProvider>
        </NavigationContainer>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splashContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A202C' },
  splashText: { marginTop: 16, color: '#F8FAFC', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 }
});

export default process.env.EXPO_PUBLIC_SENTRY_DSN ? Sentry.wrap(App) : App;