import * as L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { groupAlbumLocations } from '../shared/albumPlaces.js';
import {
  EQUAL_EARTH_X_MAX,
  EQUAL_EARTH_Y_MAX,
  projectEqualEarth,
  unprojectEqualEarth,
} from '../shared/equalEarth.js';
import {
  createPlaceResolver,
  type GeneratedPlaceData,
  type PlaceLocation,
} from '../shared/placeLookup.js';
import type { AlbumSummary } from '../shared/types.js';
import { createCover, hashString } from './cover.js';
import { el } from './dom.js';

const WORLD_URL = '/map/world-110m.geojson';
const PLACES_URL = '/map/places.json';
// Most albums are in the northern hemisphere, so keep the empty/world view
// north of the equator and leave the south pole out of the initial frame.
const WORLD_VIEW: L.LatLngExpression = [20, 0];
const WORLD_ZOOM = 2;

/**
 * Leaflet does not ship Equal Earth, but it supports a custom CRS. The map is
 * tile-free, so projecting the GeoJSON and markers through this CRS is enough.
 */
const equalEarthProjection = {
  project(latlng: L.LatLng): L.Point {
    const { x, y } = projectEqualEarth(latlng.lng, latlng.lat);
    return L.point(x, y);
  },
  unproject(point: L.Point): L.LatLng {
    const { lng, lat } = unprojectEqualEarth(point.x, point.y);
    return L.latLng(lat, lng);
  },
  bounds: L.bounds(
    [-EQUAL_EARTH_X_MAX, -EQUAL_EARTH_Y_MAX],
    [EQUAL_EARTH_X_MAX, EQUAL_EARTH_Y_MAX],
  ),
};

const EQUAL_EARTH_CRS = L.extend({}, L.CRS.EPSG4326, {
  projection: equalEarthProjection,
  transformation: new L.Transformation(
    1 / (2 * EQUAL_EARTH_X_MAX),
    0.5,
    -1 / (2 * EQUAL_EARTH_X_MAX),
    0.5,
  ),
}) as L.CRS;
const PIN_COVER_SIZE = 44;
const PIN_SPACING = 30;
const PIN_TAIL = 12;
const PIN_MAX = 6;
/** A curated pastel hue per country, assigned deterministically. */
const PASTEL_HUES: readonly number[] = [
  205, 336, 25, 92, 160, 270, 48, 190, 315, 130, 240, 10,
];

let worldPromise: Promise<FeatureCollection> | null = null;
let placesPromise: Promise<GeneratedPlaceData> | null = null;

function loadWorld(): Promise<FeatureCollection> {
  if (!worldPromise) {
    worldPromise = fetch(WORLD_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Map data failed to load (${response.status})`);
        }
        return response.json() as Promise<FeatureCollection>;
      })
      .catch((error: unknown) => {
        worldPromise = null;
        throw error;
      });
  }
  return worldPromise;
}

function loadPlaces(): Promise<GeneratedPlaceData> {
  if (!placesPromise) {
    placesPromise = fetch(PLACES_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Place data failed to load (${response.status})`);
        }
        return response.json() as Promise<GeneratedPlaceData>;
      })
      .catch((error: unknown) => {
        placesPromise = null;
        throw error;
      });
  }
  return placesPromise;
}

export interface AlbumMapPlacement {
  /** Albums with at least one resolved location. */
  placedCount: number;
  locationCount: number;
  /** Albums with no resolved location, in the input order. */
  unplaced: AlbumSummary[];
  /** Region tags that could not be resolved, keyed by album key. */
  unresolved: ReadonlyMap<string, readonly string[]>;
}

export interface AlbumMapOptions {
  onOpenAlbum: (album: AlbumSummary) => void;
  onPlacement?: (placement: AlbumMapPlacement) => void;
  /** Element that enters full-screen; defaults to the map container. */
  fullscreenTarget?: HTMLElement;
}

