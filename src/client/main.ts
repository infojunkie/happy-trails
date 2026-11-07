import {
  isFilterMode,
  isSortKey,
  type AlbumSummary,
  type FilterMode,
  type GenreFacet,
  type SessionResponse,
  type SortKey,
  type StatusResponse,
  type Track,
  type TracksResponse,
} from '../shared/types.js';
import { artistSegments, regionKey } from '../shared/text.js';
import { api } from './api.js';
import { $, el } from './dom.js';
import {
  formatBitrate,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatFrequency,
  formatTotalDuration,
} from './format.js';

const PAGE_SIZE = 48;
const FACET_PREVIEW = 25;
const SKELETON_COUNT = 8;
const SEARCH_DEBOUNCE_MS = 250;
const STATUS_POLL_MS = 30_000;

interface State {
  selectedGenres: string[];
  genreMode: FilterMode;
  facets: GenreFacet[];
  facetByKey: Map<string, GenreFacet>;
  selectedRegions: string[];
  regionMode: FilterMode;
  regionFacets: GenreFacet[];
  regionByKey: Map<string, GenreFacet>;
  totalAlbums: number;
  genreQuery: string;
  genreExpanded: boolean;
  regionQuery: string;
  regionExpanded: boolean;
  q: string;
  sort: SortKey;
  albums: AlbumSummary[];
  total: number;
  playbackEnabled: boolean;
  session: SessionResponse;
  pendingPlayUrl: string | null;
  loginRequestedFromUrl: boolean;
  loadedVersion: number | null;
  serverVersion: number | null;
  libraryReady: boolean;
  libraryRefreshing: boolean;
  reloadingLibrary: boolean;
}

const state: State = {
  selectedGenres: [],
  genreMode: 'any',
  facets: [],
  facetByKey: new Map(),
  selectedRegions: [],
  regionMode: 'any',
  regionFacets: [],
  regionByKey: new Map(),
  totalAlbums: 0,
  genreQuery: '',
  genreExpanded: false,
  regionQuery: '',
  regionExpanded: false,
  q: '',
  sort: 'recent',
  albums: [],
  total: 0,
  playbackEnabled: false,
  session: { authenticated: false, account: null },
  pendingPlayUrl: null,
  loginRequestedFromUrl: false,
  loadedVersion: null,
  serverVersion: null,
  libraryReady: false,
  libraryRefreshing: false,
  reloadingLibrary: false,
};

const searchInput = $<HTMLInputElement>('#search');
const sortSelect = $<HTMLSelectElement>('#sort');
const statsEl = $('#library-stats');
const resultSummary = $('#result-summary');
const albumGrid = $('#album-grid');
const emptyState = $('#empty-state');
const loadMoreButton = $<HTMLButtonElement>('#load-more');
const activeFilters = $('#active-filters');
const genreList = $('#genre-list');
const genreSearch = $<HTMLInputElement>('#genre-search');
const clearGenresButton = $<HTMLButtonElement>('#clear-genres');
const toggleAllButton = $<HTMLButtonElement>('#toggle-all-genres');
const regionList = $('#region-list');
const regionSearch = $<HTMLInputElement>('#region-search');
const clearRegionsButton = $<HTMLButtonElement>('#clear-regions');
const toggleAllRegionsButton = $<HTMLButtonElement>('#toggle-all-regions');
const genreModeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="genre-mode"]',
);
const regionModeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="region-mode"]',
);
const errorBanner = $('#error-banner');
const errorText = $('#error-text');
const dialog = $<HTMLDialogElement>('#album-dialog');
const refreshButton = $<HTMLButtonElement>('#refresh-button');
const refreshDot = $('#refresh-dot');
const sessionButton = $<HTMLButtonElement>('#session-button');
const loginDialog = $<HTMLDialogElement>('#login-dialog');
const loginForm = $<HTMLFormElement>('#login-form');
const loginUsername = $<HTMLInputElement>('#login-username');
const loginPassword = $<HTMLInputElement>('#login-password');
const loginError = $('#login-error');
const loginSubmit = $<HTMLButtonElement>('#login-submit');
const loginCancel = $<HTMLButtonElement>('#login-cancel');

const trackCache = new Map<string, TracksResponse>();
let requestSequence = 0;
let dialogSequence = 0;
let searchTimer: number | undefined;
let retryTimer: number | undefined;
let statusPollTimer: number | undefined;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function genreKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initials(value: string): string {
  const cleaned = value.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || '♪';
}

function setSummary(text: string): void {
  resultSummary.textContent = text;
}

function renderModeControls(): void {
  for (const input of genreModeInputs) {
    input.checked = input.value === state.genreMode;
  }
  for (const input of regionModeInputs) {
    input.checked = input.value === state.regionMode;
  }
}

function showError(message: string): void {
  errorText.textContent = message;
  errorBanner.hidden = false;
}

