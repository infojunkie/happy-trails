import { TIER_RANK } from './placeCatalog.js';
import type { PlaceLocation } from './placeLookup.js';

export interface AlbumPlaceSelection {
  /** Distinct, non-nested locations for this album. */
  locations: PlaceLocation[];
  /** Region tags that did not resolve to a location. */
  unresolved: string[];
}

export interface AlbumPlaceInput {
  key: string;
  regions: readonly string[];
}

export interface AlbumPlaceGroup {
  location: PlaceLocation;
  albumKeys: string[];
}

export interface AlbumPlaceGroups {
  groups: AlbumPlaceGroup[];
  /** Albums with no resolved location. */
  unplaced: string[];
  /** Region tags that could not be resolved, grouped by album key. */
  unresolved: Map<string, string[]>;
}

const locationKey = (place: PlaceLocation): string =>
  `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;

/**
 * Select the map locations for one album.
 *
 * Macro-regions are dropped when a more specific place exists. Within a
 * country, only the most specific tier survives (Corsica hides France,
 * Vancouver hides Canada), while multiple cities/subnational regions at the
 * same tier and disjoint countries are all kept. Identical coordinates are
 * deduplicated so the same album is not pinned twice.
 */
export function selectAlbumLocations(
  regions: readonly string[],
  resolve: (name: string) => PlaceLocation | null,
): AlbumPlaceSelection {
  const resolved: PlaceLocation[] = [];
  const unresolved: string[] = [];
  for (const region of regions) {
    const place = resolve(region);
    if (place) resolved.push(place);
    else unresolved.push(region);
  }

  const specific = resolved.filter((place) => place.tier !== 'macro');
  const candidates = specific.length > 0 ? specific : resolved;

  const byCountry = new Map<string, PlaceLocation[]>();
  const ungrouped: PlaceLocation[] = [];
  for (const place of candidates) {
    const country = place.countryCode?.toUpperCase();
    if (!country) {
      ungrouped.push(place);
      continue;
    }
    let list = byCountry.get(country);
    if (!list) byCountry.set(country, (list = []));
    list.push(place);
  }

  const selected: PlaceLocation[] = [...ungrouped];
  for (const list of byCountry.values()) {
    const minimum = Math.min(...list.map((place) => TIER_RANK[place.tier]));
    for (const place of list) {
      if (TIER_RANK[place.tier] === minimum) selected.push(place);
    }
  }

  const seen = new Set<string>();
  const locations = selected.filter((place) => {
    const key = locationKey(place);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { locations, unresolved };
}

/**
 * Group a page of albums by their map locations. An album may appear in more
 * than one group when it carries several disjoint region tags.
 */
export function groupAlbumLocations(
  albums: readonly AlbumPlaceInput[],
  resolve: (name: string) => PlaceLocation | null,
): AlbumPlaceGroups {
  const byLocation = new Map<string, AlbumPlaceGroup>();
  const unplaced: string[] = [];
  const unresolved = new Map<string, string[]>();

  for (const album of albums) {
    const selection = selectAlbumLocations(album.regions, resolve);
    if (selection.unresolved.length > 0) {
      unresolved.set(album.key, selection.unresolved);
    }
    if (selection.locations.length === 0) {
      unplaced.push(album.key);
      continue;
    }
    for (const location of selection.locations) {
      const key = locationKey(location);
      let group = byLocation.get(key);
      if (!group) {
        group = { location, albumKeys: [] };
        byLocation.set(key, group);
      }
      if (!group.albumKeys.includes(album.key)) {
        group.albumKeys.push(album.key);
      }
    }
  }

  const groups = [...byLocation.values()].sort(
    (left, right) =>
      left.location.lat - right.location.lat ||
      left.location.lon - right.location.lon ||
      left.location.name.localeCompare(right.location.name),
  );

  return { groups, unplaced, unresolved };
}
