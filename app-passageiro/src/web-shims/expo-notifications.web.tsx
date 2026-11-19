export const AndroidImportance = {
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
};

export const setNotificationHandler = () => {};
export const setNotificationChannelAsync = async () => null;
export const getPermissionsAsync = async () => ({
  status: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
});
export const requestPermissionsAsync = async () => {
  if (typeof Notification !== 'undefined' && Notification.requestPermission) {
    const res = await Notification.requestPermission();
    return { status: res };
  }
  return { status: 'denied' };
};
export const getExpoPushTokenAsync = async () => ({ data: '' });
export const addNotificationReceivedListener = () => ({ remove: () => {} });
export const addNotificationResponseReceivedListener = () => ({ remove: () => {} });
export const scheduleNotificationAsync = async () => '';
export const dismissNotificationAsync = async () => {};
export const dismissAllNotificationsAsync = async () => {};

export default {
  AndroidImportance,
  setNotificationHandler,
  setNotificationChannelAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  scheduleNotificationAsync,
  dismissNotificationAsync,
  dismissAllNotificationsAsync,
};
