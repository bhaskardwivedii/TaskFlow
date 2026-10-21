import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';

async function main() {
  await connectDB();
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  server.listen(env.port, () => console.log(`[api] listening on :${env.port} (${env.nodeEnv})`));

  const shutdown = async (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