function hideError(): void {
  errorBanner.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Library refresh                                                     */
/* ------------------------------------------------------------------ */

function updateRefreshControl(): void {
  const hasVersions =
    state.libraryReady &&
    state.loadedVersion !== null &&
    state.serverVersion !== null;
  const stale =
    hasVersions && state.loadedVersion !== state.serverVersion;
  const serverBusy = state.libraryRefreshing;
  const clientBusy = state.reloadingLibrary;

  refreshButton.disabled = !stale || serverBusy || clientBusy;
  refreshButton.classList.toggle(
    'is-stale',
    stale && !serverBusy && !clientBusy,
  );
  refreshButton.classList.toggle('is-updating', serverBusy || clientBusy);
  refreshDot.hidden = !(stale && !serverBusy && !clientBusy);

  refreshButton.title = !state.libraryReady
    ? 'Library is loading…'
    : clientBusy
      ? 'Reloading library…'
      : serverBusy
        ? 'Library is being updated…'
        : stale
          ? 'Library updated — click to reload'
          : 'Library is up to date';
  refreshButton.setAttribute(
    'aria-label',
    stale && !serverBusy && !clientBusy
      ? 'Reload library snapshot'
      : refreshButton.title,
  );
}

async function pollStatus(): Promise<void> {
  if (document.hidden) return;

  try {
    const status = await api.status();
    state.libraryReady = status.ready;
    state.serverVersion = status.libraryVersion;
    state.libraryRefreshing = status.refreshing;
    if (status.ready) renderStats(status);
    updateRefreshControl();
  } catch {
    // Transient status failures are ignored; the next poll retries.
  }
}

function startStatusPolling(): void {
  if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer);
  statusPollTimer = window.setInterval(
    () => void pollStatus(),
    STATUS_POLL_MS,
  );
}

async function reloadLibrary(): Promise<void> {
  if (state.reloadingLibrary) return;

  state.reloadingLibrary = true;
  requestSequence += 1;
  loadMoreButton.disabled = true;
  updateRefreshControl();

  try {
    const [facets, albums] = await Promise.all([
      api.genres(),
      api.albums({
        genres: state.selectedGenres,
        genreMode: state.genreMode,
        regions: state.selectedRegions,
        regionMode: state.regionMode,
        q: state.q,
        sort: state.sort,
        offset: 0,
        limit: PAGE_SIZE,
      }),
    ]);

    state.facets = facets.genres;
    state.facetByKey = new Map(
      facets.genres.map((genre) => [genre.key, genre]),
    );
    state.regionFacets = facets.regions;
    state.regionByKey = new Map(
      facets.regions.map((region) => [region.key, region]),
    );
    state.totalAlbums = facets.totalAlbums;
    state.total = albums.total;
    state.albums = albums.albums;
    state.loadedVersion = Math.min(
      facets.libraryVersion,
      albums.libraryVersion,
    );
    state.libraryReady = true;
    const newestVersion = Math.max(
      facets.libraryVersion,
      albums.libraryVersion,
    );
    if (
      state.serverVersion === null ||
      newestVersion > state.serverVersion
    ) {
      state.serverVersion = newestVersion;
    }

    if (dialog.open) dialog.close();
    trackCache.clear();
    renderFacets();
    renderRegions();
    renderAlbums();
    albumGrid.removeAttribute('aria-busy');
    hideError();
    window.scrollTo({ top: 0 });
    void pollStatus();
  } catch (error) {
    showError(describe(error));
  } finally {
    state.reloadingLibrary = false;
    loadMoreButton.disabled = false;
    albumGrid.removeAttribute('aria-busy');
    updateRefreshControl();
  }
}

/* ------------------------------------------------------------------ */
/* Synology session                                                    */
/* ------------------------------------------------------------------ */

function renderSession(): void {
  if (!state.playbackEnabled) {
    sessionButton.hidden = true;
    return;
  }

  sessionButton.hidden = false;
  if (state.session.authenticated) {
    const account = state.session.account ?? 'Signed in';
    sessionButton.textContent = account;
    sessionButton.title = `Signed in as ${account}. Click to sign out.`;
    sessionButton.setAttribute(
      'aria-label',
      `Signed in as ${account}. Sign out.`,
    );
    sessionButton.classList.add('is-authenticated');
  } else {
    sessionButton.textContent = 'Sign in';
    sessionButton.title = 'Sign in to Synology to play albums';
    sessionButton.setAttribute('aria-label', 'Sign in to Synology');
    sessionButton.classList.remove('is-authenticated');
  }
}

async function loadSession(): Promise<void> {
  try {
    state.session = await api.session();
  } catch {
    state.session = { authenticated: false, account: null };
  }
  renderSession();
  refreshAlbumCards();
}

function refreshAlbumCards(): void {
  if (state.albums.length > 0) renderAlbums();
}

function setLoginError(message: string | null): void {
  if (message) {
    loginError.textContent = message;
    loginError.hidden = false;
  } else {
    loginError.textContent = '';
    loginError.hidden = true;
  }
}

function openLoginDialog(): void {
  if (!state.playbackEnabled) {
    showError('Synology sign-in is not configured.');
    return;
  }

  setLoginError(null);
  loginSubmit.disabled = false;
  loginSubmit.textContent = 'Sign in';

  try {
    const remembered = localStorage.getItem('happy-trails.dsm-user');
    if (remembered && !loginUsername.value) loginUsername.value = remembered;
  } catch {
    // localStorage may be unavailable; ignore.
  }

  if (!loginDialog.open) loginDialog.showModal();
  const focusTarget = loginUsername.value ? loginPassword : loginUsername;
  focusTarget.focus();
}

function closeLoginDialog(): void {
  if (loginDialog.open) loginDialog.close();
}

async function submitLogin(): Promise<void> {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    setLoginError('Enter your Synology username and password.');
    return;
  }

  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Signing in…';
  setLoginError(null);

  try {
    const response = await api.login(username, password);
    state.session = response;
    renderSession();
    loginPassword.value = '';
    try {
      localStorage.setItem('happy-trails.dsm-user', response.account ?? username);
    } catch {
      // Ignore storage failures.
    }

    const target = state.pendingPlayUrl;
    state.pendingPlayUrl = null;
    state.loginRequestedFromUrl = false;
    if (loginDialog.open) loginDialog.close();
    if (target) {
      window.location.assign(target);
      return;
    }
    refreshAlbumCards();
    syncUrl();
  } catch (error) {
    loginPassword.value = '';
    setLoginError(describe(error));
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
  }
}

