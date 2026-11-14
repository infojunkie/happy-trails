import {
  findCatalogPlace,
  type PlaceTier,
} from './placeCatalog.js';
import { regionKey } from './text.js';

/** Resolved location used by the map, independent of where it came from. */
export interface PlaceLocation {
  name: string;
  tier: PlaceTier;
  /** ISO alpha-2 country/sovereign code, when meaningful. */
  countryCode?: string;
  lat: number;
  lon: number;
}

/** Shape of the generated `public/map/places.json` asset. */
export interface GeneratedPlaceData {
  source?: string;
  places: Record<string, PlaceLocation>;
}

/**
 * Resolve a region tag to a location. Manual catalog entries always win over
 * the generated country lookup.
 */
export function resolvePlace(
  name: string,
  generated?: GeneratedPlaceData,
): PlaceLocation | null {
  const catalog = findCatalogPlace(name);
  if (catalog) {
    return {
      name: catalog.name,
      tier: catalog.tier,
      countryCode: catalog.countryCode,
      lat: catalog.lat,
      lon: catalog.lon,
    };
  }
  if (!generated) return null;
  return generated.places[regionKey(name)] ?? null;
}

/** Bind a generated lookup once, for map rendering. */
export function createPlaceResolver(
  generated: GeneratedPlaceData,
): (name: string) => PlaceLocation | null {
  return (name) => resolvePlace(name, generated);
}
