const { defineConfig } = require('vite');
module.exports = defineConfig({ server: { port: 5173, proxy: {
  '/api': 'http://localhost:3001', '/socket.io': { target: 'http://localhost:3001', ws: true }
} } });