async function signOut(): Promise<void> {
  try {
    state.session = await api.logout();
    renderSession();
    refreshAlbumCards();
    hideError();
  } catch (error) {
    showError(describe(error));
  }
}

function handleLoginDeepLink(): void {
  if (!state.loginRequestedFromUrl) return;
  state.loginRequestedFromUrl = false;

  if (!state.playbackEnabled) {
    showError('Synology sign-in is not configured.');
    return;
  }

  if (state.session.authenticated) {
    const target = state.pendingPlayUrl;
    state.pendingPlayUrl = null;
    if (target) window.location.assign(target);
    return;
  }

  openLoginDialog();
}

/* ------------------------------------------------------------------ */
/* Initial load                                                        */
/* ------------------------------------------------------------------ */

function readUrlState(): void {
  const params = new URLSearchParams(location.search);
  state.q = (params.get('q') ?? '').slice(0, 200);
  const sort = params.get('sort');
  state.sort = isSortKey(sort) ? sort : 'recent';
  const genres = params
    .getAll('genre')
    .flatMap((value) => value.split(','))
    .map(genreKey)
    .filter(Boolean);
  state.selectedGenres = [...new Set(genres)];

  const regions = params
    .getAll('region')
    .flatMap((value) => value.split(','))
    .map(regionKey)
    .filter(Boolean);
  state.selectedRegions = [...new Set(regions)];

  const genreMode = params.get('genreMode');
  state.genreMode = isFilterMode(genreMode) ? genreMode : 'any';
  const regionMode = params.get('regionMode');
  state.regionMode = isFilterMode(regionMode) ? regionMode : 'any';

  const login = params.get('login') === '1';
  const playKey = params.get('play');
  if (login && playKey) {
    state.loginRequestedFromUrl = true;
    state.pendingPlayUrl = `/play/${encodeURIComponent(playKey)}`;
  }

  searchInput.value = state.q;
  sortSelect.value = state.sort;
  renderModeControls();
}

function syncUrl(): void {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const key of state.selectedGenres) {
    params.append('genre', state.facetByKey.get(key)?.name ?? key);
  }
  for (const key of state.selectedRegions) {
    params.append('region', state.regionByKey.get(key)?.name ?? key);
  }
  if (state.genreMode !== 'any') params.set('genreMode', state.genreMode);
  if (state.regionMode !== 'any') params.set('regionMode', state.regionMode);
  if (state.sort !== 'recent') params.set('sort', state.sort);
  const query = params.toString();
  history.replaceState(
    null,
    '',
    query ? `${location.pathname}?${query}` : location.pathname,
  );
}

async function loadLibrary(): Promise<void> {
  window.clearTimeout(retryTimer);
  renderSkeletons();
  setSummary('Loading library…');

  try {
    const status = await api.status();
    renderStats(status);
    state.playbackEnabled = status.playbackEnabled;
    state.serverVersion = status.libraryVersion;
    state.libraryReady = status.ready;
    state.libraryRefreshing = status.refreshing;
    renderSession();
    updateRefreshControl();

    if (!status.ready) {
      renderSkeletons(0);
      setSummary('Waiting for the library…');
      showError(
        status.error
          ? `Library unavailable: ${status.error}`
          : 'The library is still being indexed. Retrying…',
      );
      retryTimer = window.setTimeout(() => void loadLibrary(), 3000);
      return;
    }

    const response = await api.genres();
    const facetsVersion = response.libraryVersion;
    state.facets = response.genres;
    state.facetByKey = new Map(
      response.genres.map((genre) => [genre.key, genre]),
    );
    state.regionFacets = response.regions;
    state.regionByKey = new Map(
      response.regions.map((region) => [region.key, region]),
    );
    state.totalAlbums = response.totalAlbums;
    renderFacets();
    renderRegions();
    hideError();
    const albumsVersion = await loadAlbums(true);
    if (albumsVersion !== null) {
      state.loadedVersion = Math.min(facetsVersion, albumsVersion);
    }
    updateRefreshControl();
  } catch (error) {
    state.libraryReady = false;
    renderSkeletons(0);
    setSummary('Unable to load the library');
    showError(describe(error));
    updateRefreshControl();
    retryTimer = window.setTimeout(() => void loadLibrary(), 5000);
  }
}

function renderStats(status: StatusResponse): void {
  statsEl.textContent = `${formatCount(status.albumCount)} albums · ${formatCount(status.trackCount)} tracks`;
  statsEl.title = status.lastRefreshed
    ? `Library indexed ${formatDateTime(status.lastRefreshed)}`
    : '';
}

/* ------------------------------------------------------------------ */
/* Albums                                                              */
/* ------------------------------------------------------------------ */

