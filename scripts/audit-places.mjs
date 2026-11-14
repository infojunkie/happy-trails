import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { isRegionTag } from '../src/server/regions.ts';
import { NON_PLACE_TAGS, PLACE_CATALOG } from '../src/shared/placeCatalog.ts';
import { resolvePlace } from '../src/shared/placeLookup.ts';
import { regionKey } from '../src/shared/text.ts';
import { normalizeAlbumName } from '../src/server/search.ts';

/**
 * Live-library audit for map places. Requires PostgreSQL access (.env).
 * Run with: npm run audit:places
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'happy-trails');
const placesPath = path.join(root, 'public', 'map', 'places.json');
const gazetteerUrl =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places.geojson';

const nonPlaceKeys = new Set(NON_PLACE_TAGS.map(regionKey));
const splitTag = (raw) =>
  raw
    .split(/[,/+]/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

async function loadGeneratedPlaces() {
  try {
    return JSON.parse(await fs.readFile(placesPath, 'utf8'));
  } catch {
    throw new Error(
      `Missing ${path.relative(root, placesPath)}. Run "npm run build:places" first.`,
    );
  }
}

async function loadGazetteer() {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, 'ne_50m_populated_places.geojson');
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    console.log('[audit] downloading the city gazetteer');
    const response = await fetch(gazetteerUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Gazetteer download failed: ${response.status}`);
    }
    data = await response.json();
    await fs.writeFile(file, JSON.stringify(data), 'utf8');
  }

  const cities = new Map();
  for (const feature of data.features) {
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry.coordinates;
    const entry = {
      name: p.NAME ?? p.NAMEASCII ?? '',
      country: p.ADM0NAME ?? '',
      pop: p.POP_MAX ?? 0,
      lat,
      lon,
    };
    for (const name of new Set([
      p.NAME,
      p.NAMEASCII,
      p.NAME_EN,
      p.NAME_DE,
      p.NAME_FR,
      p.NAME_ES,
      p.NAME_PT,
      p.NAME_IT,
    ])) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = regionKey(name);
      if (!key) continue;
      let list = cities.get(key);
      if (!list) cities.set(key, (list = []));
      list.push(entry);
    }
  }
  return cities;
}

const generated = await loadGeneratedPlaces();
const cities = await loadGazetteer();

const pool = new pg.Pool();
const { rows } = await pool.query(`
  SELECT m.album AS album,
    COALESCE(NULLIF(m.album_artist,''), NULLIF(m.artist,''), 'Unknown Artist') AS artist,
    string_agg(DISTINCT m.genre, ',') AS genres
  FROM ${process.env.MUSIC_SCHEMA || 'public'}.${process.env.MUSIC_TABLE || 'music'} m
  WHERE m.fs_online IS NOT FALSE
  GROUP BY 1, 2
`);
await pool.end();

const albums = [];
const rawTagAlbums = new Map();
const tagAlbums = new Map();
const tagDisplay = new Map();
const rawKeys = new Set();

for (const row of rows) {
  const album = row.album == null || row.album.trim() === '' ? '(Unknown Album)' : normalizeAlbumName(row.album);
  const acc = {
    album,
    artist: row.artist,
    raw: new Set(),
    expanded: new Map(),
  };
  for (const part of (row.genres ?? '').split(',')) {
    const raw = part.trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    acc.raw.add(raw);
    rawKeys.add(regionKey(raw));
    rawTagAlbums.set(raw, (rawTagAlbums.get(raw) ?? 0) + 1);
    for (const piece of splitTag(raw)) {
      const key = regionKey(piece);
      if (!key) continue;
      acc.expanded.set(key, piece);
      if (!tagDisplay.has(key)) tagDisplay.set(key, piece);
    }
  }
  albums.push(acc);
}

for (const acc of albums) {
  for (const key of acc.expanded.keys()) {
    tagAlbums.set(key, (tagAlbums.get(key) ?? 0) + 1);
  }
}

const displayFor = (key) => tagDisplay.get(key) ?? key;
const expandedKeys = new Set(tagDisplay.keys());

let rawRegionAlbums = 0;
let expandedRegionAlbums = 0;
let rawResolvedAlbums = 0;
let expandedResolvedAlbums = 0;
const unresolved = new Map();
const cityCandidates = new Map();

for (const acc of albums) {
  const rawRegions = [...acc.raw].filter(isRegionTag);
  const expandedRegions = [...acc.expanded.values()].filter(isRegionTag);
  if (rawRegions.length > 0) rawRegionAlbums += 1;
  if (expandedRegions.length > 0) expandedRegionAlbums += 1;
  if (rawRegions.some((name) => resolvePlace(name, generated))) rawResolvedAlbums += 1;
  if (expandedRegions.some((name) => resolvePlace(name, generated))) expandedResolvedAlbums += 1;

  for (const name of expandedRegions) {
    if (!resolvePlace(name, generated)) {
      const key = regionKey(name);
      unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
    }
  }
  for (const [key, name] of acc.expanded) {
    if (isRegionTag(name) || nonPlaceKeys.has(regionKey(name))) continue;
    if (cities.has(regionKey(name))) {
      cityCandidates.set(key, (cityCandidates.get(key) ?? 0) + 1);
    }
  }
}

const sortedUnresolved = [...unresolved].sort((a, b) => b[1] - a[1]);
const sortedCities = [...cityCandidates].sort((a, b) => b[1] - a[1]);

console.log('=== Live library place audit ===');
console.log('merged albums:', albums.length);
console.log(
  `region-tagged albums: raw ${rawRegionAlbums} | after /+ split ${expandedRegionAlbums}`,
);
console.log(
  `albums with at least one resolvable region: raw ${rawResolvedAlbums} | after /+ split ${expandedResolvedAlbums}`,
);

console.log(`\nUnresolved region tags (${sortedUnresolved.length}):`);
for (const [key, count] of sortedUnresolved.slice(0, 60)) {
  console.log(`${String(count).padStart(4)}  ${displayFor(key)}`);
}

console.log(`\nCity candidates not in the catalog (${sortedCities.length}):`);
for (const [key, count] of sortedCities.slice(0, 60)) {
  const matches = (cities.get(regionKey(displayFor(key))) ?? [])
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 2);
  const detail = matches
    .map((m) => `${m.name}, ${m.country} (${m.pop})`)
    .join(' / ');
  console.log(`${String(count).padStart(4)}  ${displayFor(key)}  ->  ${detail}`);
}

const placeCompounds = [...rawTagAlbums]
  .filter(([tag]) => /[/+]/.test(tag))
  .map(([tag, count]) => {
    const pieces = splitTag(tag);
    const placePieces = pieces.filter(
      (piece) =>
        isRegionTag(piece) ||
        cities.has(regionKey(piece)) ||
        nonPlaceKeys.has(regionKey(piece)),
    );
    return { tag, count, pieces, placePieces };
  })
  .filter((entry) => entry.placePieces.length > 0)
  .sort((a, b) => b.count - a.count);

console.log(`\nCompound tags with place parts (${placeCompounds.length}):`);
for (const entry of placeCompounds.slice(0, 40)) {
  const marked = entry.pieces
    .map((piece) => (entry.placePieces.includes(piece) ? `[${piece}]` : piece))
    .join(' / ');
  console.log(`${String(entry.count).padStart(4)}  ${entry.tag}  ->  ${marked}`);
}

const stale = [];
for (const entry of PLACE_CATALOG) {
  const keys = [entry.name, ...(entry.aliases ?? [])].map(regionKey);
  if (!keys.some((key) => expandedKeys.has(key) || rawKeys.has(key))) {
    stale.push(entry.name);
  }
}
console.log(`\nCatalog entries not seen in the live library (${stale.length}):`);
if (stale.length > 0) console.log(stale.sort().join(', '));
