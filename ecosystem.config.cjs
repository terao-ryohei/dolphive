module.exports = {
  apps: [
    {
      name: 'dolphive',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',
      time: true,
      // Restart on crash with exponential backoff
      exp_backoff_restart_delay: 100,
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
    },
  ],
};
