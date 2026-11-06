import type { GenreFacet, StatusResponse } from '../shared/types.js';
import { config } from './config.js';
import {
  loadAlbumRows,
  loadLibraryFingerprint,
} from './db.js';
import {
  SqliteIndex,
  type AlbumsQuery,
  type AlbumsResult,
} from './sqlite.js';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the current library index.
 *
 * The raw `music` table has hundreds of thousands of rows, so it is aggregated
 * into an in-memory SQLite database instead of being queried on every request.
 * FTS5 and ordinary indexes now provide search, facets, and sorting; the
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

  async start(): Promise<void> {
    await this.rebuild();
    this.lastCheckedAt = new Date();
    this.schedule(this.index ? config.checkIntervalMs : 15_000);
  }

  stop(): void {
    this.clearTimer();
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
      error: this.lastError,
      playbackEnabled: config.dsmUrl !== null,
    };
  }

  genres(): GenreFacet[] {
    return this.index?.genres() ?? [];
  }

  regions(): GenreFacet[] {
    return this.index?.regions() ?? [];
  }

  /** Raw album titles that were merged into this album, for track lookup. */
  sourceAlbumsFor(album: string, artist: string): string[] {
    return this.index?.sourceAlbumsFor(album, artist) ?? [album];
  }

  /** Representative file path for the album cover, or null if unknown. */
  coverPathFor(album: string, artist: string): string | null {
    return this.index?.coverPathFor(album, artist) ?? null;
  }

  queryAlbums(query: AlbumsQuery): AlbumsResult {
    if (!this.index) throw new Error('Library is not ready');
    return this.index.queryAlbums(query);
  }

  private async rebuild(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    const started = Date.now();

    try {
      const fingerprint = await loadLibraryFingerprint();
      const rows = await loadAlbumRows();
      const version = this.version + 1;
      const index = await SqliteIndex.build(rows, version);

      const previous = this.index;
      this.index = index;
      this.fingerprint = fingerprint;
      this.version = version;
      this.lastError = null;
      previous?.close();
      const memory = process.memoryUsage();
      console.log(
        `[library] version ${version}: indexed ${index.albumCount} albums ` +
          `and ${index.trackCount} tracks in ${Date.now() - started} ms ` +
          `(SQLite ${Math.round(index.databaseBytes / 1024 / 1024)} MB, ` +
          `RSS ${Math.round(memory.rss / 1024 / 1024)} MB)`,
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
