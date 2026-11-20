export const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
};

export const AndroidNotificationVisibility = {
  UNKNOWN: 0,
  PUBLIC: 1,
  PRIVATE: 2,
  SECRET: 3,
};

export const AndroidNotificationPriority = {
  MIN: 'min',
  LOW: 'low',
  DEFAULT: 'default',
  HIGH: 'high',
  MAX: 'max',
};

export const setNotificationHandler = () => {};
export const setNotificationChannelAsync = async () => null;
export const getPermissionsAsync = async () => ({
  status: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  granted: typeof Notification !== 'undefined' && Notification.permission === 'granted',
  canAskAgain: true,
  expires: 'never',
});
export const requestPermissionsAsync = async () => {
  if (typeof Notification !== 'undefined' && Notification.requestPermission) {
    const res = await Notification.requestPermission();
    return { status: res, granted: res === 'granted', canAskAgain: res !== 'denied', expires: 'never' };
  }
  return { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
};
export const getExpoPushTokenAsync = async () => ({ data: '' });
export const getDevicePushTokenAsync = async () => ({ type: 'web', data: '' });
export const addNotificationReceivedListener = () => ({ remove: () => {} });
export const addNotificationResponseReceivedListener = () => ({ remove: () => {} });
export const getLastNotificationResponseAsync = async () => null;
export const clearLastNotificationResponseAsync = async () => {};
export const scheduleNotificationAsync = async () => '';
export const dismissNotificationAsync = async () => {};
export const dismissAllNotificationsAsync = async () => {};
export const getBadgeCountAsync = async () => 0;
export const setBadgeCountAsync = async () => false;

const NotificationsWeb = {
  AndroidImportance,
  AndroidNotificationVisibility,
  AndroidNotificationPriority,
  setNotificationHandler,
  setNotificationChannelAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  getDevicePushTokenAsync,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
  clearLastNotificationResponseAsync,
  scheduleNotificationAsync,
  dismissNotificationAsync,
  dismissAllNotificationsAsync,
  getBadgeCountAsync,
  setBadgeCountAsync,
};

export default NotificationsWeb;
