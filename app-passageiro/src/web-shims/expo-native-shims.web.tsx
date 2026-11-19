export const useKeepAwake = () => {};
export const activateKeepAwakeAsync = async () => {};
export const deactivateKeepAwake = async () => {};

export const speak = (text: string, opts?: { language?: string }) => {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (opts?.language) u.lang = opts.language;
      window.speechSynthesis.speak(u);
    }
  } catch (_) {}
};
export const stop = async () => {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}
};

export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' };
export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };
export const impactAsync = async () => {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
  } catch (_) {}
};
export const notificationAsync = async () => {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([30, 40, 30]);
  } catch (_) {}
};
export const selectionAsync = async () => {};

export const documentDirectory = '/';
export const cacheDirectory = '/';
export const readAsStringAsync = async () => '';
export const writeAsStringAsync = async () => {};
export const deleteAsync = async () => {};
export const getInfoAsync = async () => ({ exists: false, size: 0 });

export default {
  useKeepAwake,
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  speak,
  stop,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  selectionAsync,
  documentDirectory,
  cacheDirectory,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  getInfoAsync,
};
