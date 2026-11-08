import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load happy-trails/.env first, then the workspace-level .env one directory up
// (which holds DSADDR/DSUSER/DSPASSWD for the existing Synology scripts).
// dotenv never overrides values that are already present.
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
for (const envPath of [
  path.join(projectRoot, '.env'),
  path.resolve(projectRoot, '..', '.env'),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

function integerFromEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function identifierFromEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${name} must be a plain SQL identifier, got "${value}"`);
  }
  return value;
}

const DEFAULT_ARTIST_SEPARATOR_WORDS = [
  'feat.',
  'com',
  'part.',
  'avec',
  'with',
  'et',
  'e',
  'con',
  'vs.',
  'mit',
];

function artistSeparatorWords(): string[] {
  const raw = process.env.ARTIST_SEPARATOR_WORDS?.trim();
  const extra = raw
    ? raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return [...DEFAULT_ARTIST_SEPARATOR_WORDS, ...extra];
}

/** Artist names whose punctuation must not be treated as a separator. */
const DEFAULT_ARTIST_EXCEPTIONS = [
  'Earth, Wind & Fire',
  'Simon & Garfunkel',
  'Crosby, Stills, Nash & Young',
];

function artistExceptions(): string[] {
  const raw = process.env.ARTIST_EXCEPTIONS?.trim();
  // Exceptions contain commas, so this list uses "|" as its separator.
  const extra = raw
    ? raw
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return [...DEFAULT_ARTIST_EXCEPTIONS, ...extra];
}

/** Extra genre tags to classify as countries/regions; REGION_TAGS adds more. */
function regionTags(): string[] {
  const raw = process.env.REGION_TAGS?.trim();
  return raw
    ? raw
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

const dsmUrl = (process.env.DSM_URL ?? process.env.DSADDR ?? '').trim();

export interface DsmFrontendTarget {
  /** Fixed frontend URL, or null when origin-based formatting is used. */
  url: string | null;
  /** Path to apply to the request origin, or null for a fixed URL. */
  originPath: string | null;
  /** Port to apply to the request origin; null preserves its port. */
  originPort: number | null;
}

function fallbackTarget(fallback: string): DsmFrontendTarget {
  return {
    url: fallback.trim() || null,
    originPath: null,
    originPort: null,
  };
}

function parseOriginSpec(
  raw: string,
): { originPath: string; originPort: number | null } | null {
  let pathPart = raw;
  let originPort: number | null = null;

  const portMatch = /^(.*):(\d+)$/.exec(raw);
  if (portMatch) {
    const port = Number(portMatch[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    originPort = port;
    pathPart = portMatch[1] ?? '';
  }

  let originPath = pathPart.trim();
  if (!originPath) originPath = '/';
  if (!originPath.startsWith('/')) originPath = `/${originPath}`;
  return { originPath, originPort };
}

/**
 * Parse DSM_FRONTEND_URL:
 * - empty: fall back to DSM_URL/DSADDR
 * - full http(s) URL: use verbatim
 * - otherwise: "[path][:port]" applied to each request's origin
 *   (path defaults to "/"; an omitted port preserves the origin port)
 */
export function parseDsmFrontendUrl(
  rawValue: string | undefined,
  fallback: string,
): DsmFrontendTarget {
  const raw = (rawValue ?? '').trim();
  if (!raw) return fallbackTarget(fallback);

  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { url: raw, originPath: null, originPort: null };
    }
    // A non-HTTP absolute URL is not a usable frontend target.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
      return fallbackTarget(fallback);
    }
  } catch {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
      return fallbackTarget(fallback);
    }
  }

  const spec = parseOriginSpec(raw);
  if (!spec) return fallbackTarget(fallback);
  return { url: null, ...spec };
}

/** Apply a configured path and optional port to an HTTP(S) origin. */
export function formatOriginTarget(
  origin: string,
  originPath: string,
  originPort: number | null,
): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = originPath;
    url.search = '';
    url.hash = '';
    if (originPort !== null) url.port = String(originPort);
    return url.toString();
  } catch {
    return null;
  }
}

/** Resolve a parsed frontend target for one request. */
export function resolveDsmFrontendBase(
  target: DsmFrontendTarget,
  origin: string | null,
): string | null {
  if (target.url !== null) return target.url;
  if (target.originPath === null || !origin) return null;
  return formatOriginTarget(origin, target.originPath, target.originPort);
}

const frontendTarget = parseDsmFrontendUrl(
  process.env.DSM_FRONTEND_URL,
  dsmUrl,
);
const dsmUser = (process.env.DSM_USER ?? process.env.DSUSER ?? '').trim();
const dsmPass = process.env.DSM_PASS ?? process.env.DSPASSWD ?? '';
const dsmConfigured =
  dsmUrl.length > 0 && dsmUser.length > 0 && dsmPass.length > 0;
const dsmTimeoutMs = integerFromEnv('DSM_TIMEOUT_MS', 10_000, 1);
/** The NAS usually has a self-signed certificate. */
const dsmRejectUnauthorized = booleanFromEnv(
  'DSM_TLS_REJECT_UNAUTHORIZED',
  false,
);

export const config = {
  host: process.env.HOST?.trim() || '127.0.0.1',
  port: integerFromEnv('PORT', 3000, 1),
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  schema: identifierFromEnv('MUSIC_SCHEMA', 'public'),
  table: identifierFromEnv('MUSIC_TABLE', 'music'),
  trackTable: identifierFromEnv('TRACK_TABLE', 'track'),
  /** How often the music table is checked for changes. */
  checkIntervalMs: Math.max(
    10_000,
    integerFromEnv(
      'LIBRARY_CHECK_MS',
      integerFromEnv('LIBRARY_REFRESH_MS', 60_000, 1),
      1,
    ),
  ),
  statementTimeoutMs: integerFromEnv('DB_STATEMENT_TIMEOUT_MS', 30_000, 1),
  defaultPageSize: integerFromEnv('PAGE_SIZE', 48, 1),
  maxPageSize: integerFromEnv('MAX_PAGE_SIZE', 200, 1),
  /** Words that separate multiple artists; ARTIST_SEPARATOR_WORDS adds more. */
  artistSeparatorWords: artistSeparatorWords(),
  /** Names kept intact; ARTIST_EXCEPTIONS adds more, separated by "|". */
  artistExceptions: artistExceptions(),
  /** Additional genre tags to treat as countries/regions. */
  regionTags: regionTags(),
  /** Required for user sign-in and playback. */
  dsmUrl: dsmUrl.length > 0 ? dsmUrl : null,
  dsmFrontendUrl: frontendTarget.url,
  dsmFrontendPath: frontendTarget.originPath,
  dsmFrontendPort: frontendTarget.originPort,
  dsmTimeoutMs,
  dsmRejectUnauthorized,
  /**
   * Optional service account used only for album covers. Users sign in with
   * their own DSM credentials for playback.
   */
  dsm: dsmConfigured
    ? {
        url: dsmUrl,
        user: dsmUser,
        pass: dsmPass,
        timeoutMs: dsmTimeoutMs,
        rejectUnauthorized: dsmRejectUnauthorized,
      }
    : null,
  coverCacheTtlMs: integerFromEnv('COVER_CACHE_TTL_MS', 24 * 60 * 60_000, 0),
  coverCacheEntries: integerFromEnv('COVER_CACHE_ENTRIES', 500, 0),
} as const;

/** Schema-qualified, quoted table names. All parts are validated identifiers. */
export const musicTable = `"${config.schema}"."${config.table}"`;
export const trackTable = `"${config.schema}"."${config.trackTable}"`;
