import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@nobai245:offlineQueue';

export interface OfflineAction {
  id: string;
  event: string;
  payload: any;
  timestamp: number;
}

/**
 * Salva uma ação na fila local quando a rede está indisponível
 */
export async function saveActionToQueue(event: string, payload: any): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: OfflineAction[] = existing ? JSON.parse(existing) : [];

    queue.push({
      id: Math.random().toString(36).substring(2, 9),
      event,
      payload,
      timestamp: Date.now(),
    });

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    console.log(`📦 [OFFLINE QUEUE] Ação "${event}" salva localmente.`);
  } catch (error) {
    console.error('❌ [OFFLINE QUEUE ERR] Erro ao salvar ação offline:', error);
  }
}

/**
 * Sincroniza e envia todas as ações salvas na fila para o backend assim que o socket reconecta
 */
export async function processOfflineQueue(socketInstance: any): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(QUEUE_KEY);
    if (!existing) return;

    const queue: OfflineAction[] = JSON.parse(existing);
    if (queue.length === 0) return;

    console.log(`🔄 [OFFLINE SYNC] Sincronizando ${queue.length} ações pendentes com o servidor...`);

    const remainingQueue: OfflineAction[] = [];

    for (const item of queue) {
      if (socketInstance && socketInstance.connected) {
        socketInstance.emit(item.event, item.payload);
        console.log(`✅ [OFFLINE SYNC] Evento "${item.event}" enviado com sucesso.`);
      } else {
        remainingQueue.push(item);
      }
    }

    if (remainingQueue.length > 0) {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    } else {
      await AsyncStorage.removeItem(QUEUE_KEY);
      console.log('🎉 [OFFLINE SYNC] Toda a fila offline foi sincronizada!');
    }
  } catch (error) {
    console.error('❌ [OFFLINE SYNC ERR] Erro ao processar fila offline:', error);
  }
}