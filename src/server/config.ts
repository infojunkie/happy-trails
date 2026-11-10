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

/**
 * Parse TRUST_PROXY for Express's "trust proxy" setting.
 *
 * A boolean enables/disables it, a number is a hop count, and anything else
 * is passed to Express as a preset ("loopback") or comma-separated subnet
 * list. Enable this only when the app sits behind a trusted reverse proxy, so
 * X-Forwarded-For cannot be spoofed by direct clients.
 */
export function parseTrustProxy(
  rawValue: string | undefined,
): boolean | number | string {
  const raw = (rawValue ?? '').trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
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
  'accompanied by',
  'com',
  'part.',
  'avec',
  'with',
  'et',
  'e',
  'con',
  'y',
  'و',
  'vs.',
  'mit',
];

function commaSeparatedEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  return raw
    ? raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

function artistSeparatorWords(): string[] {
  return [
    ...DEFAULT_ARTIST_SEPARATOR_WORDS,
    ...commaSeparatedEnv('ARTIST_SEPARATOR_WORDS'),
  ];
}

/**
 * Possessive determiners that introduce a backing-ensemble description. Once
 * one is seen, the rest of the artist string is ignored. Defaults cover the
 * third-person forms used in English, French, Portuguese, and Spanish.
 */
const DEFAULT_ARTIST_POSSESSIVES = [
  'his',
  'her',
  'their',
  'its',
  'son',
  'sa',
  'ses',
  'leur',
  'leurs',
  'seu',
  'sua',
  'seus',
  'suas',
  'su',
  'sus',
];

function artistPossessives(): string[] {
  return [
    ...DEFAULT_ARTIST_POSSESSIVES,
    ...commaSeparatedEnv('ARTIST_POSSESSIVES'),
  ];
}

/** Artist names whose punctuation must not be treated as a separator. */
function artistExceptions(): string[] {
  const raw = process.env.ARTIST_EXCEPTIONS?.trim();
  // Exceptions contain commas, so this list uses "|" as its separator.
  return raw
    ? raw
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
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
  /** Fixed frontend URL, or null when the request origin is used. */
  url: string | null;
  /** Port to apply to an allow-listed request origin; null for a fixed URL. */
  originPort: number | null;
}

function fallbackTarget(fallback: string): DsmFrontendTarget {
  return {
    url: fallback.trim() || null,
    originPort: null,
  };
}

function parseOriginPort(raw: string): number | null {
  const match = /^:(\d+)$/.exec(raw);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port;
}

/**
 * Parse DSM_FRONTEND_URL:
 * - empty: fall back to DSM_URL/DSADDR
 * - full http(s) URL: use verbatim
 * - ":<port>": keep the host the browser used and change only the port
 *
 * Path rewriting is deliberately not supported. The redirect host is never
 * derived from an arbitrary request header; it must match
 * DSM_FRONTEND_ALLOWED_ORIGINS.
 */
export function parseDsmFrontendUrl(
  rawValue: string | undefined,
  fallback: string,
): DsmFrontendTarget {
  const raw = (rawValue ?? '').trim();
  if (!raw) return fallbackTarget(fallback);

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(
        `DSM_FRONTEND_URL must be an http(s) URL or ":port", got "${raw}"`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(
        `DSM_FRONTEND_URL must be an http(s) URL or ":port", got "${raw}"`,
      );
    }
    return { url: raw, originPort: null };
  }

  const originPort = parseOriginPort(raw);
  if (originPort === null) {
    throw new Error(
      `DSM_FRONTEND_URL must be an http(s) URL or ":port", got "${raw}"`,
    );
  }
  return { url: null, originPort };
}

/**
 * Parse DSM_FRONTEND_ALLOWED_ORIGINS: comma-separated exact origins the app is
 * served from (for example "https://nas.example:8443,https://nas-local").
 * Only a request host that matches one of these origins can select a redirect
 * target, so an arbitrary Host/X-Forwarded-Host value cannot leave the list.
 */
export function parseAllowedFrontendOrigins(
  rawValue: string | undefined,
): string[] {
  const raw = (rawValue ?? '').trim();
  if (!raw) return [];

  const origins = new Set<string>();
  for (const entry of raw.split(',')) {
    const value = entry.trim();
    if (!value) continue;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        `DSM_FRONTEND_ALLOWED_ORIGINS entry must be an absolute origin, got "${value}"`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(
        `DSM_FRONTEND_ALLOWED_ORIGINS entry must be an http(s) origin, got "${value}"`,
      );
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      throw new Error(
        `DSM_FRONTEND_ALLOWED_ORIGINS entry must not include a path or credentials, got "${value}"`,
      );
    }
    origins.add(url.origin);
  }
  return [...origins];
}

/** Apply a configured port to an HTTP(S) origin. */
export function formatOriginTarget(
  origin: string,
  originPort: number | null,
): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = '/';
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
  if (target.originPort === null || !origin) return null;
  return formatOriginTarget(origin, target.originPort);
}

const frontendTarget = parseDsmFrontendUrl(
  process.env.DSM_FRONTEND_URL,
  dsmUrl,
);
const dsmFrontendAllowedOrigins = parseAllowedFrontendOrigins(
  process.env.DSM_FRONTEND_ALLOWED_ORIGINS,
);
if (
  frontendTarget.url === null &&
  frontendTarget.originPort !== null &&
  dsmFrontendAllowedOrigins.length === 0
) {
  throw new Error(
    'DSM_FRONTEND_ALLOWED_ORIGINS is required when DSM_FRONTEND_URL is ":port"',
  );
}
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
  /** Failed sign-ins allowed per client IP per window. */
  loginRateLimitMax: integerFromEnv('LOGIN_RATE_LIMIT_MAX', 20, 1),
  /** Failed sign-ins allowed per account per window. */
  loginAccountLimitMax: integerFromEnv('LOGIN_ACCOUNT_LIMIT_MAX', 5, 1),
  loginRateLimitWindowMs: integerFromEnv(
    'LOGIN_RATE_LIMIT_WINDOW_MS',
    15 * 60_000,
    1_000,
  ),
  /** Express "trust proxy" value; off unless the app is behind a proxy. */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  /** Words that separate multiple artists; ARTIST_SEPARATOR_WORDS adds more. */
  artistSeparatorWords: artistSeparatorWords(),
  /** Possessives that discard the rest of the artist string. */
  artistPossessives: artistPossessives(),
  /** Names kept intact; ARTIST_EXCEPTIONS supplies them, separated by "|". */
  artistExceptions: artistExceptions(),
  /** Additional genre tags to treat as countries/regions. */
  regionTags: regionTags(),
  /** Required for user sign-in and playback. */
  dsmUrl: dsmUrl.length > 0 ? dsmUrl : null,
  dsmFrontendUrl: frontendTarget.url,
  dsmFrontendPort: frontendTarget.originPort,
  /** Exact app origins allowed to select an origin-based redirect target. */
  dsmFrontendAllowedOrigins,
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
