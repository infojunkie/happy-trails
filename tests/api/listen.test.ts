import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import test from 'node:test';
import {
  listenOnFirstFreePort,
  type PortListeningApp,
} from '../../src/server/listen.js';

type Behaviour = 'listening' | 'in-use' | 'denied';

class FakeServer extends EventEmitter {
  listening = false;
  closeCalls = 0;

  close(callback?: (error?: Error) => void): this {
    this.closeCalls += 1;
    this.listening = false;
    callback?.();
    return this;
  }
}

function fakeApp(behaviour: (port: number) => Behaviour) {
  const attempted: number[] = [];
  const servers: FakeServer[] = [];
  const app: PortListeningApp = {
    listen(port: number) {
      attempted.push(port);
      const server = new FakeServer();
      servers.push(server);
      setImmediate(() => {
        const outcome = behaviour(port);
        if (outcome === 'listening') {
          server.listening = true;
          server.emit('listening');
        } else if (outcome === 'in-use') {
          server.emit(
            'error',
            Object.assign(new Error('in use'), { code: 'EADDRINUSE' }),
          );
        } else {
          server.emit(
            'error',
            Object.assign(new Error('permission denied'), { code: 'EACCES' }),
          );
        }
      });
      return server as unknown as Server;
    },
  };
  return { app, attempted, servers };
}

test('listening uses the first free port at or after PORT', async () => {
  const { app, attempted } = fakeApp((port) =>
    port < 4311 ? 'in-use' : 'listening',
  );
  const result = await listenOnFirstFreePort(app, '127.0.0.1', 4310, 4320);
  assert.equal(result.port, 4311);
  assert.deepEqual(attempted, [4310, 4311]);
  result.server.close();
});

test('only EADDRINUSE advances; other bind errors are surfaced', async () => {
  const { app, attempted } = fakeApp(() => 'denied');
  await assert.rejects(
    listenOnFirstFreePort(app, '127.0.0.1', 4310, 4320),
    /permission denied/,
  );
  assert.deepEqual(attempted, [4310]);
});

test('an exhausted range reports the ports it tried', async () => {
  const { app, attempted } = fakeApp(() => 'in-use');
  await assert.rejects(
    listenOnFirstFreePort(app, '127.0.0.1', 4310, 4311),
    /No free port found from 4310 to 4311/,
  );
  assert.deepEqual(attempted, [4310, 4311]);
});

test('an invalid starting port is rejected before binding', async () => {
  const { app, attempted } = fakeApp(() => 'listening');
  await assert.rejects(
    listenOnFirstFreePort(app, '127.0.0.1', 0, 4320),
    /valid range/,
  );
  assert.deepEqual(attempted, []);
});