async function loadAlbums(reset: boolean): Promise<number | null> {
  const sequence = ++requestSequence;

  if (reset) {
    state.albums = [];
    loadMoreButton.hidden = true;
    emptyState.hidden = true;
    renderSkeletons();
  }
  setSummary(reset ? 'Loading…' : `Loading more of ${formatCount(state.total)}…`);
  loadMoreButton.disabled = true;

  try {
    const response = await api.albums({
      genres: state.selectedGenres,
      genreMode: state.genreMode,
      regions: state.selectedRegions,
      regionMode: state.regionMode,
      q: state.q,
      sort: state.sort,
      offset: reset ? 0 : state.albums.length,
      limit: PAGE_SIZE,
    });
    if (sequence !== requestSequence) return null;

    state.total = response.total;
    state.albums = reset
      ? response.albums
      : [...state.albums, ...response.albums];
    state.libraryReady = true;
    if (
      state.serverVersion === null ||
      response.libraryVersion > state.serverVersion
    ) {
      state.serverVersion = response.libraryVersion;
    }
    renderAlbums();
    hideError();
    updateRefreshControl();
    return response.libraryVersion;
  } catch (error) {
    if (sequence !== requestSequence) return null;
    showError(describe(error));
    if (reset) {
      state.albums = [];
      state.total = 0;
      renderAlbums();
      // An API failure is not the same thing as an empty result set.
      emptyState.hidden = true;
    }
    updateRefreshControl();
    return null;
  } finally {
    if (sequence === requestSequence) {
      albumGrid.removeAttribute('aria-busy');
      loadMoreButton.disabled = false;
      updateRefreshControl();
    }
  }
}

function renderAlbums(): void {
  albumGrid.replaceChildren(...state.albums.map(renderAlbumCard));
  emptyState.hidden = state.albums.length > 0;
  loadMoreButton.hidden =
    state.albums.length === 0 || state.albums.length >= state.total;
  updateSummary();
  renderActiveFilters();
}

function updateSummary(): void {
  const filtered =
    state.q.length > 0 ||
    state.selectedGenres.length > 0 ||
    state.selectedRegions.length > 0;
  setSummary(
    filtered
      ? `${formatCount(state.total)} of ${formatCount(state.totalAlbums)} albums`
      : `${formatCount(state.total)} albums`,
  );
}

function albumMeta(album: AlbumSummary): string {
  const parts: string[] = [];
  if (album.year) parts.push(String(album.year));
  parts.push(
    `${formatCount(album.trackCount)} ${album.trackCount === 1 ? 'track' : 'tracks'}`,
  );
  if (album.duration > 0) parts.push(formatTotalDuration(album.duration));
  return parts.join(' · ');
}

function createCover(album: AlbumSummary, extraClass = ''): HTMLElement {
  const cover = el('span', {
    class: `cover ${extraClass}`.trim(),
    'aria-hidden': 'true',
  });
  cover.style.setProperty('--cover-hue', String(hashString(album.key) % 360));
  cover.append(el('span', { class: 'cover-initials', text: initials(album.album) }));

  const image = el('img', {
    class: 'cover-image',
    alt: '',
    loading: 'lazy',
    decoding: 'async',
  });
  image.addEventListener('load', () => cover.classList.add('has-cover'));
  image.addEventListener('error', () => image.remove());
  image.src = `/api/albums/${encodeURIComponent(album.key)}/cover`;
  cover.append(image);

  return cover;
}

function createSearchButton(
  value: string,
  className: string,
  label = value,
): HTMLButtonElement {
  const button = el('button', {
    class: className,
    type: 'button',
    text: label,
    title: `Search for ${value}`,
    'aria-label': `Search for ${value}`,
  });
  button.addEventListener('click', () => navigateToSearch(value));
  return button;
}

function artistNodes(
  artists: string[],
  original: string | null | undefined,
): Array<Node | string> {
  const segments = artistSegments(original, artists);
  if (segments) {
    return segments.map((segment) =>
      segment.name
        ? createSearchButton(
            segment.name,
            'artist-link link-inline',
            segment.text,
          )
        : segment.text,
    );
  }

  // Fallback for malformed or missing original text: keep the old joined form.
  const names = artists.length > 0 ? artists : original ? [original] : [];
  const nodes: Array<Node | string> = [];
  names.forEach((name, index) => {
    if (index > 0) {
      nodes.push(
        el('span', {
          class: 'artist-sep',
          'aria-hidden': 'true',
          text: ' · ',
        }),
      );
    }
    nodes.push(createSearchButton(name, 'artist-link link-inline'));
  });
  return nodes;
}

function navigateToSearch(value: string): void {
  const query = value.trim();
  if (!query) return;

  window.clearTimeout(searchTimer);
  state.q = query;
  // A name search is a fresh navigation; drop filters that could hide it.
  state.selectedGenres = [];
  state.genreMode = 'any';
  state.selectedRegions = [];
  state.regionMode = 'any';
  searchInput.value = query;
  if (dialog.open) dialog.close();
  renderModeControls();
  syncUrl();
  renderFacets();
  renderRegions();
  renderActiveFilters();
  window.scrollTo({ top: 0 });
  void loadAlbums(true);
}

function activateGenre(name: string): void {
  if (dialog.open) dialog.close();
  setGenreSelected(genreKey(name), true);
  window.scrollTo({ top: 0 });
}

function activateRegion(name: string): void {
  if (dialog.open) dialog.close();
  setRegionSelected(regionKey(name), true);
  window.scrollTo({ top: 0 });
}

