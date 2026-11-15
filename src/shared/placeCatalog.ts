import { regionKey } from './text.js';

/**
 * Manual place catalog used by region-tag recognition and map geolocation.
 *
 * Country names are generated from Natural Earth + Intl.DisplayNames; this
 * catalog supplies cities, subnational regions, macro-regions, historical
 * names, spelling variants, and explicit overrides for anything the generated
 * lookup gets wrong or does not cover.
 *
 * `countryCode` is an ISO 3166-1 alpha-2 code. It lets the map deduplicate
 * nested locations (Corsica hides France, Vancouver hides Canada) and resolve
 * ambiguous names using the album's other country tags.
 */
export type PlaceTier = 'city' | 'subnational' | 'country' | 'macro';

export interface PlaceCatalogEntry {
  /** Canonical display name. */
  name: string;
  /** Additional folded-name aliases that resolve here. */
  aliases?: readonly string[];
  tier: PlaceTier;
  /** ISO alpha-2 parent/sovereign country, when meaningful. */
  countryCode?: string;
  lat: number;
  lon: number;
}

/**
 * Tags that look like place names in a gazetteer but are genres or peoples in
 * this library. The audit script uses this list to avoid proposing them.
 */
export const NON_PLACE_TAGS: readonly string[] = [
  'Americana',
  'Berber',
  'Turkestan',
  'Roma',
];

export const TIER_RANK: Readonly<Record<PlaceTier, number>> = {
  city: 1,
  subnational: 2,
  country: 3,
  macro: 4,
};

