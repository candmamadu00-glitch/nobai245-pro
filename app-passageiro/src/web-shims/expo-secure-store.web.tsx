export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, value);
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(key);
  }
}

export default {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  setItemAsync,
  getItemAsync,
  deleteItemAsync,
};
