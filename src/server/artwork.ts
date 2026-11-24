import type { AlbumPdf } from '../shared/types.js';
import { config } from './config.js';
import { DsmClient, type FileStream } from './dsm.js';

const AVAILABLE_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 2 * 60_000;
const MAX_CACHE_ENTRIES = 1000;
const ERROR_LOG_INTERVAL_MS = 60_000;

interface PdfListEntry {
  pdfs: AlbumPdf[];
  expiresAt: number;
}

/**
 * Translate a mediaserver file path into its album folder in the share
 * namespace expected by FileStation. Media files are recorded as
 * `/volume1/music/...`; FileStation addresses the same files as `/music/...`.
 */
export function albumFolderPathFor(filePath: string): string | null {
  const normalized = filePath.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) return null;

  const sharePath = normalized.replace(/^\/volume\d+(?=\/)/, '');
  if (!sharePath || sharePath === '/') return null;

  const separator = sharePath.lastIndexOf('/');
  if (separator < 1) return null;
  return sharePath.slice(0, separator);
}

/** Whether a single path segment is a PDF booklet filename. */
export function isPdfFilename(name: string): boolean {
  return (
    name.length > '.pdf'.length &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    /\.pdf$/i.test(name)
  );
}

/** The pill label for a PDF: its filename with only the final extension removed. */
export function pdfLabelFor(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

const PDF_NAME_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

/** Natural, case-insensitive filename comparison for the PDF pills. */
export function comparePdfNames(left: string, right: string): number {
  return PDF_NAME_COLLATOR.compare(left, right);
}

/** Common Synology album-art filenames, in preference order. */
const ORIGINAL_COVER_NAMES = [
  'Folder.jpg',
  'folder.jpg',
  'Cover.jpg',
  'cover.jpg',
  'front.jpg',
  'Folder.jpeg',
  'cover.jpeg',
  'Folder.png',
  'folder.png',
  'Cover.png',
  'cover.png',
] as const;

interface OriginalCoverEntry {
  path: string | null;
  expiresAt: number;
}

/**
 * Lists and streams the PDF booklets in an album folder through the optional
 * Synology service account. The folder listing is cached briefly so opening
 * the same album repeatedly does not query the NAS every time.
 */
export class ArtworkService {
  private readonly dsm: DsmClient | null;
  private readonly pdfLists = new Map<string, PdfListEntry>();
  private readonly pendingLists = new Map<string, Promise<AlbumPdf[]>>();
  private readonly originalCovers = new Map<string, OriginalCoverEntry>();
  private lastErrorLog = 0;

  constructor() {
    this.dsm = config.dsm ? new DsmClient(config.dsm) : null;
    console.log(
      this.dsm
        ? `[artwork] Synology FileStation artwork enabled (${config.dsm?.url})`
        : '[artwork] Synology artwork disabled (set DSM_URL/DSM_USER/DSM_PASS or DSADDR/DSUSER/DSPASSWD)',
    );
  }

  async listArtworks(filePath: string): Promise<AlbumPdf[]> {
    const dsm = this.dsm;
    if (!dsm) return [];

    const folder = albumFolderPathFor(filePath);
    if (!folder) return [];

    const now = Date.now();
    const cached = this.pdfLists.get(folder);
    if (cached && cached.expiresAt > now) {
      this.pdfLists.delete(folder);
      this.pdfLists.set(folder, cached);
      return cached.pdfs;
    }
    if (cached) this.pdfLists.delete(folder);

    const inFlight = this.pendingLists.get(folder);
    if (inFlight) return inFlight;

    const load = this.loadPdfList(dsm, folder).finally(() => {
      this.pendingLists.delete(folder);
    });
    this.pendingLists.set(folder, load);
    return load;
  }

  async openArtwork(
    filePath: string,
    filename: string,
    range?: string,
  ): Promise<FileStream | null> {
    const dsm = this.dsm;
    if (!dsm || !isPdfFilename(filename)) return null;

    const folder = albumFolderPathFor(filePath);
    if (!folder) return null;

    try {
      return await dsm.openFile(`${folder}/${filename}`, range);
    } catch (error) {
      this.logError(error);
      throw error;
    }
  }

  /**
   * Open a full-resolution album cover from the album folder. Synology's
   * AudioStation cover API only serves a 480px JPEG; the original is usually
   * `Folder.jpg` (or a similarly named image) next to the tracks.
   */
  async openOriginalCover(
    filePath: string,
    range?: string,
  ): Promise<FileStream | null> {
    const dsm = this.dsm;
    if (!dsm) return null;

    const folder = albumFolderPathFor(filePath);
    if (!folder) return null;

    const path = await this.findOriginalCover(dsm, folder);
    if (!path) return null;

    try {
      return await dsm.openFile(path, range, {
        accept: 'image/*',
        contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
      });
    } catch (error) {
      this.originalCovers.delete(folder);
      this.logError(error);
      throw error;
    }
  }

  private async findOriginalCover(
    dsm: DsmClient,
    folder: string,
  ): Promise<string | null> {
    const now = Date.now();
    const cached = this.originalCovers.get(folder);
    if (cached && cached.expiresAt > now) {
      this.originalCovers.delete(folder);
      this.originalCovers.set(folder, cached);
      return cached.path;
    }
    this.originalCovers.delete(folder);

    for (const name of ORIGINAL_COVER_NAMES) {
      const path = `${folder}/${name}`;
      let exists: boolean;
      try {
        exists = await dsm.fileExists(path);
      } catch (error) {
        this.logError(error);
        return null;
      }
      if (!exists) continue;

      this.storeOriginalCover(folder, path);
      return path;
    }

    this.storeOriginalCover(folder, null);
    return null;
  }

  private storeOriginalCover(folder: string, path: string | null): void {
    this.originalCovers.delete(folder);
    this.originalCovers.set(folder, {
      path,
      expiresAt:
        Date.now() + (path ? AVAILABLE_TTL_MS : MISSING_TTL_MS),
    });
    while (this.originalCovers.size > MAX_CACHE_ENTRIES) {
      const oldest = this.originalCovers.keys().next().value;
      if (oldest === undefined) break;
      this.originalCovers.delete(oldest);
    }
  }

  private async loadPdfList(
    dsm: DsmClient,
    folder: string,
  ): Promise<AlbumPdf[]> {
    let pdfs: AlbumPdf[] = [];
    try {
      const files = await dsm.listFiles(folder);
      pdfs = files
        .filter((file) => !file.isdir && isPdfFilename(file.name))
        .map((file) => ({ name: file.name, label: pdfLabelFor(file.name) }))
        .sort((left, right) => comparePdfNames(left.name, right.name));
    } catch (error) {
      this.logError(error);
    }

    this.storePdfList(folder, pdfs);
    return pdfs;
  }

  private storePdfList(folder: string, pdfs: AlbumPdf[]): void {
    this.pdfLists.delete(folder);
    this.pdfLists.set(folder, {
      pdfs,
      expiresAt:
        Date.now() + (pdfs.length > 0 ? AVAILABLE_TTL_MS : MISSING_TTL_MS),
    });

    while (this.pdfLists.size > MAX_CACHE_ENTRIES) {
      const oldest = this.pdfLists.keys().next().value;
      if (oldest === undefined) break;
      this.pdfLists.delete(oldest);
    }
  }

  private logError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLog = now;
    console.error(
      '[artwork] FileStation request failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

export const artwork = new ArtworkService();
