import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db/connection.js';
import { shutdownDockerBrokers, type DockerBrokerExecutor } from './workers/docker-broker.js';

const config = loadConfig();
const app = createApp(config);

void connectDatabase(config.MONGODB_URI)
  .then(async () => {
    const worker = app.locals.workerExecutor as DockerBrokerExecutor | undefined;
    if (worker) await worker.recoverExpiredLeases();
  })
  .catch(() => {
    console.error('MongoDB connection or managed worker recovery is unavailable; the backend will remain live but not ready.');
  });

const server = app.listen(config.PORT, () => {
  console.log(`Obsidian backend listening on port ${config.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  await shutdownDockerBrokers();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