function renderAlbumCard(album: AlbumSummary): HTMLElement {
  const coverButton = el(
    'button',
    {
      class: 'album-open',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': `Open ${album.album} by ${album.artist}`,
    },
    createCover(album),
  );
  coverButton.addEventListener('click', () => void openAlbum(album));
  const albumButton = el(
    'button',
    {
      class: 'album-title link-like',
      type: 'button',
      text: album.album,
      'aria-haspopup': 'dialog',
      'aria-label': `Open ${album.album} by ${album.artist}`,
    }
  );
  albumButton.addEventListener('click', () => void openAlbum(album));

  const info = el(
    'div',
    { class: 'album-info' },
    albumButton,
    el(
      'span',
      { class: 'album-artist', title: album.artist },
      ...artistNodes(album.artists, album.artist),
    ),
    el('span', { class: 'album-meta', text: albumMeta(album) }),
    el('span', {
      class: 'album-added',
      text: album.latest ? `Added ${formatDate(album.latest)}` : 'Added date unknown',
    }),
  );

  const genreChips: HTMLElement[] = [];

  if (state.playbackEnabled && state.session.authenticated) {
    genreChips.push(
      el(
        'a',
        {
          class: 'chip album-play',
          href: `/play/${encodeURIComponent(album.key)}`,
          target: '_blank',
          rel: 'noopener',
          title: 'Play in Synology Audio Station',
          'aria-label': `Play ${album.album} in Synology Audio Station`,
        },
        el('span', { class: 'play-glyph', 'aria-hidden': 'true', text: '▶' }),
        el('span', { text: 'Play' }),
      ),
    );
  }

  const shownGenres = album.genres.slice(0, 3);
  for (const name of shownGenres) {
    const key = genreKey(name);
    const chip = el(
      'button',
      {
        class: 'chip chip-small',
        type: 'button',
        title: `Filter by ${name}`,
        'aria-pressed': state.selectedGenres.includes(key) ? 'true' : 'false',
      },
      el('span', { text: name }),
    );
    if (state.selectedGenres.includes(key)) chip.classList.add('is-active');
    chip.addEventListener('click', () => activateGenre(name));
    genreChips.push(chip);
  }

  const shownRegions = album.regions.slice(0, 2);
  for (const name of shownRegions) {
    const key = regionKey(name);
    const chip = el(
      'button',
      {
        class: 'chip chip-small chip-region',
        type: 'button',
        title: `Filter by region: ${name}`,
        'aria-pressed': state.selectedRegions.includes(key) ? 'true' : 'false',
      },
      el('span', { text: name }),
    );
    if (state.selectedRegions.includes(key)) chip.classList.add('is-active');
    chip.addEventListener('click', () => activateRegion(name));
    genreChips.push(chip);
  }

  const hiddenTags = [
    ...album.genres.slice(shownGenres.length),
    ...album.regions.slice(shownRegions.length),
  ];
  if (hiddenTags.length > 0) {
    genreChips.push(
      el('span', {
        class: 'chip chip-more',
        title: hiddenTags.join(', '),
        text: `+${hiddenTags.length} more`,
      }),
    );
  }

  return el(
    'article',
    { class: 'album-card' },
    coverButton,
    info,
    el('div', { class: 'album-genres' }, ...genreChips),
  );
}

/* ------------------------------------------------------------------ */
/* Genre facets                                                        */
/* ------------------------------------------------------------------ */

function visibleFacetItems(
  facets: GenreFacet[],
  selected: Set<string>,
  query: string,
  expanded: boolean,
  normalize: (value: string) => string = (value) => value.toLowerCase(),
): GenreFacet[] {
  const needle = normalize(query);
  if (needle) {
    return facets.filter((facet) =>
      normalize(facet.name).includes(needle),
    );
  }
  if (expanded) return [...facets];

  const preview = facets.slice(0, FACET_PREVIEW);
  const shown = new Set(preview.map((facet) => facet.key));
  const selectedExtras = facets.filter(
    (facet) => selected.has(facet.key) && !shown.has(facet.key),
  );
  return [...preview, ...selectedExtras];
}

function buildFacetRows(
  items: GenreFacet[],
  selected: Set<string>,
  keyAttribute: 'data-genre-key' | 'data-region-key',
): HTMLElement[] {
  return [...items]
    .sort(
      (a, b) =>
        Number(selected.has(b.key)) - Number(selected.has(a.key)) ||
        b.albumCount - a.albumCount ||
        a.name.localeCompare(b.name),
    )
    .map((facet) => {
      const attrs: Record<string, string> = {
        type: 'checkbox',
        value: facet.key,
      };
      attrs[keyAttribute] = facet.key;
      const input = el('input', attrs);
      input.checked = selected.has(facet.key);
      return el(
        'label',
        { class: 'facet-row' },
        input,
        el('span', {
          class: 'facet-name',
          title: facet.name,
          text: facet.name,
        }),
        el('span', {
          class: 'facet-count',
          text: formatCount(facet.albumCount),
        }),
      );
    });
}

function updateFacetChrome(): void {
  clearGenresButton.hidden = state.selectedGenres.length === 0;
  const hasQuery = state.genreQuery.trim().length > 0;
  const canToggle = state.facets.length > FACET_PREVIEW && !hasQuery;
  toggleAllButton.hidden = !canToggle;
  if (canToggle) {
    toggleAllButton.textContent = state.genreExpanded
      ? 'Show fewer genres'
      : `Show all ${formatCount(state.facets.length)} genres`;
  }
}

function updateRegionChrome(): void {
  clearRegionsButton.hidden = state.selectedRegions.length === 0;
  const hasQuery = state.regionQuery.trim().length > 0;
  const canToggle = state.regionFacets.length > FACET_PREVIEW && !hasQuery;
  toggleAllRegionsButton.hidden = !canToggle;
  if (canToggle) {
    toggleAllRegionsButton.textContent = state.regionExpanded
      ? 'Show fewer regions'
      : `Show all ${formatCount(state.regionFacets.length)} regions`;
  }
}

function renderFacets(): void {
  const selected = new Set(state.selectedGenres);
  const query = state.genreQuery.trim();
  genreSearch.hidden = state.facets.length <= 12;

  const rows = buildFacetRows(
    visibleFacetItems(
      state.facets,
      selected,
      query,
      state.genreExpanded,
    ),
    selected,
    'data-genre-key',
  );

  if (rows.length === 0) {
    rows.push(
      el('p', {
        class: 'facet-empty',
        text: `No genres match “${state.genreQuery.trim()}”.`,
      }),
    );
  }

  genreList.replaceChildren(...rows);
  updateFacetChrome();
}

