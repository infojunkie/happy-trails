import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionKey } from '../src/shared/text.ts';

/**
 * Regenerates the static map data from Natural Earth (public domain):
 *
 *   public/map/places.json       folded country name -> location
 *   public/map/world-110m.geojson  compact world basemap
 *
 * Run with: npm run build:places
 * Manual places (cities, subnational regions, overrides) live in
 * src/shared/placeCatalog.ts and are merged over this generated data.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'happy-trails');
const outDir = path.join(root, 'public', 'map');
const refresh = process.argv.includes('--refresh');
const locales = ['en', 'fr', 'de', 'es', 'pt', 'it'];
const sources = {
  places: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
    file: 'ne_50m_admin_0_countries.geojson',
  },
  basemap: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    file: 'ne_110m_admin_0_countries.geojson',
  },
};

const round = (value, digits) => Number(value.toFixed(digits));

async function download({ url, file }) {
  await fs.mkdir(cacheDir, { recursive: true });
  const target = path.join(cacheDir, file);
  if (!refresh) {
    try {
      await fs.access(target);
      return JSON.parse(await fs.readFile(target, 'utf8'));
    } catch {
      // Cache miss; fetch below.
    }
  }
  console.log(`[places] downloading ${file}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const text = await response.text();
  await fs.writeFile(target, text, 'utf8');
  return JSON.parse(text);
}

function isoCode(properties) {
  const raw =
    properties.ISO_A2_EH ??
    properties.ISO_A2 ??
    properties.WB_A2 ??
    '';
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

function countryName(properties) {
  return (
    properties.NAME_EN ??
    properties.NAME ??
    properties.ADMIN ??
    properties.SOVEREIGNT ??
    ''
  ).trim();
}

function buildPlaces(geojson) {
  const features = [...geojson.features].sort((left, right) => {
    const a = isoCode(left.properties) ?? '';
    const b = isoCode(right.properties) ?? '';
    return a.localeCompare(b) || countryName(left.properties).localeCompare(countryName(right.properties));
  });
  const displays = new Map(
    locales.map((locale) => [
      locale,
      new Intl.DisplayNames([locale], { type: 'region' }),
    ]),
  );
  const places = {};
  const seenIso = new Set();
  const collisions = [];

  const add = (name, entry) => {
    const key = regionKey(name);
    if (!key) return;
    const existing = places[key];
    if (existing && existing.countryCode !== entry.countryCode) {
      collisions.push(`${key}: ${existing.countryCode} vs ${entry.countryCode}`);
      return;
    }
    places[key] = entry;
  };

  for (const feature of features) {
    const properties = feature.properties ?? {};
    const code = isoCode(properties);
    if (!code || seenIso.has(code)) continue;
    const lat = Number(properties.LABEL_Y);
    const lon = Number(properties.LABEL_X);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    seenIso.add(code);
    const entry = {
      name: countryName(properties) || code,
      tier: 'country',
      countryCode: code,
      lat: round(lat, 3),
      lon: round(lon, 3),
    };

    for (const name of new Set([
      properties.NAME,
      properties.NAME_EN,
      properties.NAME_LONG,
      properties.ADMIN,
    ])) {
      if (typeof name === 'string' && name.trim()) add(name, entry);
    }
    for (const display of displays.values()) {
      let localized;
      try {
        localized = display.of(code);
      } catch {
        continue;
      }
      if (!localized || localized === code || /^unknown\b/i.test(localized)) {
        continue;
      }
      add(localized, entry);
    }
  }

  if (collisions.length > 0) {
    console.warn(`[places] skipped ${collisions.length} name collisions:`);
    for (const collision of collisions.slice(0, 20)) console.warn(`  ${collision}`);
  }

  return {
    source: 'Natural Earth 1:50m admin-0 countries (public domain)',
    places: Object.fromEntries(
      Object.entries(places).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

function roundCoordinates(value, digits) {
  if (Array.isArray(value)) return value.map((item) => roundCoordinates(item, digits));
  return typeof value === 'number' ? round(value, digits) : value;
}

function buildBasemap(geojson) {
  return {
    type: 'FeatureCollection',
    name: 'natural-earth-110m-countries',
    attribution: 'Natural Earth (public domain)',
    features: geojson.features
      .filter((feature) => feature.geometry)
      .map((feature) => ({
        type: 'Feature',
        properties: {
          name: countryName(feature.properties ?? {}),
          iso: isoCode(feature.properties ?? {}),
        },
        geometry: {
          type: feature.geometry.type,
          coordinates: roundCoordinates(feature.geometry.coordinates, 2),
        },
      })),
  };
}

const placesSource = await download(sources.places);
const basemapSource = await download(sources.basemap);
const places = buildPlaces(placesSource);
const basemap = buildBasemap(basemapSource);

await fs.mkdir(outDir, { recursive: true });
const placesPath = path.join(outDir, 'places.json');
const basemapPath = path.join(outDir, 'world-110m.geojson');
await fs.writeFile(placesPath, JSON.stringify(places), 'utf8');
await fs.writeFile(basemapPath, JSON.stringify(basemap), 'utf8');

const kb = async (file) => `${(await fs.stat(file)).size / 1024}`;
console.log(
  `[places] ${Object.keys(places.places).length} names, ${await kb(placesPath)} KB -> ${path.relative(root, placesPath)}`,
);
console.log(
  `[places] ${basemap.features.length} features, ${await kb(basemapPath)} KB -> ${path.relative(root, basemapPath)}`,
);
