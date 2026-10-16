import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db/connection.js';

const config = loadConfig();
const app = createApp(config);

void connectDatabase(config.MONGODB_URI).catch(() => {
  console.error('MongoDB connection is unavailable; the backend will remain live but not ready.');
});

const server = app.listen(config.PORT, () => {
  console.log(`Obsidian backend listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
