import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startServer(app: Express): Promise<TestServer> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Test server did not expose a TCP address');
  }
  const { port } = address as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function json<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: init?.redirect ?? 'manual',
  });
  const body = (await response.json()) as T;
  return { response, body };
}

export function cookieFrom(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';', 1)[0] ?? null;
}
