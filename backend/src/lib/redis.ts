import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Necessário para BullMQ e filas de background
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay; // Tenta reconectar exponencialmente até 2s
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true; // Força reconexão em caso de failover do cluster
    }
    return false;
  }
});

redis.on('error', (err) => {
  console.error('❌ [IOREDIS CLIENT] Erro de Conexão:', err?.message || err);
});

redis.on('connect', () => {
  console.log('📦 [IOREDIS CLIENT] Conectado com sucesso ao Redis.');
});