import { config } from './config.js';
import { loadCoverTrackId } from './db.js';
import { DsmClient, type CoverImage } from './dsm.js';

const NEGATIVE_TTL_CAP_MS = 10 * 60_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

interface CacheEntry {
  image: CoverImage | null;
  expiresAt: number;
}

/**
 * Bounded in-memory LRU of cover images. Missing covers are cached briefly so
 * a grid with many album-art-less entries does not hit the NAS repeatedly.
 */
export class CoverService {
  private readonly dsm: DsmClient | null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<CoverImage | null>>();
  private lastErrorLog = 0;

  constructor() {
    this.dsm = config.dsm ? new DsmClient(config.dsm) : null;
    console.log(
      this.dsm
        ? `[covers] Synology AudioStation covers enabled (${config.dsm?.url})`
        : '[covers] Synology covers disabled (set DSM_URL/DSM_USER/DSM_PASS or DSADDR/DSUSER/DSPASSWD)',
    );
  }

  async getCover(filePath: string): Promise<CoverImage | null> {
    const dsm = this.dsm;
    if (!dsm) return null;

    const now = Date.now();
    const cached = this.cache.get(filePath);
    if (cached && cached.expiresAt > now) {
      // Refresh the LRU position.
      this.cache.delete(filePath);
      this.cache.set(filePath, cached);
      return cached.image;
    }
    if (cached) this.cache.delete(filePath);

    const inFlight = this.pending.get(filePath);
    if (inFlight) return inFlight;

    const load = this.load(dsm, filePath).finally(() => {
      this.pending.delete(filePath);
    });
    this.pending.set(filePath, load);
    return load;
  }

  private async load(
    dsm: DsmClient,
    filePath: string,
  ): Promise<CoverImage | null> {
    let image: CoverImage | null = null;
    try {
      const trackId = await loadCoverTrackId(filePath);
      if (trackId !== null) image = await dsm.getCover(trackId);
    } catch (error) {
      this.logError(error);
    }

    const ttlMs = image
      ? config.coverCacheTtlMs
      : Math.min(config.coverCacheTtlMs, NEGATIVE_TTL_CAP_MS);
    this.store(filePath, image, ttlMs);
    return image;
  }

  private store(
    filePath: string,
    image: CoverImage | null,
    ttlMs: number,
  ): void {
    if (config.coverCacheEntries <= 0) return;

    this.cache.delete(filePath);
    this.cache.set(filePath, { image, expiresAt: Date.now() + ttlMs });

    while (this.cache.size > config.coverCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private logError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLog = now;
    console.error(
      '[covers] failed to load cover:',
      error instanceof Error ? error.message : error,
    );
  }
}

export const covers = new CoverService();