export interface AlbumMapHandle {
  /** Re-measure after the container is shown or resized. */
  invalidate(): void;
  /** Replace the cover pins for the current album page. */
  setAlbums(albums: readonly AlbumSummary[], fit?: boolean): void;
  /** Leave full-screen and stop interacting with a hidden map. */
  hide(): void;
  destroy(): void;
}

function toolbarButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-toolbar-button';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

/**
 * Mount the offline world map. The module (and Leaflet) is loaded lazily by
 * the view-switch code, so grid-only sessions never download the map bundle.
 */
export async function createAlbumMap(
  container: HTMLElement,
  options: AlbumMapOptions,
): Promise<AlbumMapHandle> {
  container.replaceChildren();
  const status = document.createElement('p');
  status.className = 'map-status';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  status.append(spinner, 'Loading map…');
  container.append(status);

  const [world, places] = await Promise.all([loadWorld(), loadPlaces()]);
  status.remove();

  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  const compact = window.matchMedia('(max-width: 900px)').matches;
  const pinCoverSize = compact ? 36 : PIN_COVER_SIZE;
  const pinSpacing = compact ? 24 : PIN_SPACING;
  container.style.setProperty('--pin-cover-size', `${pinCoverSize}px`);

  const map = L.map(container, {
    crs: EQUAL_EARTH_CRS,
    minZoom: 1,
    maxZoom: 5,
    worldCopyJump: false,
    zoomControl: true,
    zoomAnimation: !reduceMotion,
    fadeAnimation: !reduceMotion,
    markerZoomAnimation: !reduceMotion,
  });
  map.setView(WORLD_VIEW, WORLD_ZOOM);
  const countryLayer = L.geoJSON(world, {
    interactive: false,
    // No albums are in Antarctica; omitting it keeps the southern edge out of
    // the way of the northern-heavy collection.
    filter: (feature) => {
      const properties = feature.properties as {
        iso?: string | null;
        name?: string | null;
      } | null;
      return (
        properties?.iso !== 'AQ' &&
        !/^antarctica$/i.test(properties?.name ?? '')
      );
    },
  });
  countryLayer.addTo(map);
  countryLayer.eachLayer((layer) => {
    if (!(layer instanceof L.Path)) return;
    const feature = (
      layer as L.Path & {
        feature?: { properties?: { iso?: string | null; name?: string | null } };
      }
    ).feature;
    const key = feature?.properties?.iso ?? feature?.properties?.name ?? '';
    const hue =
      PASTEL_HUES[hashString(key) % PASTEL_HUES.length] ?? 205;
    (layer.getElement() as SVGElement | undefined)?.style.setProperty(
      '--country-hue',
      String(hue),
    );
  });
  map.attributionControl.addAttribution('Natural Earth');

  const resolve = createPlaceResolver(places);
  const pinLayer = L.layerGroup().addTo(map);
  const fullscreenTarget = options.fullscreenTarget ?? container;

  const isNativeFullscreen = (): boolean =>
    document.fullscreenElement === fullscreenTarget;

  /** Open an album, leaving native full-screen first so the dialog is visible. */
  const activate = (album: AlbumSummary): void => {
    if (!isNativeFullscreen()) {
      options.onOpenAlbum(album);
      return;
    }
    void document
      .exitFullscreen()
      .then(() => options.onOpenAlbum(album))
      .catch(() => options.onOpenAlbum(album));
  };

  const openGroupPopup = (
    location: PlaceLocation,
    albums: readonly AlbumSummary[],
  ): void => {
    const list = el(
      'div',
      { class: 'map-pin-list' },
      el('h3', {
        class: 'map-pin-list-title',
        text: `${location.name} · ${albums.length} albums`,
      }),
      ...albums.map((album) => {
        const item = el(
          'button',
          {
            class: 'map-pin-list-item',
            type: 'button',
            'aria-label': `Open ${album.album} by ${album.artist}`,
          },
          createCover(album, 'cover-pin-list'),
          el(
            'span',
            { class: 'map-pin-list-text' },
            el('span', { class: 'map-pin-list-album', text: album.album }),
            el('span', { class: 'map-pin-list-artist', text: album.artist }),
          ),
        );
        item.addEventListener('click', () => {
          map.closePopup();
          activate(album);
        });
        return item;
      }),
    );
    L.popup({ className: 'map-pin-popup', maxHeight: 340, minWidth: 240 })
      .setLatLng([location.lat, location.lon])
      .setContent(list)
      .openOn(map);
  };

  const buildGroupMarker = (
    location: PlaceLocation,
    albums: readonly AlbumSummary[],
  ): L.Marker => {
    const overflow = albums.length > PIN_MAX;
    const shown = overflow ? albums.slice(0, PIN_MAX - 1) : albums;
    const remaining = albums.length - shown.length;
    const items = shown.length + (remaining > 0 ? 1 : 0);
    const width =
      items <= 1 ? pinCoverSize : (items - 1) * pinSpacing + pinCoverSize;
    const height = pinCoverSize + PIN_TAIL;
    const group = el('div', {
      class: 'map-pin-group',
      role: 'group',
      'aria-label': `${location.name}: ${albums.length} album${
        albums.length === 1 ? '' : 's'
      }`,
    });

    const addItem = (index: number, element: HTMLElement): void => {
      const center = width / 2;
      const offset = (index - (items - 1) / 2) * pinSpacing;
      element.style.left = `${center + offset - pinCoverSize / 2}px`;
      element.style.zIndex = String(
        100 - Math.round(Math.abs(index - (items - 1) / 2)) * 5,
      );
      element.style.setProperty(
        '--pin-tilt',
        `${(index - (items - 1) / 2) * 4}deg`,
      );
      group.append(element);
    };

    shown.forEach((album, index) => {
      const button = el(
        'button',
        {
          class: 'map-pin-cover',
          type: 'button',
          title: `${album.album} — ${album.artist}`,
          'aria-label': `Open ${album.album} by ${album.artist}`,
        },
        createCover(album),
      );
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        activate(album);
      });
      addItem(index, button);
    });

    if (remaining > 0) {
      const moreButton = el('button', {
        class: 'map-pin-more',
        type: 'button',
        text: `+${remaining}`,
        title: `Show ${remaining} more album${
          remaining === 1 ? '' : 's'
        } in ${location.name}`,
        'aria-label': `Show ${remaining} more album${
          remaining === 1 ? '' : 's'
        } in ${location.name}`,
      });
      moreButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openGroupPopup(location, albums);
      });
      addItem(shown.length, moreButton);
    }

    group.append(
      el('span', { class: 'map-pin-tail', 'aria-hidden': 'true' }),
    );

    const icon = L.divIcon({
      className: 'map-pin-icon',
      html: group,
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
    });
    return L.marker([location.lat, location.lon], {
      icon,
      keyboard: true,
      title: `${location.name} · ${albums.length} album${
        albums.length === 1 ? '' : 's'
      }`,
      alt: location.name,
      riseOnHover: true,
    });
  };

  const renderPins = (
    albums: readonly AlbumSummary[],
    fit: boolean,
  ): void => {
    const albumByKey = new Map(albums.map((album) => [album.key, album]));
    const grouped = groupAlbumLocations(
      albums.map((album) => ({ key: album.key, regions: album.regions })),
      resolve,
    );
    pinLayer.clearLayers();
    const markers: L.Marker[] = [];
    for (const group of grouped.groups) {
      const groupAlbums = group.albumKeys
        .map((key) => albumByKey.get(key))
        .filter((album): album is AlbumSummary => Boolean(album));
      if (groupAlbums.length === 0) continue;
      const marker = buildGroupMarker(group.location, groupAlbums);
      marker.addTo(pinLayer);
      markers.push(marker);
    }

    const unplaced = grouped.unplaced
      .map((key) => albumByKey.get(key))
      .filter((album): album is AlbumSummary => Boolean(album));
    options.onPlacement?.({
      placedCount: albums.length - unplaced.length,
      locationCount: grouped.groups.length,
      unplaced,
      unresolved: grouped.unresolved,
    });

    if (fit && markers.length > 0) {
      const padding = window.matchMedia('(max-width: 900px)').matches
        ? 100
        : 70;
      map.fitBounds(
        L.latLngBounds(markers.map((marker) => marker.getLatLng())),
        { padding: [padding, padding], maxZoom: 4, animate: false },
      );

      // The cover fan extends above the geographic anchor. Make sure the
      // northern-most fan (e.g. Iceland) has room inside the map instead of
      // being clipped at the top edge.
      const topMarker = markers.reduce((top, marker) =>
        marker.getLatLng().lat > top.getLatLng().lat ? marker : top,
      );
      const point = map.latLngToContainerPoint(topMarker.getLatLng());
      const required = pinCoverSize + PIN_TAIL + 16;
      if (point.y < required) {
        const centerPoint = map.getSize().divideBy(2);
        centerPoint.y -= required - point.y;
        map.setView(map.containerPointToLatLng(centerPoint), map.getZoom(), {
          animate: false,
        });
      }
    }
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'map-toolbar';
  const worldButton = toolbarButton('World view', 'Reset to the world view');
  const fullscreenButton = toolbarButton('Full screen', 'Enter full screen');
  toolbar.append(worldButton, fullscreenButton);
  container.append(toolbar);

  const resetWorld = (): void => {
    map.setView(WORLD_VIEW, WORLD_ZOOM);
  };
  worldButton.addEventListener('click', resetWorld);

  let expanded = false;

  const syncFullscreenUi = (): void => {
    const active = isNativeFullscreen() || expanded;
    fullscreenButton.textContent = active ? 'Exit full screen' : 'Full screen';
    fullscreenButton.title = active ? 'Exit full screen' : 'Enter full screen';
    fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Exit full screen' : 'Enter full screen',
    );
    window.setTimeout(() => map.invalidateSize(), 0);
  };

  const setExpanded = (value: boolean): void => {
    expanded = value;
    fullscreenTarget.classList.toggle('is-expanded', value);
    document.body.classList.toggle('map-expanded', value);
    syncFullscreenUi();
  };

  const toggleFullscreen = (): void => {
    if (isNativeFullscreen()) {
      void document.exitFullscreen();
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    const request = fullscreenTarget.requestFullscreen?.();
    if (request) {
      request.catch(() => setExpanded(true));
    } else {
      setExpanded(true);
    }
  };
  fullscreenButton.addEventListener('click', toggleFullscreen);

  const onFullscreenChange = (): void => {
    if (isNativeFullscreen()) {
      expanded = false;
      fullscreenTarget.classList.remove('is-expanded');
      document.body.classList.remove('map-expanded');
    }
    syncFullscreenUi();
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && expanded && !isNativeFullscreen()) {
      setExpanded(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  return {
    invalidate(): void {
      map.invalidateSize();
    },
    setAlbums(albums: readonly AlbumSummary[], fit = false): void {
      renderPins(albums, fit);
    },
    hide(): void {
      map.closePopup();
      if (isNativeFullscreen()) void document.exitFullscreen();
      if (expanded) setExpanded(false);
    },
    destroy(): void {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
      worldButton.removeEventListener('click', resetWorld);
      fullscreenButton.removeEventListener('click', toggleFullscreen);
      if (isNativeFullscreen()) void document.exitFullscreen();
      fullscreenTarget.classList.remove('is-expanded');
      document.body.classList.remove('map-expanded');
      map.remove();
      container.replaceChildren();
    },
  };
}
