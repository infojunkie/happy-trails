import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { library } from './library.js';

async function main(): Promise<void> {
  // Listen before the first index is ready so /api/status and the static UI
  // are available while the builder worker runs. Data endpoints return 503
  // until `ready` is true. If the database is down, Library keeps retrying in
  // the background and the UI shows the error.
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

  try {
    await library.start();
  } catch (error) {
    // prepareIndexStorage() failures are configuration errors; the rebuild
    // itself reports failures through /api/status and retries.
    console.error('[server] failed to start the library:', error);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
  }
}

void main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
