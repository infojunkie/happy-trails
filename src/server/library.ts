import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  AlbumSummary,
  GenreFacet,
  StatusResponse,
} from '../shared/types.js';
import { config } from './config.js';
import { loadLibraryFingerprint, loadLibraryRows } from './db.js';
import type {
  IndexWorkerData,
  IndexWorkerMessage,
} from './indexWorkerProtocol.js';
import {
  SqliteIndex,
  type AlbumsQuery,
  type AlbumsResult,
  type TracksQuery,
  type TracksResult,
} from './sqlite.js';

const INDEX_FILE_PREFIX = 'happy-trails-index-';
const INDEX_WORKER_URL = new URL(
  import.meta.url.endsWith('.ts') ? './indexWorker.ts' : './indexWorker.js',
  import.meta.url,
);
/** A hung worker must not leave the library refreshing forever. */
const INDEX_BUILD_TIMEOUT_MS = 10 * 60_000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the current library index.
 *
 * The raw `music` table has hundreds of thousands of rows, so it is aggregated
 * into a SQLite database instead of being queried on every request. The
 * database lives in `INDEX_DB_DIR` (or in memory when that is `:memory:`);
 * FTS5 and ordinary indexes provide search, facets, and sorting, and the
 * database is rebuilt off to the side and swapped in atomically.
 */
export class Library {
  private index: SqliteIndex | null = null;
  private fingerprint: string | null = null;
  private version = 0;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private rebuilding = false;
  private timer: NodeJS.Timeout | null = null;
  private worker: Worker | null = null;

  async start(): Promise<void> {
    this.prepareIndexStorage();
    await this.rebuild();
    this.lastCheckedAt = new Date();
    this.schedule(this.index ? config.checkIntervalMs : 15_000);
  }

  stop(): void {
    this.clearTimer();
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
    this.index?.close();
    this.index = null;
  }

  status(): StatusResponse {
    const index = this.index;
    return {
      ready: index !== null,
      albumCount: index?.albumCount ?? 0,
      trackCount: index?.trackCount ?? 0,
      libraryVersion: this.version,
      lastRefreshed: index?.refreshedAt.toISOString() ?? null,
      lastCheckedAt: this.lastCheckedAt?.toISOString() ?? null,
      refreshing: this.rebuilding,
      checkIntervalMs: config.checkIntervalMs,
      coverflowIntervalMs: config.coverflowIntervalMs,
      // The API clamps every limit to maxPageSize, so expose the effective
      // value; the client uses it for paging and the Play all queue window.
      pageSize: Math.min(config.defaultPageSize, config.maxPageSize),
      searchHistoryLimit: config.searchHistoryLimit,
      error: this.lastError,
      playbackEnabled: config.dsmUrl !== null,
      nativePlaybackEnabled: config.nativePlaybackEnabled,
      audioStationFallbackEnabled: config.audioStationFallbackEnabled,
      screenWakeLockEnabled: config.screenWakeLockEnabled,
    };
  }

  genres(): GenreFacet[] {
    return this.index?.genres() ?? [];
  }

  regions(): GenreFacet[] {
    return this.index?.regions() ?? [];
  }

  /** Detected and embedded series, ordered by album count. */
  series(): GenreFacet[] {
    return this.index?.series() ?? [];
  }

  /** Raw album titles that were merged into this album, for track lookup. */
  sourceAlbumsFor(album: string, artist: string): string[] {
    return this.index?.sourceAlbumsFor(album, artist) ?? [album];
  }

  /** Representative file path for the album cover, or null if unknown. */
  coverPathFor(album: string, artist: string): string | null {
    return this.index?.coverPathFor(album, artist) ?? null;
  }

  /** Delimited series keys for an album, or "" when unknown. */
  serieKeysFor(album: string, artist: string): string {
    return this.index?.serieKeysFor(album, artist) ?? '';
  }

  queryAlbums(query: AlbumsQuery): AlbumsResult {
    if (!this.index) throw new Error('Library is not ready');
    return this.index.queryAlbums(query);
  }

  queryTracks(query: TracksQuery): TracksResult {
    if (!this.index) throw new Error('Library is not ready');
    return this.index.queryTracks(query);
  }

  /** Tracks belonging to the albums matched by an album-mode search. */
  queryAlbumTracks(query: TracksQuery): TracksResult {
    if (!this.index) throw new Error('Library is not ready');
    return this.index.queryAlbumTracks(query);
  }

  /** Full album summary for an opaque key, for the track-list dialog. */
  albumForKey(key: string): AlbumSummary | null {
    return this.index?.albumForKey(key) ?? null;
  }

