import { config } from './config.js';
import { DsmClient, type FileStream } from './dsm.js';

const AVAILABLE_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 2 * 60_000;
const MAX_CACHE_ENTRIES = 1000;
const ERROR_LOG_INTERVAL_MS = 60_000;

interface AvailabilityEntry {
  available: boolean;
  expiresAt: number;
}

/**
 * Translate a mediaserver path into the share path expected by FileStation.
 * Media files are recorded as `/volume1/music/...`; FileStation addresses the
 * same files as `/music/...`.
 */
export function artworkPathFor(filePath: string): string | null {
  const normalized = filePath.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) return null;

  const sharePath = normalized.replace(/^\/volume\d+(?=\/)/, '');
  if (!sharePath || sharePath === '/') return null;

  const separator = sharePath.lastIndexOf('/');
  if (separator < 1) return null;
  return `${sharePath.slice(0, separator)}/Artwork.pdf`;
}

/**
 * Locates and streams `Artwork.pdf` from an album folder through the optional
 * Synology service account. Availability is cached briefly so opening the same
 * album repeatedly does not query the NAS every time.
 */
export class ArtworkService {
  private readonly dsm: DsmClient | null;
  private readonly availability = new Map<string, AvailabilityEntry>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private lastErrorLog = 0;

  constructor() {
    this.dsm = config.dsm ? new DsmClient(config.dsm) : null;
    console.log(
      this.dsm
        ? `[artwork] Synology FileStation artwork enabled (${config.dsm?.url})`
        : '[artwork] Synology artwork disabled (set DSM_URL/DSM_USER/DSM_PASS or DSADDR/DSUSER/DSPASSWD)',
    );
  }

  async hasArtwork(filePath: string): Promise<boolean> {
    const dsm = this.dsm;
    if (!dsm) return false;

    const path = artworkPathFor(filePath);
    if (!path) return false;

    const now = Date.now();
    const cached = this.availability.get(path);
    if (cached && cached.expiresAt > now) {
      this.availability.delete(path);
      this.availability.set(path, cached);
      return cached.available;
    }
    if (cached) this.availability.delete(path);

    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;

    const load = this.check(dsm, path).finally(() => {
      this.pending.delete(path);
    });
    this.pending.set(path, load);
    return load;
  }

  async openArtwork(
    filePath: string,
    range?: string,
  ): Promise<FileStream | null> {
    const dsm = this.dsm;
    if (!dsm) return null;

    const path = artworkPathFor(filePath);
    if (!path) return null;

    try {
      return await dsm.openFile(path, range);
    } catch (error) {
      this.logError(error);
      throw error;
    }
  }

  private async check(dsm: DsmClient, path: string): Promise<boolean> {
    let available = false;
    try {
      available = await dsm.fileExists(path);
    } catch (error) {
      this.logError(error);
    }

    this.store(path, available);
    return available;
  }

  private store(path: string, available: boolean): void {
    this.availability.delete(path);
    this.availability.set(path, {
      available,
      expiresAt:
        Date.now() + (available ? AVAILABLE_TTL_MS : MISSING_TTL_MS),
    });

    while (this.availability.size > MAX_CACHE_ENTRIES) {
      const oldest = this.availability.keys().next().value;
      if (oldest === undefined) break;
      this.availability.delete(oldest);
    }
  }

  private logError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLog = now;
    console.error(
      '[artwork] failed to load Artwork.pdf:',
      error instanceof Error ? error.message : error,
    );
  }
}

export const artwork = new ArtworkService();