export const PLACE_CATALOG: readonly PlaceCatalogEntry[] = [
  // ---- Cities ---------------------------------------------------------
  {
    name: 'Vancouver',
    tier: 'city',
    countryCode: 'CA',
    lat: 49.2827,
    lon: -123.1207,
  },
  {
    name: 'Lagos',
    tier: 'city',
    countryCode: 'NG',
    lat: 6.5244,
    lon: 3.3792,
  },

  // ---- Subnational regions, islands, and constituent countries --------
  {
    name: 'Zanzibar',
    tier: 'subnational',
    countryCode: 'TZ',
    lat: -6.1659,
    lon: 39.2026,
  },
  {
    name: 'Catalonia',
    aliases: ['Catalunya', 'Catalogne', 'Cataluña'],
    tier: 'subnational',
    countryCode: 'ES',
    lat: 41.5912,
    lon: 1.5209,
  },
  {
    name: 'Corsica',
    aliases: ['Corse', 'Córcega', 'Korsika'],
    tier: 'subnational',
    countryCode: 'FR',
    lat: 42.1523,
    lon: 9.1044,
  },
  {
    name: 'Occitania',
    aliases: ['Occitanie'],
    tier: 'subnational',
    countryCode: 'FR',
    lat: 43.6,
    lon: 2.0,
  },
  {
    name: 'Andalusia',
    aliases: ['Andalucia'],
    tier: 'subnational',
    countryCode: 'ES',
    lat: 37.5443,
    lon: -4.7278,
  },
  {
    name: 'Basque Country',
    aliases: ['Basque', 'Euskadi', 'Pais Vasco'],
    tier: 'subnational',
    countryCode: 'ES',
    lat: 42.9894,
    lon: -2.6189,
  },
  {
    name: 'Brittany',
    aliases: ['Bretagne'],
    tier: 'subnational',
    countryCode: 'FR',
    lat: 48.202,
    lon: -2.9326,
  },
  {
    name: 'Cornwall',
    tier: 'subnational',
    countryCode: 'GB',
    lat: 50.266,
    lon: -5.0527,
  },
  {
    name: 'Crete',
    aliases: ['Creta', 'Kreta'],
    tier: 'subnational',
    countryCode: 'GR',
    lat: 35.2401,
    lon: 24.895,
  },
  {
    name: 'Galicia',
    aliases: ['Galiza', 'Galice'],
    tier: 'subnational',
    countryCode: 'ES',
    lat: 42.5751,
    lon: -8.1339,
  },
  {
    name: 'Hawaii',
    tier: 'subnational',
    countryCode: 'US',
    lat: 19.8968,
    lon: -155.5828,
  },
  {
    name: 'Alaska',
    tier: 'subnational',
    countryCode: 'US',
    lat: 64.2008,
    lon: -149.4937,
  },
  {
    name: 'Java',
    tier: 'subnational',
    countryCode: 'ID',
    lat: -7.6145,
    lon: 110.7122,
  },
  {
    name: 'Kurdistan',
    tier: 'subnational',
    lat: 37.0,
    lon: 43.0,
  },
  {
    name: 'Ladakh',
    tier: 'subnational',
    countryCode: 'IN',
    lat: 34.2268,
    lon: 77.5619,
  },
  {
    name: 'Moluccas',
    aliases: ['Maluku'],
    tier: 'subnational',
    countryCode: 'ID',
    lat: -3.2385,
    lon: 130.1453,
  },
  {
    name: 'Normandy',
    aliases: ['Normandie'],
    tier: 'subnational',
    countryCode: 'FR',
    lat: 48.8799,
    lon: 0.172,
  },
  {
    name: 'Provence',
    tier: 'subnational',
    countryCode: 'FR',
    lat: 43.9,
    lon: 5.9,
  },
  {
    name: 'Quebec',
    tier: 'subnational',
    countryCode: 'CA',
    lat: 52.9399,
    lon: -73.5491,
  },
  {
    name: 'Sardinia',
    aliases: ['Sardegna', 'Sardaigne', 'Cerdeña'],
    tier: 'subnational',
    countryCode: 'IT',
    lat: 40.1209,
    lon: 9.0129,
  },
  {
    name: 'Siberia',
    aliases: ['Sibirien', 'Sibérie'],
    tier: 'subnational',
    countryCode: 'RU',
    lat: 60.0,
    lon: 100.0,
  },
  {
    name: 'Sicily',
    aliases: ['Sicilia', 'Sicile'],
    tier: 'subnational',
    countryCode: 'IT',
    lat: 37.599,
    lon: 14.0154,
  },
  {
    name: 'Sápmi',
    aliases: ['Samiland'],
    tier: 'subnational',
    lat: 68.0,
    lon: 25.0,
  },
  {
    name: 'Tibet',
    aliases: ['Xizang'],
    tier: 'subnational',
    countryCode: 'CN',
    lat: 30.1534,
    lon: 88.7879,
  },
  {
    name: 'Torres Strait',
    tier: 'subnational',
    countryCode: 'AU',
    lat: -10.5796,
    lon: 142.22,
  },
  {
    name: 'Tuva',
    aliases: ['Tyva'],
    tier: 'subnational',
    countryCode: 'RU',
    lat: 51.7191,
    lon: 94.4378,
  },
  {
    name: 'Badakhshan',
    tier: 'subnational',
    countryCode: 'AF',
    lat: 37.0,
    lon: 72.0,
  },
  {
    name: 'Baluchistan',
    aliases: ['Balochistan'],
    tier: 'subnational',
    countryCode: 'PK',
    lat: 28.5,
    lon: 65.5,
  },
  {
    name: 'Karakalpakstan',
    tier: 'subnational',
    countryCode: 'UZ',
    lat: 43.0,
    lon: 59.0,
  },
  {
    name: 'England',
    tier: 'subnational',
    countryCode: 'GB',
    lat: 52.5,
    lon: -1.5,
  },
  {
    name: 'Scotland',
    tier: 'subnational',
    countryCode: 'GB',
    lat: 56.5,
    lon: -4.2,
  },
  {
    name: 'Wales',
    tier: 'subnational',
    countryCode: 'GB',
    lat: 52.3,
    lon: -3.7,
  },
  {
    name: 'Northern Ireland',
    tier: 'subnational',
    countryCode: 'GB',
    lat: 54.6,
    lon: -6.7,
  },
  {
    name: 'Veracruz',
    tier: 'subnational',
    countryCode: 'MX',
    lat: 19.1738,
    lon: -96.1342,
  },
  {
    name: 'Rapa Nui',
    aliases: ['Easter Island', 'Isla de Pascua', 'Ile de Paques'],
    tier: 'subnational',
    countryCode: 'CL',
    lat: -27.1127,
    lon: -109.3497,
  },
  {
    name: 'Bali',
    tier: 'subnational',
    countryCode: 'ID',
    lat: -8.4095,
    lon: 115.1889,
  },
  {
    name: 'Borneo',
    tier: 'subnational',
    lat: 0.9619,
    lon: 114.5548,
  },
  {
    name: 'Cape Breton',
    tier: 'subnational',
    countryCode: 'CA',
    lat: 46.1667,
    lon: -60.75,
  },

  // ---- Macro-regions --------------------------------------------------
  {
    name: 'Africa',
    aliases: ['Afrique', 'Afrika'],
    tier: 'macro',
    lat: 0.0,
    lon: 20.0,
  },
  {
    name: 'North America',
    aliases: [
      'Northern America',
      'Amérique du Nord',
      'Nordamerika',
      'América del Norte',
      'América do Norte',
    ],
    tier: 'macro',
    lat: 48.0,
    lon: -100.0,
  },
  {
    name: 'South America',
    aliases: [
      'South Ameria',
      'Amérique du Sud',
      'Südamerika',
      'América del Sur',
      'América do Sul',
    ],
    tier: 'macro',
    lat: -15.0,
    lon: -60.0,
  },
  {
    name: 'Latin America',
    aliases: ['Amérique latine', 'Lateinamerika', 'América Latina'],
    tier: 'macro',
    lat: -10.0,
    lon: -70.0,
  },
  {
    name: 'Central America',
    aliases: ['Amérique centrale', 'Mittelamerika', 'América Central'],
    tier: 'macro',
    lat: 13.0,
    lon: -85.0,
  },
  {
    name: 'Caribbean',
    aliases: ['Caraïbes', 'Karibik', 'Caribe'],
    tier: 'macro',
    lat: 18.0,
    lon: -75.0,
  },
  {
    name: 'Europe',
    aliases: ['Europa'],
    tier: 'macro',
    lat: 50.0,
    lon: 15.0,
  },
  {
    name: 'Eastern Europe',
    aliases: ['Europe de l’Est', 'Osteuropa', 'Europa del Este', 'Europa Oriental'],
    tier: 'macro',
    lat: 52.0,
    lon: 30.0,
  },
  {
    name: 'Western Europe',
    aliases: [
      'Europe de l’Ouest',
      'Westeuropa',
      'Europa Occidental',
      'Europa Ocidental',
    ],
    tier: 'macro',
    lat: 48.0,
    lon: 5.0,
  },
  {
    name: 'Northern Europe',
    aliases: ['Europe du Nord', 'Nordeuropa', 'Europa del Norte'],
    tier: 'macro',
    lat: 60.0,
    lon: 15.0,
  },
  {
    name: 'Southern Europe',
    aliases: ['Europe du Sud', 'Südeuropa', 'Europa del Sur'],
    tier: 'macro',
    lat: 42.0,
    lon: 15.0,
  },
  {
    name: 'Central Europe',
    aliases: ['Europe centrale', 'Mitteleuropa', 'Europa Central'],
    tier: 'macro',
    lat: 48.0,
    lon: 15.0,
  },
  {
    name: 'Asia',
    aliases: ['Asie', 'Asien'],
    tier: 'macro',
    lat: 34.0,
    lon: 90.0,
  },
  {
    name: 'Central Asia',
    aliases: ['Asie centrale', 'Zentralasien', 'Asia Central'],
    tier: 'macro',
    lat: 42.0,
    lon: 65.0,
  },
  {
    name: 'Eastern Asia',
    aliases: ['East Asia', 'Asie de l’Est', 'Ostasien', 'Asia Oriental'],
    tier: 'macro',
    lat: 35.0,
    lon: 115.0,
  },
  {
    name: 'South Asia',
    aliases: ['Asie du Sud', 'Südasien', 'Asia del Sur', 'Ásia do Sul'],
    tier: 'macro',
    lat: 20.0,
    lon: 78.0,
  },
  {
    name: 'Southeast Asia',
    aliases: [
      'South-East Asia',
      'Asie du Sud-Est',
      'Südostasien',
      'Sudeste Asiático',
    ],
    tier: 'macro',
    lat: 10.0,
    lon: 105.0,
  },
  {
    name: 'Western Asia',
    aliases: ['Asie de l’Ouest', 'Westasien', 'Asia Occidental'],
    tier: 'macro',
    lat: 32.0,
    lon: 45.0,
  },
  {
    name: 'Middle East',
    aliases: ['Moyen-Orient', 'Naher Osten', 'Medio Oriente', 'Oriente Médio'],
    tier: 'macro',
    lat: 29.0,
    lon: 43.0,
  },
  {
    name: 'Mediterranean',
    aliases: ['Méditerranée', 'Mittelmeer', 'Mediterráneo'],
    tier: 'macro',
    lat: 38.0,
    lon: 15.0,
  },
  {
    name: 'North Africa',
    aliases: [
      'Northern Africa',
      'Afrique du Nord',
      'Nordafrika',
      'África del Norte',
      'África do Norte',
    ],
    tier: 'macro',
    lat: 30.0,
    lon: 10.0,
  },
  {
    name: 'West Africa',
    aliases: [
      'Western Africa',
      'Afrique de l’Ouest',
      'Westafrika',
      'África Occidental',
    ],
    tier: 'macro',
    lat: 12.0,
    lon: -5.0,
  },
  {
    name: 'East Africa',
    aliases: [
      'Eastern Africa',
      'Afrique de l’Est',
      'Ostafrika',
      'África Oriental',
    ],
    tier: 'macro',
    lat: 5.0,
    lon: 38.0,
  },
  {
    name: 'Central Africa',
    aliases: [
      'Middle Africa',
      'Afrique centrale',
      'Zentralafrika',
      'África Central',
    ],
    tier: 'macro',
    lat: 0.0,
    lon: 20.0,
  },
  {
    name: 'Southern Africa',
    aliases: ['Afrique australe', 'Südliches Afrika', 'África Austral'],
    tier: 'macro',
    lat: -25.0,
    lon: 25.0,
  },
  {
    name: 'Sub-Saharan Africa',
    aliases: [
      'Afrique subsaharienne',
      'Subsahara-Afrika',
      'África subsahariana',
    ],
    tier: 'macro',
    lat: -5.0,
    lon: 20.0,
  },
  {
    name: 'Balkans',
    aliases: ['Balkan'],
    tier: 'macro',
    lat: 43.0,
    lon: 21.0,
  },
  {
    name: 'Baltic',
    aliases: ['Baltics', 'Pays baltes', 'Báltico'],
    tier: 'macro',
    lat: 56.5,
    lon: 24.0,
  },
  {
    name: 'Scandinavia',
    aliases: ['Scandinavie', 'Skandinavien', 'Escandinavia'],
    tier: 'macro',
    lat: 62.0,
    lon: 15.0,
  },
  {
    name: 'South Pacific',
    aliases: ['Pacifique Sud', 'Südpazifik', 'Pacífico Sur'],
    tier: 'macro',
    lat: -20.0,
    lon: 170.0,
  },
  {
    name: 'Oceania',
    aliases: ['Océanie', 'Ozeanien'],
    tier: 'macro',
    lat: -20.0,
    lon: 160.0,
  },
  {
    name: 'Polynesia',
    tier: 'macro',
    lat: -17.0,
    lon: -150.0,
  },
  {
    name: 'Melanesia',
    tier: 'macro',
    lat: -8.0,
    lon: 155.0,
  },
  {
    name: 'Micronesia',
    tier: 'macro',
    lat: 7.0,
    lon: 155.0,
  },
  {
    name: 'Australasia',
    aliases: ['Australasie', 'Australasien'],
    tier: 'macro',
    lat: -30.0,
    lon: 145.0,
  },
  {
    name: 'Americas',
    aliases: ['America', 'Amériques'],
    tier: 'macro',
    lat: 15.0,
    lon: -90.0,
  },

  // ---- Territories absent from the Natural Earth 50m country file ----
  {
    name: 'Guadeloupe',
    tier: 'country',
    countryCode: 'GP',
    lat: 16.265,
    lon: -61.551,
  },
  {
    name: 'Martinique',
    tier: 'country',
    countryCode: 'MQ',
    lat: 14.6415,
    lon: -61.0242,
  },
  {
    name: 'Réunion',
    tier: 'country',
    countryCode: 'RE',
    lat: -21.1151,
    lon: 55.5364,
  },
  {
    name: 'Mayotte',
    tier: 'country',
    countryCode: 'YT',
    lat: -12.8275,
    lon: 45.1662,
  },
  {
    name: 'French Guiana',
    aliases: ['Guyane'],
    tier: 'country',
    countryCode: 'GF',
    lat: 3.9339,
    lon: -53.1258,
  },

  // ---- Historical countries, aliases, and manual overrides ------------
  {
    name: 'United States',
    aliases: ['USA', 'US', 'United States of America'],
    tier: 'country',
    countryCode: 'US',
    lat: 39.8283,
    lon: -98.5795,
  },
  {
    name: 'United Kingdom',
    aliases: ['UK', 'Great Britain'],
    tier: 'country',
    countryCode: 'GB',
    lat: 55.3781,
    lon: -3.436,
  },
  {
    name: 'Türkiye',
    aliases: ['Turkey'],
    tier: 'country',
    countryCode: 'TR',
    lat: 38.9637,
    lon: 35.2433,
  },
  {
    name: 'Czechia',
    aliases: ['Czech Republic'],
    tier: 'country',
    countryCode: 'CZ',
    lat: 49.8175,
    lon: 15.473,
  },
  {
    name: 'Côte d’Ivoire',
    aliases: ['Ivory Coast'],
    tier: 'country',
    countryCode: 'CI',
    lat: 7.54,
    lon: -5.5471,
  },
  {
    name: 'North Macedonia',
    aliases: ['Macedonia', 'F.Y.R. Macedonia'],
    tier: 'country',
    countryCode: 'MK',
    lat: 41.6086,
    lon: 21.7453,
  },
  {
    name: 'Czechoslovakia',
    tier: 'country',
    lat: 49.8,
    lon: 15.5,
  },
  {
    name: 'Yugoslavia',
    aliases: ['Ex-Yugoslavia', 'Serbia and Montenegro'],
    tier: 'country',
    lat: 44.0,
    lon: 20.5,
  },
  {
    name: 'USSR',
    aliases: ['Soviet Union'],
    tier: 'country',
    lat: 60.0,
    lon: 90.0,
  },
  {
    name: 'East Germany',
    tier: 'country',
    countryCode: 'DE',
    lat: 52.5,
    lon: 13.4,
  },
  {
    name: 'West Germany',
    tier: 'country',
    countryCode: 'DE',
    lat: 50.5,
    lon: 9.0,
  },
  {
    name: 'Zaire',
    tier: 'country',
    countryCode: 'CD',
    lat: -4.0383,
    lon: 21.7587,
  },
  {
    name: 'Dem. Rep. of Congo',
    tier: 'country',
    countryCode: 'CD',
    lat: -4.0383,
    lon: 21.7587,
  },
  {
    name: 'Congo',
    tier: 'country',
    countryCode: 'CG',
    lat: -0.228,
    lon: 15.8277,
  },
  {
    name: 'Burma',
    tier: 'country',
    countryCode: 'MM',
    lat: 21.9139,
    lon: 95.956,
  },
  {
    name: 'Ceylon',
    tier: 'country',
    countryCode: 'LK',
    lat: 7.8731,
    lon: 80.7718,
  },
  {
    name: 'Rhodesia',
    tier: 'country',
    countryCode: 'ZW',
    lat: -19.0154,
    lon: 29.1549,
  },
  {
    name: 'Tanganyika',
    tier: 'country',
    countryCode: 'TZ',
    lat: -6.5,
    lon: 35.0,
  },
  {
    name: 'Upper Volta',
    tier: 'country',
    countryCode: 'BF',
    lat: 12.2383,
    lon: -1.5616,
  },
  {
    name: 'Byelorussia',
    tier: 'country',
    countryCode: 'BY',
    lat: 53.7098,
    lon: 27.9534,
  },
  {
    name: 'Moldavia',
    tier: 'country',
    countryCode: 'MD',
    lat: 47.4116,
    lon: 28.3699,
  },
  {
    name: 'Columbia',
    tier: 'country',
    countryCode: 'CO',
    lat: 4.5709,
    lon: -74.2973,
  },
  {
    name: 'Sweden',
    aliases: ['Sween', 'Swecen'],
    tier: 'country',
    countryCode: 'SE',
    lat: 60.1282,
    lon: 18.6435,
  },
  {
    name: 'Netherlands',
    aliases: ['Netherland'],
    tier: 'country',
    countryCode: 'NL',
    lat: 52.1326,
    lon: 5.2913,
  },
  {
    name: 'Gambia',
    aliases: ['The Gambia'],
    tier: 'country',
    countryCode: 'GM',
    lat: 13.4432,
    lon: -15.3101,
  },
  {
    name: 'Ireland',
    aliases: ['Ireland Republic'],
    tier: 'country',
    countryCode: 'IE',
    lat: 53.1424,
    lon: -7.6921,
  },
  // Intl.DisplayNames spells TT with an ampersand; the catalogue uses the
  // plain "and" form found in track tags and keeps the ampersand as an alias.
  {
    name: 'Trinidad and Tobago',
    aliases: ['Trinidad & Tobago'],
    tier: 'country',
    countryCode: 'TT',
    lat: 10.999,
    lon: -60.918,
  },
];

let catalogByKey: Map<string, PlaceCatalogEntry> | null = null;

function buildCatalog(): Map<string, PlaceCatalogEntry> {
  const map = new Map<string, PlaceCatalogEntry>();
  for (const entry of PLACE_CATALOG) {
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      const key = regionKey(name);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        throw new Error(
          `Duplicate place catalog key "${key}" (${existing.name} / ${entry.name})`,
        );
      }
      map.set(key, entry);
    }
  }
  return map;
}

export function findCatalogPlace(name: string): PlaceCatalogEntry | null {
  if (!catalogByKey) catalogByKey = buildCatalog();
  return catalogByKey.get(regionKey(name)) ?? null;
}

/** Folded names and aliases that should be recognized as region tags. */
export function placeCatalogKeys(): Set<string> {
  if (!catalogByKey) catalogByKey = buildCatalog();
  return new Set(catalogByKey.keys());
}
