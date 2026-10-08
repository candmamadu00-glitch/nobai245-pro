import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Driver } from '../contexts/AuthContext';

const KEYS = {
  USER: '@nobai245:driverUser',
  ACCESS_TOKEN: '@nobai245:driverAccessToken',
  REFRESH_TOKEN: '@nobai245:driverRefreshToken',
  ONBOARDING_SEEN: '@nobai245:driverOnboarding',
  LANGUAGE: '@nobai245:driverLanguage',
} as const;

export const storage = {
  // --- Auth & Tokens ---
  async setAuthData(driver: Driver, accessToken: string, refreshToken: string): Promise<void> {
    try {
      await AsyncStorage.multiSet([
        [KEYS.USER, JSON.stringify(driver)],
        [KEYS.ACCESS_TOKEN, accessToken],
        [KEYS.REFRESH_TOKEN, refreshToken],
      ]);
    } catch (error) {
      console.error('❌ Erro ao salvar dados de autenticação:', error);
    }
  },

  async getAccessToken(): Promise<string | null> {
    return await AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
  },

  async getRefreshToken(): Promise<string | null> {
    return await AsyncStorage.getItem(KEYS.REFRESH_TOKEN);
  },

  async setAccessToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.ACCESS_TOKEN, token);
  },

  // --- Driver Profile ---
  async setDriver(driver: Driver): Promise<void> {
    await AsyncStorage.setItem(KEYS.USER, JSON.stringify(driver));
  },

  async getDriver(): Promise<Driver | null> {
    const data = await AsyncStorage.getItem(KEYS.USER);
    return data ? JSON.parse(data) : null;
  },

  // --- Limpeza ---
  async clearAuth(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([KEYS.USER, KEYS.ACCESS_TOKEN, KEYS.REFRESH_TOKEN]);
    } catch (error) {
      console.error('❌ Erro ao limpar storage de autenticação:', error);
    }
  },
};