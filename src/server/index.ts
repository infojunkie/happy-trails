import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { library } from './library.js';

async function main(): Promise<void> {
  // Build the album index before accepting traffic. If the database is down,
  // Library keeps retrying in the background and the UI shows the error.
  await library.start();

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[server] happy-trails listening at http://${config.host}:${config.port}`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);
    library.stop();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
