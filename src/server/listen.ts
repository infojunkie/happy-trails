import { once } from 'node:events';
import type { Server } from 'node:http';

/** The subset of an Express app needed to bind a port. */
export interface PortListeningApp {
  listen(port: number, host: string): Server;
}

export interface ListeningServer {
  server: Server;
  port: number;
}

const MAX_PORT = 65_535;

/**
 * Listen on the first free port at or after `startPort`. Only `EADDRINUSE`
 * advances to the next port; other bind errors (permissions, invalid host)
 * are surfaced immediately.
 */
export async function listenOnFirstFreePort(
  app: PortListeningApp,
  host: string,
  startPort: number,
  maxPort = MAX_PORT,
): Promise<ListeningServer> {
  const lastPort = Math.min(maxPort, MAX_PORT);
  if (
    !Number.isInteger(startPort) ||
    startPort < 1 ||
    startPort > lastPort
  ) {
    throw new Error(
      `Cannot search for a free port from ${startPort} (valid range 1-${lastPort})`,
    );
  }

  for (let port = startPort; port <= lastPort; port += 1) {
    const server = app.listen(port, host);
    try {
      await once(server, 'listening');
      return { server, port };
    } catch (error) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }

  throw new Error(`No free port found from ${startPort} to ${lastPort}`);
}
