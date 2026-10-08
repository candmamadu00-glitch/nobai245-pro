const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ignora pastas pesadas do monitoramento para evitar travamentos
config.resolver.blockList = [
  /android\/.*/,
  /ios\/.*/,
  /.*\.git\/.*/,
];

// Otimiza o watcher para estabilidade
config.watcher = {
  ...config.watcher,
  healthCheck: {
    enabled: false,
  },
};

module.exports = config;