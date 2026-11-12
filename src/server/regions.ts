import { regionKey } from '../shared/text.js';
import { config } from './config.js';

/**
 * Country/region detection for genre tags.
 *
 * ISO 3166 country names are generated with Intl.DisplayNames in the languages
 * that commonly appear in the catalogue. A curated list adds continents,
 * subnational regions, historical countries, and spelling variants that CLDR
 * does not provide. `REGION_TAGS` appends site-specific names.
 *
 * Matching is exact (after folding case, accents, and apostrophe variants), so
 * compound tags such as "Jazz/Brazil" remain genres until a separate splitting
 * pass is introduced.
 */
const LOCALES = ['en', 'fr', 'de', 'es', 'pt', 'it'];

/** UN M49 codes for continents and macro-regions. */
const M49_CODES = [
  '002', '003', '005', '009', '011', '013', '014', '015', '017',
  '018', '019', '021', '029', '030', '034', '035', '039', '053', '054',
  '057', '061', '142', '143', '145', '150', '151', '154', '155', '202',
  '419',
];

const REGION_ALIASES = [
  // Continents and macro-regions
  'Africa', 'Afrique', 'Americas', 'America', 'North America',
  'South America', 'Latin America', 'Central America', 'Caribbean',
  'Europe', 'Eastern Europe', 'Western Europe', 'Northern Europe',
  'Southern Europe', 'Central Europe', 'Asia', 'Central Asia',
  'Eastern Asia', 'South Asia', 'Southeast Asia', 'Western Asia',
  'Middle East', 'Mediterranean', 'North Africa', 'Northern Africa',
  'West Africa', 'Western Africa', 'East Africa', 'Eastern Africa',
  'Central Africa', 'Middle Africa', 'Southern Africa',
  'Sub-Saharan Africa', 'Balkans', 'Balkan', 'Baltic', 'Scandinavia',
  'South Pacific', 'Oceania', 'Polynesia', 'Melanesia', 'Micronesia',
  'Australasia',

  // Subnational regions, islands, and constituent countries
  'Andalusia', 'Basque', 'Basque Country', 'Bali', 'Borneo', 'Brittany',
  'Cape Breton', 'Catalonia', 'Cornwall', 'Corsica', 'Crete', 'Galicia',
  'Hawaii', 'Alaska', 'Java', 'Kurdistan', 'Ladakh', 'Moluccas',
  'Normandy', 'Occitania', 'Provence', 'Quebec', 'Québec', 'Sardinia',
  'Siberia', 'Sicily', 'Sápmi', 'Sámiland', 'Tibet', 'Torres Strait',
  'Tuva', 'Badakhshan', 'Baluchistan', 'Karakalpakstan',
  'England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland Republic',
  'Hong Kong', 'Macau', 'Macao', 'Palestine', 'Taiwan', 'Veracruz',
  'Rapa Nui',

  // Historical countries and spelling variants present in the catalogue
  'Burma', 'Byelorussia', 'Ceylon', 'Columbia',
  'Congo', 'Czech Republic', 'Czechoslovakia', 'Dem. Rep. of Congo',
  'East Germany', 'Ex-Yugoslavia', 'F.Y.R. Macedonia', 'Grece',
  'Great Britain', 'Ivory Coast', 'Macedonia', 'Moldavia', 'Netherland',
  'Rhodesia', 'Serbia and Montenegro', 'Soudan', 'Soviet Union',
  'South Ameria', 'Suisse', 'Swecen', 'Sween', 'Tanganyika',
  'The Gambia', 'Turkey', 'UK', 'USA', 'US', 'USSR',
  'United States of America', 'Upper Volta', 'West Germany', 'Yugoslavia',
  'Zaire',
];

function addName(target: Set<string>, name: string | undefined): void {
  if (!name) return;
  const key = regionKey(name);
  if (key) target.add(key);
}

function addIsoNames(target: Set<string>): void {
  const codes: string[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      codes.push(String.fromCharCode(first, second));
    }
  }
  codes.push(...M49_CODES);

  for (const locale of LOCALES) {
    let display: Intl.DisplayNames;
    try {
      display = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      continue;
    }

    for (const code of codes) {
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      if (!name || name === code || /^unknown\b/i.test(name)) continue;
      addName(target, name);
    }
  }
}

let cachedKeys: Set<string> | null = null;

function buildKeys(): Set<string> {
  const keys = new Set<string>();
  for (const alias of REGION_ALIASES) addName(keys, alias);
  for (const alias of config.regionTags) addName(keys, alias);
  addIsoNames(keys);
  return keys;
}

/** True when a genre tag is exactly a country or region name. */
export function isRegionTag(name: string): boolean {
  if (!cachedKeys) cachedKeys = buildKeys();
  return cachedKeys.has(regionKey(name));
}
