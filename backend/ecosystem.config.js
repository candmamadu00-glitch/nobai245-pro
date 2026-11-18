module.exports = {
  apps: [
    {
      name: 'nobai245-backend',
      script: './dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 200,
      min_uptime: '15s',
      max_restarts: 15,
      kill_timeout: 12000,
      listen_timeout: 10000,
      shutdown_with_message: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3333
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