function renderRegions(): void {
  const selected = new Set(state.selectedRegions);
  const query = state.regionQuery.trim();
  regionSearch.hidden = state.regionFacets.length <= 12;

  const rows = buildFacetRows(
    visibleFacetItems(
      state.regionFacets,
      selected,
      query,
      state.regionExpanded,
      regionKey,
    ),
    selected,
    'data-region-key',
  );

  if (rows.length === 0) {
    rows.push(
      el('p', {
        class: 'facet-empty',
        text: `No regions match “${state.regionQuery.trim()}”.`,
      }),
    );
  }

  regionList.replaceChildren(...rows);
  updateRegionChrome();
}

function setGenreSelected(
  key: string,
  selected: boolean,
  options: { rerenderFacets?: boolean } = {},
): void {
  const current = new Set(state.selectedGenres);
  if (selected === current.has(key)) return;
  if (selected) current.add(key);
  else current.delete(key);

  state.selectedGenres = [...current];
  syncUrl();
  if (options.rerenderFacets === false) updateFacetChrome();
  else renderFacets();
  renderActiveFilters();
  void loadAlbums(true);
}

function setRegionSelected(
  key: string,
  selected: boolean,
  options: { rerenderFacets?: boolean } = {},
): void {
  const current = new Set(state.selectedRegions);
  if (selected === current.has(key)) return;
  if (selected) current.add(key);
  else current.delete(key);

  state.selectedRegions = [...current];
  syncUrl();
  if (options.rerenderFacets === false) updateRegionChrome();
  else renderRegions();
  renderActiveFilters();
  void loadAlbums(true);
}

function clearFilters(): void {
  state.selectedGenres = [];
  state.genreMode = 'any';
  state.selectedRegions = [];
  state.regionMode = 'any';
  state.q = '';
  searchInput.value = '';
  renderModeControls();
  syncUrl();
  renderFacets();
  renderRegions();
  renderActiveFilters();
  void loadAlbums(true);
}

