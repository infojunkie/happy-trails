/**
 * Keep unit and fixture tests independent of the developer's .env.
 *
 * This module must be loaded before any app module imports config (the test
 * scripts use `node --import`); config snapshots these values at import time,
 * so setting them in a `before()` hook would be too late.
 *
 * Empty strings win over dotenv, which never overrides an existing
 * process.env entry, so the config helpers fall back to their built-in
 * defaults.
 */
const TEST_ENV_DEFAULTS = [
  'SERIES_ALLOWLIST',
  'SERIES_EXCEPTIONS',
  'ARTIST_SEPARATOR_WORDS',
  'ARTIST_EXCEPTIONS',
  'REGION_TAGS',
  'LOOSE_TRACKS_FOLDERS',
] as const;

for (const name of TEST_ENV_DEFAULTS) {
  process.env[name] = '';
}
