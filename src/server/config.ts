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

const dsmUrl = (process.env.DSM_URL ?? process.env.DSADDR ?? '').trim();
const dsmFrontendUrl = (process.env.DSM_FRONTEND_URL ?? dsmUrl).trim();
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
  /** Required for user sign-in and playback. */
  dsmUrl: dsmUrl.length > 0 ? dsmUrl : null,
  dsmFrontendUrl: dsmFrontendUrl.length > 0 ? dsmFrontendUrl : null,
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