function renderActiveFilters(): void {
  const chips: HTMLElement[] = [];

  for (const key of state.selectedGenres) {
    const name = state.facetByKey.get(key)?.name ?? key;
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active',
          type: 'button',
          'data-remove-genre': key,
          'aria-label': `Remove ${name} filter`,
          title: `Remove ${name} filter`,
        },
        el('span', { text: name }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  for (const key of state.selectedRegions) {
    const name = state.regionByKey.get(key)?.name ?? key;
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active chip-region',
          type: 'button',
          'data-remove-region': key,
          'aria-label': `Remove ${name} region filter`,
          title: `Remove ${name} region filter`,
        },
        el('span', { text: name }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  if (state.q) {
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active',
          type: 'button',
          'data-remove-query': 'true',
          'aria-label': 'Clear search',
          title: 'Clear search',
        },
        el('span', { text: `“${state.q}”` }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  if (chips.length > 0) {
    chips.push(
      el('button', {
        class: 'clear-all',
        type: 'button',
        'data-clear-filters': 'true',
        text: 'Clear all',
      }),
    );
  }

  activeFilters.replaceChildren(...chips);
  activeFilters.hidden = chips.length === 0;
}

/* ------------------------------------------------------------------ */
/* Album dialog                                                        */
/* ------------------------------------------------------------------ */

async function openAlbum(album: AlbumSummary): Promise<void> {
  const sequence = ++dialogSequence;
  renderDialog(album, null, true);
  if (!dialog.open) dialog.showModal();

  const cached = trackCache.get(album.key);
  if (cached) {
    renderDialog(album, cached, false);
    return;
  }

  try {
    const response = await api.tracks(album.key);
    if (sequence !== dialogSequence) return;
    trackCache.set(album.key, response);
    renderDialog(album, response, false);
  } catch (error) {
    if (sequence !== dialogSequence) return;
    renderDialog(album, null, false, describe(error));
  }
}

function renderDialog(
  album: AlbumSummary,
  tracks: TracksResponse | null,
  loading: boolean,
  error?: string,
): void {
  const closeButton = el(
    'button',
    {
      class: 'dialog-close',
      type: 'button',
      'aria-label': 'Close',
      title: 'Close',
    },
    '×',
  );
  closeButton.addEventListener('click', () => dialog.close());

  const heading = el(
    'div',
    { class: 'dialog-heading' },
    el(
      'h2',
      { class: 'dialog-title', id: 'dialog-title', text: album.album },
    ),
    el(
      'p',
      { class: 'dialog-artist' },
      ...artistNodes(album.artists, album.artist),
    ),
    el('p', { class: 'dialog-meta', text: albumMeta(album) }),
    el('p', {
      class: 'dialog-added',
      text: album.latest ? `Added ${formatDate(album.latest)}` : 'Added date unknown',
    }),
  );

  if (album.genres.length > 0) {
    const genreButtons = album.genres.slice(0, 6).map((name) => {
      const key = genreKey(name);
      const chip = el(
        'button',
        {
          class: 'chip chip-small',
          type: 'button',
          title: `Filter by ${name}`,
          'aria-pressed': state.selectedGenres.includes(key) ? 'true' : 'false',
        },
        el('span', { text: name }),
      );
      if (state.selectedGenres.includes(key)) chip.classList.add('is-active');
      chip.addEventListener('click', () => activateGenre(name));
      return chip;
    });
    heading.append(el('div', { class: 'dialog-genres' }, ...genreButtons));
  }

  if (album.regions.length > 0) {
    const regionButtons = album.regions.slice(0, 6).map((name) => {
      const key = regionKey(name);
      const chip = el(
        'button',
        {
          class: 'chip chip-small chip-region',
          type: 'button',
          title: `Filter by region: ${name}`,
          'aria-pressed': state.selectedRegions.includes(key) ? 'true' : 'false',
        },
        el('span', { text: name }),
      );
      if (state.selectedRegions.includes(key)) chip.classList.add('is-active');
      chip.addEventListener('click', () => activateRegion(name));
      return chip;
    });
    heading.append(el('div', { class: 'dialog-genres' }, ...regionButtons));
  }

  if (state.playbackEnabled && state.session.authenticated) {
    heading.append(
      el(
        'a',
        {
          class: 'dialog-play',
          href: `/play/${encodeURIComponent(album.key)}`,
          target: '_blank',
          rel: 'noopener',
        },
        el('span', { 'aria-hidden': 'true', text: '▶' }),
        el('span', { text: 'Play in Audio Station' }),
      ),
    );
  }

  const header = el(
    'div',
    { class: 'dialog-header' },
    createCover(album, 'cover-large'),
    heading,
    closeButton,
  );

  const body = el('div', { class: 'dialog-body' });
  if (loading) {
    body.setAttribute('aria-busy', 'true');
    body.append(
      el(
        'div',
        { class: 'dialog-status' },
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        'Loading tracks…',
      ),
    );
  } else if (error) {
    body.append(el('p', { class: 'dialog-status dialog-status-error', text: error }));
  } else if (tracks) {
    body.append(renderTrackGroups(tracks));
  }

  dialog.replaceChildren(el('div', { class: 'dialog-inner' }, header, body));
  if (dialog.open) closeButton.focus();
}

/** "Album // Bonus Tracks" -> "Bonus Tracks"; the plain album -> "Main album". */
function sourceLabel(source: string, album: string): string {
  const match = /^(.*?)\s+\/\/\s*(.*)$/.exec(source);
  if (match) {
    const base = (match[1] ?? '').trim();
    const label = (match[2] ?? '').trim();
    if (base === album && label) return label;
  }
  if (source.trim() === album) return 'Main album';
  return source;
}

function groupByDisc(tracks: Track[]): Map<number | null, Track[]> {
  const groups = new Map<number | null, Track[]>();
  for (const track of tracks) {
    const group = groups.get(track.disc);
    if (group) group.push(track);
    else groups.set(track.disc, [track]);
  }
  return groups;
}

function appendDiscSections(
  parent: HTMLElement,
  tracks: Track[],
  options: { showDiscHeadings: boolean; headingTag: 'h3' | 'h4' },
): void {
  const groups = groupByDisc(tracks);
  const discs = [...groups.keys()].sort((a, b) => (a ?? 1) - (b ?? 1));

  for (const disc of discs) {
    const discTracks = groups.get(disc);
    if (!discTracks) continue;

    if (options.showDiscHeadings) {
      parent.append(
        el(options.headingTag, {
          class: 'disc-heading',
          text: `Disc ${disc ?? 1}`,
        }),
      );
    }
    const list = el('ol', { class: 'track-list' });
    for (const track of discTracks) list.append(renderTrackRow(track));
    parent.append(list);
  }
}

function renderTrackGroups(response: TracksResponse): HTMLElement {
  const { album, sourceAlbums, tracks } = response;
  if (tracks.length === 0) {
    return el('p', { class: 'dialog-status', text: 'No tracks found for this album.' });
  }

  const container = el('div', { class: 'track-groups' });

  // Merged multi-CD album: keep each original title's tracks together and use
  // its label as the heading. Disc numbers often collide across the sources,
  // so grouping by `disc` alone would interleave the CDs.
  if (sourceAlbums.length > 1) {
    const bySource = new Map<string, Track[]>();
    for (const track of tracks) {
      const group = bySource.get(track.sourceAlbum);
      if (group) group.push(track);
      else bySource.set(track.sourceAlbum, [track]);
    }

    const known = new Set(sourceAlbums);
    const extras = [...bySource.keys()].filter((source) => !known.has(source));

    for (const source of [...sourceAlbums, ...extras]) {
      const sourceTracks = bySource.get(source);
      if (!sourceTracks || sourceTracks.length === 0) continue;

      const section = el('section', { class: 'track-group' });
      section.append(
        el('h3', {
          class: 'disc-heading source-heading',
          text: sourceLabel(source, album),
        }),
      );
      appendDiscSections(section, sourceTracks, {
        showDiscHeadings: groupByDisc(sourceTracks).size > 1,
        headingTag: 'h4',
      });
      container.append(section);
    }

    return container;
  }

  const section = el('section', { class: 'track-group' });
  appendDiscSections(section, tracks, {
    showDiscHeadings: groupByDisc(tracks).size > 1,
    headingTag: 'h3',
  });
  container.append(section);
  return container;
}

function renderTrackRow(track: Track): HTMLElement {
  const main = el(
    'div',
    { class: 'track-main' },
    el('span', { class: 'track-title', text: track.title }),
  );

  if (track.artist && track.artist !== track.albumArtist) {
    main.append(
      el(
        'span',
        { class: 'track-sub' },
        ...artistNodes(track.artists, track.artist),
      ),
    );
  }

  const formats = [
    formatFrequency(track.frequency),
    formatBitrate(track.bitrate),
  ].filter((value): value is string => value !== null);

  return el(
    'li',
    { class: 'track-row' },
    el('span', {
      class: 'track-number',
      text: track.track === null ? '—' : String(track.track),
    }),
    main,
    el('span', { class: 'track-format', text: formats.join(' · ') }),
    el('span', { class: 'track-duration', text: formatDuration(track.duration) }),
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

function renderSkeletons(count = SKELETON_COUNT): void {
  if (count === 0) {
    albumGrid.replaceChildren();
    albumGrid.removeAttribute('aria-busy');
    return;
  }

  albumGrid.setAttribute('aria-busy', 'true');
  const cards = Array.from({ length: count }, () =>
    el(
      'div',
      { class: 'album-card skeleton-card', 'aria-hidden': 'true' },
      el('div', { class: 'skeleton-cover' }),
      el(
        'div',
        { class: 'skeleton-lines' },
        el('div', { class: 'skeleton-line skeleton-line-lg' }),
        el('div', { class: 'skeleton-line skeleton-line-sm' }),
        el('div', { class: 'skeleton-line' }),
      ),
    ),
  );
  albumGrid.replaceChildren(...cards);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function applySearch(): void {
  window.clearTimeout(searchTimer);
  const value = searchInput.value.trim();
  if (value === state.q) return;
  state.q = value;
  syncUrl();
  renderActiveFilters();
  void loadAlbums(true);
}

function bindEvents(): void {
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applySearch();
    }
  });

  sortSelect.addEventListener('change', () => {
    if (!isSortKey(sortSelect.value) || sortSelect.value === state.sort) return;
    state.sort = sortSelect.value;
    syncUrl();
    void loadAlbums(true);
  });

  genreSearch.addEventListener('input', () => {
    state.genreQuery = genreSearch.value;
    renderFacets();
  });

  regionSearch.addEventListener('input', () => {
    state.regionQuery = regionSearch.value;
    renderRegions();
  });

  for (const input of genreModeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || !isFilterMode(input.value)) return;
      state.genreMode = input.value;
      syncUrl();
      void loadAlbums(true);
    });
  }

  for (const input of regionModeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || !isFilterMode(input.value)) return;
      state.regionMode = input.value;
      syncUrl();
      void loadAlbums(true);
    });
  }

  clearGenresButton.addEventListener('click', () => {
    if (
      state.selectedGenres.length === 0 &&
      state.genreMode === 'any'
    ) {
      return;
    }
    state.selectedGenres = [];
    state.genreMode = 'any';
    renderModeControls();
    syncUrl();
    renderFacets();
    renderActiveFilters();
    void loadAlbums(true);
  });

  clearRegionsButton.addEventListener('click', () => {
    if (
      state.selectedRegions.length === 0 &&
      state.regionMode === 'any'
    ) {
      return;
    }
    state.selectedRegions = [];
    state.regionMode = 'any';
    renderModeControls();
    syncUrl();
    renderRegions();
    renderActiveFilters();
    void loadAlbums(true);
  });

  toggleAllButton.addEventListener('click', () => {
    state.genreExpanded = !state.genreExpanded;
    renderFacets();
  });

  toggleAllRegionsButton.addEventListener('click', () => {
    state.regionExpanded = !state.regionExpanded;
    renderRegions();
  });

  genreList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.dataset.genreKey;
    if (!key) return;
    setGenreSelected(key, target.checked, { rerenderFacets: true });
  });

  regionList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.dataset.regionKey;
    if (!key) return;
    setRegionSelected(key, target.checked, { rerenderFacets: true });
  });

  activeFilters.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const removeGenre = target.closest<HTMLElement>('[data-remove-genre]');
    if (removeGenre) {
      const key = removeGenre.dataset.removeGenre;
      if (key) setGenreSelected(key, false);
      return;
    }

    const removeRegion = target.closest<HTMLElement>('[data-remove-region]');
    if (removeRegion) {
      const key = removeRegion.dataset.removeRegion;
      if (key) setRegionSelected(key, false);
      return;
    }

    if (target.closest('[data-remove-query]')) {
      state.q = '';
      searchInput.value = '';
      syncUrl();
      renderActiveFilters();
      void loadAlbums(true);
      return;
    }

    if (target.closest('[data-clear-filters]')) clearFilters();
  });

  loadMoreButton.addEventListener('click', () => void loadAlbums(false));

  $('#dismiss-error').addEventListener('click', hideError);
  $('#empty-clear').addEventListener('click', clearFilters);

  sessionButton.addEventListener('click', () => {
    if (!state.playbackEnabled) return;
    if (state.session.authenticated) void signOut();
    else openLoginDialog();
  });

  refreshButton.addEventListener('click', () => void reloadLibrary());

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollStatus();
  });
  window.addEventListener('focus', () => void pollStatus());

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitLogin();
  });
  loginCancel.addEventListener('click', closeLoginDialog);
  loginDialog.addEventListener('click', (event) => {
    if (event.target === loginDialog) closeLoginDialog();
  });
  loginDialog.addEventListener('close', () => {
    loginPassword.value = '';
    setLoginError(null);
    if (state.pendingPlayUrl) {
      state.pendingPlayUrl = null;
      state.loginRequestedFromUrl = false;
      syncUrl();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>(
      'a.album-play, a.dialog-play',
    );
    if (!link) return;
    if (state.session.authenticated) return;
    event.preventDefault();
    state.pendingPlayUrl = link.getAttribute('href');
    openLoginDialog();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialogSequence += 1;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    event.preventDefault();
    searchInput.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  // Load the session first so cards render with the correct Play visibility.
  await loadSession();
  await loadLibrary();
  startStatusPolling();
  handleLoginDeepLink();
}

readUrlState();
bindEvents();
void boot();
