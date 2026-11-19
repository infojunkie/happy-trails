import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AboutPerson, AboutResponse } from '../shared/types.js';

interface RawPerson {
  name?: unknown;
  email?: unknown;
  url?: unknown;
  web?: unknown;
}

interface RawPackage {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  contributors?: unknown;
  bugs?: unknown;
  homepage?: unknown;
}

const PACKAGE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../package.json',
);

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function person(value: unknown): AboutPerson | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name, url: null } : null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const record = value as RawPerson;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return null;
  return {
    name,
    url: safeUrl(record.web ?? record.url),
  };
}

function people(value: unknown): AboutPerson[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(person)
    .filter((entry): entry is AboutPerson => entry !== null);
}

function bugsUrl(value: unknown): string | null {
  if (typeof value === 'string') return safeUrl(value);
  if (typeof value !== 'object' || value === null) return null;
  return safeUrl((value as { url?: unknown }).url);
}

function loadAbout(): AboutResponse {
  let pkg: RawPackage = {};
  try {
    pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')) as RawPackage;
  } catch (error) {
    console.error('[about] could not read package.json:', error);
  }

  return {
    name: typeof pkg.name === 'string' ? pkg.name : 'happy-trails',
    version: typeof pkg.version === 'string' ? pkg.version : '',
    description: typeof pkg.description === 'string' ? pkg.description : '',
    author: person(pkg.author),
    contributors: people(pkg.contributors),
    issuesUrl: bugsUrl(pkg.bugs),
    homepageUrl: safeUrl(pkg.homepage),
  };
}

/** Package metadata shown in the Help dialog's About section. */
export const about = loadAbout();
