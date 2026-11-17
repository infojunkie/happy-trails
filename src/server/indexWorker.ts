import { parentPort, workerData } from 'node:worker_threads';
import { loadLibraryFingerprint, loadLibraryRows, pool } from './db.js';
import type {
  IndexWorkerData,
  IndexWorkerMessage,
} from './indexWorkerProtocol.js';
import { SqliteIndex } from './sqlite.js';

/**
 * Build a file-backed index off the main thread. The worker owns its own
 * PostgreSQL pool and writes a new SQLite file; the main thread keeps serving
 * the previous index and opens the new file when this worker reports success.
 */
async function main(): Promise<void> {
  const { databasePath, version } = workerData as IndexWorkerData;
  let message: IndexWorkerMessage | undefined;

  try {
    const fingerprint = await loadLibraryFingerprint();
    const { albums, tracks } = await loadLibraryRows();
    const index = await SqliteIndex.build(
      albums,
      tracks,
      version,
      databasePath,
    );
    message = {
      ok: true,
      fingerprint,
      albumCount: index.albumCount,
      trackCount: index.trackCount,
      databaseBytes: index.databaseBytes,
    };
    // Keep the file for the main thread; close only this connection.
    index.persist();
  } catch (error) {
    message = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }

  parentPort?.postMessage(
    message ?? { ok: false, error: 'Index builder produced no result' },
  );
  parentPort?.close();
}

void main().catch((error: unknown) => {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  parentPort?.close();
});