  /**
   * Create the index directory and remove leftovers from a previous process.
   * The directory is treated as dedicated to this instance; a restart rebuilds
   * the index from PostgreSQL, so none of the old files are needed.
   */
  private prepareIndexStorage(): void {
    const dir = config.indexDbDir;
    if (dir === null) {
      console.log('[library] index storage: in memory');
      return;
    }

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    console.log(`[library] index storage: ${dir}`);
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(INDEX_FILE_PREFIX)) continue;
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch (error) {
        console.warn(`[library] could not remove stale index file ${name}:`, error);
      }
    }
  }

  /** Unique file for one build, or `:memory:` when the index is in memory. */
  private indexDatabasePath(version: number): string {
    const dir = config.indexDbDir;
    if (dir === null) return ':memory:';
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(
      dir,
      `${INDEX_FILE_PREFIX}${process.pid}-${version}-${randomUUID()}.sqlite`,
    );
  }

  /**
   * Build a new index. In file-backed mode the work happens in a worker
   * thread; `:memory:` databases cannot cross threads and stay in-process.
   */
  private async buildIndex(version: number): Promise<{
    index: SqliteIndex;
    fingerprint: string;
    builtInWorker: boolean;
  }> {
    if (config.indexDbDir === null) {
      const fingerprint = await loadLibraryFingerprint();
      const { albums, tracks } = await loadLibraryRows();
      const index = await SqliteIndex.build(albums, tracks, version);
      return { index, fingerprint, builtInWorker: false };
    }

    const databasePath = this.indexDatabasePath(version);
    try {
      const result = await this.buildInWorker(databasePath, version);
      const index = SqliteIndex.open(
        databasePath,
        version,
        result.albumCount,
        result.trackCount,
        result.databaseBytes,
      );
      return {
        index,
        fingerprint: result.fingerprint,
        builtInWorker: true,
      };
    } catch (error) {
      try {
        fs.rmSync(databasePath, { force: true });
      } catch (cleanupError) {
        console.warn(
          `[library] could not remove incomplete index ${databasePath}:`,
          cleanupError,
        );
      }
      throw error;
    }
  }

  private buildInWorker(
    databasePath: string,
    version: number,
  ): Promise<Extract<IndexWorkerMessage, { ok: true }>> {
    const worker = new Worker(INDEX_WORKER_URL, {
      workerData: { databasePath, version } satisfies IndexWorkerData,
    });
    this.worker = worker;

    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.worker === worker) this.worker = null;
      };

      const timer = setTimeout(() => {
        void worker.terminate();
        finish();
        reject(
          new Error(
            `Index build worker timed out after ${INDEX_BUILD_TIMEOUT_MS} ms`,
          ),
        );
      }, INDEX_BUILD_TIMEOUT_MS);
      timer.unref();

      worker.once('message', (message: IndexWorkerMessage) => {
        if (settled) return;
        if (message.ok) {
          finish();
          resolve(message);
        } else {
          finish();
          reject(new Error(message.error));
        }
      });
      worker.once('error', (error) => {
        if (settled) return;
        finish();
        reject(error);
      });
      worker.once('exit', (code) => {
        if (settled) return;
        finish();
        reject(
          new Error(
            `Index build worker exited with code ${code} before returning a result`,
          ),
        );
      });
    });
  }

  private async rebuild(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    const started = Date.now();

    try {
      const version = this.version + 1;
      if (config.indexDbDir !== null) {
        console.log(
          `[library] version ${version}: building index in a worker`,
        );
      }

      const { index, fingerprint, builtInWorker } =
        await this.buildIndex(version);

      const previous = this.index;
      this.index = index;
      this.fingerprint = fingerprint;
      this.version = version;
      this.lastError = null;
      previous?.close();
      const memory = process.memoryUsage();
      const storage =
        config.indexDbDir === null
          ? 'in memory'
          : `on disk${builtInWorker ? ', built in a worker' : ''}`;
      console.log(
        `[library] version ${version}: indexed ${index.albumCount} albums ` +
          `and ${index.trackCount} tracks in ${Date.now() - started} ms ` +
          `(SQLite ${Math.round(index.databaseBytes / 1024 / 1024)} MB ` +
          `${storage}, RSS ${Math.round(memory.rss / 1024 / 1024)} MB)`,
      );
    } catch (error) {
      this.lastError = describeError(error);
      console.error('[library] rebuild failed:', error);
    } finally {
      this.rebuilding = false;
      this.lastCheckedAt = new Date();
    }
  }

  private async checkForChanges(): Promise<void> {
    if (this.rebuilding) return;
    this.lastCheckedAt = new Date();

    try {
      const current = await loadLibraryFingerprint();
      if (this.index && current === this.fingerprint) {
        this.lastError = null;
        return;
      }

      console.log('[library] change detected; rebuilding index');
      await this.rebuild();
    } catch (error) {
      this.lastError = describeError(error);
      console.error('[library] change check failed:', error);
      this.lastCheckedAt = new Date();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkForChanges().finally(() => {
        this.schedule(this.index ? config.checkIntervalMs : 15_000);
      });
    }, delay);
    this.timer.unref();
  }
}

export const library = new Library();
