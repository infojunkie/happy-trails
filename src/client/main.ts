import { Coverflow, type CoverflowItem } from '@northstarxyzz/coverflow';
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
  type TrackSummary,
  type TracksResponse,
} from '../shared/types.js';
import { artistSegments, foldSearch, regionKey } from '../shared/text.js';
import { api } from './api.js';
import { $, el } from './dom.js';
import {
  buildFacetQuery,
  facetTerm,
  parseFacetQuery,
} from './facets.js';
import { linkifiedText } from './linkify.js';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTotalDuration,
} from './format.js';

const PAGE_SIZE = 48;
const FACET_PREVIEW = 25;
const SKELETON_COUNT = 8;
const SEARCH_DEBOUNCE_MS = 400;
const STATUS_POLL_MS = 30_000;

type SearchMode = 'albums' | 'tracks';
type AlbumView = 'grid' | 'coverflow';

const ALBUM_VIEW_KEY = 'happy-trails.album-view';

interface AlbumViewMode {
  id: AlbumView;
  label: string;
  /** Inline SVG path on a 24×24 viewBox. */
  icon: string;
}

const ALBUM_VIEW_MODES: readonly AlbumViewMode[] = [
  {
    id: 'grid',
    label: 'Grid view',
    icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  },
  {
    id: 'coverflow',
    label: 'Cover Flow view',
    icon: 'M2 8 7 5v14l-5-3zM9.5 3h5v18h-5zM22 8l-5-3v14l5-3z',
  },
];

interface State {
  selectedGenres: string[];
  genreMode: FilterMode;
  facets: GenreFacet[];
  facetByKey: Map<string, GenreFacet>;
  selectedRegions: string[];
  regionMode: FilterMode;
  regionFacets: GenreFacet[];
  regionByKey: Map<string, GenreFacet>;
  selectedSeries: string[];
  seriesFacets: GenreFacet[];
  totalAlbums: number;
  totalTracks: number;
  serieQuery: string;
  serieExpanded: boolean;
  genreQuery: string;
  genreExpanded: boolean;
  regionQuery: string;
  regionExpanded: boolean;
  q: string;
  sort: SortKey;
  searchMode: SearchMode;
  albumView: AlbumView;
  albums: AlbumSummary[];
  total: number;
  tracks: TrackSummary[];
  trackTotal: number;
  playbackEnabled: boolean;
  session: SessionResponse;
  pendingPlayUrl: string | null;
  loginRequestedFromUrl: boolean;
  dialogShowAllTracks: boolean;
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
  selectedSeries: [],
  seriesFacets: [],
  totalAlbums: 0,
  totalTracks: 0,
  serieQuery: '',
  serieExpanded: false,
  genreQuery: '',
  genreExpanded: false,
  regionQuery: '',
  regionExpanded: false,
  q: '',
  sort: 'recent',
  searchMode: 'albums',
  albumView: loadAlbumView(),
  albums: [],
  total: 0,
  tracks: [],
  trackTotal: 0,
  playbackEnabled: false,
  session: { authenticated: false, account: null },
  pendingPlayUrl: null,
  loginRequestedFromUrl: false,
  dialogShowAllTracks: true,
  loadedVersion: null,
  serverVersion: null,
  libraryReady: false,
  libraryRefreshing: false,
  reloadingLibrary: false,
};

/** Live Cover Flow instance, or null when the grid is active. */
let coverflow: Coverflow | null = null;
/** True while an album page request is in flight. */
let albumsLoading = false;

const searchInput = $<HTMLInputElement>('#search');
const sortSelect = $<HTMLSelectElement>('#sort');
const modeAlbumsButton = $<HTMLButtonElement>('#mode-albums');
const modeTracksButton = $<HTMLButtonElement>('#mode-tracks');
const statsEl = $('#library-stats');
const resultSummary = $('#result-summary');
const albumGrid = $('#album-grid');
const coverflowEl = $('#album-coverflow');
const coverflowCaption = $('#coverflow-caption');
const viewSwitch = $('#view-switch');
const trackList = $<HTMLUListElement>('#track-list');
const emptyState = $('#empty-state');
const emptyTitle = $('#empty-title');
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
const serieList = $('#serie-list');
const serieSearch = $<HTMLInputElement>('#serie-search');
const clearSerieButton = $<HTMLButtonElement>('#clear-serie');
const toggleAllSeriesButton = $<HTMLButtonElement>('#toggle-all-series');
const genreModeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="genre-mode"]',
);
const regionModeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="region-mode"]',
);
const genreToggle = $<HTMLButtonElement>('#genre-toggle');
const genrePanel = $('#genre-panel');
const regionToggle = $<HTMLButtonElement>('#region-toggle');
const regionPanel = $('#region-panel');
const serieToggle = $<HTMLButtonElement>('#serie-toggle');
const seriePanel = $('#serie-panel');
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
const searchHelpButton = $<HTMLButtonElement>('#search-help-button');
const searchHelpDialog = $<HTMLDialogElement>('#search-help-dialog');
const searchHelpClose = $<HTMLButtonElement>('#search-help-close');

const trackCache = new Map<string, TracksResponse>();
let requestSequence = 0;
let dialogSequence = 0;
let searchTimer: number | undefined;
let searchSessionActive = false;
let albumAbort: AbortController | null = null;
let trackAbort: AbortController | null = null;
let retryTimer: number | undefined;
let statusPollTimer: number | undefined;
let suppressDialogCloseHistory = false;
let lastSyncedUrl = '';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function genreKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function serieKey(name: string): string {
  return foldSearch(name).replace(/\s+/g, ' ').trim();
}

function selectedGenreKeys(): Set<string> {
  return new Set(state.selectedGenres.map(genreKey));
}

function selectedRegionKeys(): Set<string> {
  return new Set(state.selectedRegions.map(regionKey));
}

function selectedSeriesKeys(): Set<string> {
  return new Set(state.selectedSeries.map(serieKey));
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

interface FacetDisclosure {
  toggle: HTMLButtonElement;
  panel: HTMLElement;
  section: HTMLElement;
}

function facetDisclosure(
  toggle: HTMLButtonElement,
  panel: HTMLElement,
): FacetDisclosure {
  const section = panel.closest<HTMLElement>('.facet-section');
  if (!section) throw new Error('Facet panel is missing its section');
  return { toggle, panel, section };
}

const facetDisclosures = [
  facetDisclosure(genreToggle, genrePanel),
  facetDisclosure(regionToggle, regionPanel),
  facetDisclosure(serieToggle, seriePanel),
];

function setFacetCollapsed(
  disclosure: FacetDisclosure,
  collapsed: boolean,
): void {
  disclosure.toggle.setAttribute('aria-expanded', String(!collapsed));
  disclosure.panel.hidden = collapsed;
  disclosure.section.classList.toggle('is-collapsed', collapsed);
}

function setAllFacetsCollapsed(collapsed: boolean): void {
  for (const disclosure of facetDisclosures) {
    setFacetCollapsed(disclosure, collapsed);
  }
}

function renderModeControls(): void {
  for (const input of genreModeInputs) {
    input.checked = input.value === state.genreMode;
  }
  for (const input of regionModeInputs) {
    input.checked = input.value === state.regionMode;
  }
}

function loadAlbumView(): AlbumView {
  try {
    return localStorage.getItem(ALBUM_VIEW_KEY) === 'coverflow'
      ? 'coverflow'
      : 'grid';
  } catch {
    return 'grid';
  }
}

function saveAlbumView(view: AlbumView): void {
  try {
    localStorage.setItem(ALBUM_VIEW_KEY, view);
  } catch {
    // localStorage may be unavailable; the current session still keeps it.
  }
}

function viewIcon(pathData: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** One icon button per available album view, driven by the mode registry. */
function renderViewSwitch(): void {
  viewSwitch.replaceChildren(
    ...ALBUM_VIEW_MODES.map((mode) => {
      const button = el(
        'button',
        {
          class: 'view-switch-option',
          type: 'button',
          title: mode.label,
          'aria-label': mode.label,
          'aria-pressed': String(state.albumView === mode.id),
          'data-view': mode.id,
        },
        viewIcon(mode.icon),
      );
      button.addEventListener('click', () => setAlbumView(mode.id));
      return button;
    }),
  );
}

function syncAlbumViewVisibility(): void {
  const tracks = state.searchMode === 'tracks';
  const flow = !tracks && state.albumView === 'coverflow';
  viewSwitch.hidden = tracks;
  albumGrid.hidden = tracks || flow;
  coverflowEl.hidden = !flow;
  if (!flow) disposeCoverflow();
}

function setAlbumView(view: AlbumView): void {
  if (state.albumView === view) return;
  state.albumView = view;
  saveAlbumView(view);
  renderViewSwitch();
  syncAlbumViewVisibility();
  if (state.searchMode !== 'albums') return;

  if (albumsLoading && state.albums.length === 0) {
    if (view === 'coverflow') renderCoverflowStatus('Loading albums…');
    else renderSkeletons();
    return;
  }
  renderAlbums();
}

/** Reflect the Albums/Tracks switch and the mode-specific result chrome. */
function renderSearchMode(): void {
  const tracks = state.searchMode === 'tracks';
  modeAlbumsButton.setAttribute('aria-pressed', String(!tracks));
  modeTracksButton.setAttribute('aria-pressed', String(tracks));
  trackList.hidden = !tracks;
  emptyTitle.textContent = tracks ? 'No tracks found' : 'No albums found';
  loadMoreButton.textContent = tracks ? 'Load more tracks' : 'Load more albums';
  searchInput.placeholder = tracks
    ? 'Search tracks…'
    : 'Search the mediatheque…';
  syncAlbumViewVisibility();
}

function setSearchMode(mode: SearchMode): void {
  if (state.searchMode === mode) return;

  state.searchMode = mode;
  searchSessionActive = false;
  albumAbort?.abort();
  trackAbort?.abort();
  renderSearchMode();
  renderFacets();
  renderRegions();
  renderSeries();
  pushFilterState();
  window.scrollTo({ top: 0 });
  void loadResults(true);
}

/** Load one page for the active mode. */
function loadResults(reset: boolean): Promise<number | null> {
  return state.searchMode === 'tracks'
    ? loadTrackResults(reset)
    : loadAlbums(reset);
}

function renderResults(): void {
  if (state.searchMode === 'tracks') renderTrackResults();
  else renderAlbums();
}

function renderCurrentSkeletons(count = SKELETON_COUNT): void {
  if (state.searchMode === 'tracks') renderTrackSkeletons(count);
  else renderAlbumSkeletons(count);
}

/** The facet controls mirror a query made only of facet terms. */
function syncSelectionsFromQuery(): void {
  const parsed = parseFacetQuery(state.q);
  if (parsed) {
    state.selectedGenres = parsed.genres;
    state.genreMode = parsed.genreMode;
    state.selectedRegions = parsed.regions;
    state.regionMode = parsed.regionMode;
    state.selectedSeries = parsed.series;
  } else {
    state.selectedGenres = [];
    state.genreMode = 'any';
    state.selectedRegions = [];
    state.regionMode = 'any';
    state.selectedSeries = [];
  }
  renderModeControls();
}

/** Facet controls rebuild the top query from the selected terms. */
function applyFacetSelection(): void {
  const query = buildFacetQuery({
    genres: state.selectedGenres,
    genreMode: state.genreMode,
    regions: state.selectedRegions,
    regionMode: state.regionMode,
    series: state.selectedSeries,
  });
  if (state.q === query) return;

  window.clearTimeout(searchTimer);
  state.q = query;
  searchInput.value = query;
  pushFilterState();
  renderFacets();
  renderRegions();
  renderSeries();
  renderModeControls();
  renderActiveFilters();
  void loadResults(true);
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

  const tracksMode = state.searchMode === 'tracks';
  state.reloadingLibrary = true;
  albumAbort?.abort();
  trackAbort?.abort();
  const controller = new AbortController();
  if (tracksMode) trackAbort = controller;
  else albumAbort = controller;
  requestSequence += 1;
  searchSessionActive = false;
  loadMoreButton.disabled = true;
  updateRefreshControl();

  try {
    const facets = await api.genres();
    let libraryVersion: number;

    if (tracksMode) {
      const response = await api.searchTracks(
        {
          q: state.q,
          sort: state.sort,
          offset: 0,
          limit: PAGE_SIZE,
        },
        controller.signal,
      );
      state.trackTotal = response.total;
      state.tracks = response.tracks;
      libraryVersion = response.libraryVersion;
    } else {
      const response = await api.albums(
        {
          q: state.q,
          sort: state.sort,
          offset: 0,
          limit: PAGE_SIZE,
        },
        controller.signal,
      );
      state.total = response.total;
      state.albums = response.albums;
      libraryVersion = response.libraryVersion;
    }

    state.facets = facets.genres;
    state.facetByKey = new Map(
      facets.genres.map((genre) => [genre.key, genre]),
    );
    state.regionFacets = facets.regions;
    state.regionByKey = new Map(
      facets.regions.map((region) => [region.key, region]),
    );
    state.seriesFacets = facets.series;
    state.totalAlbums = facets.totalAlbums;
    state.loadedVersion = Math.min(facets.libraryVersion, libraryVersion);
    state.libraryReady = true;
    const newestVersion = Math.max(facets.libraryVersion, libraryVersion);
    if (
      state.serverVersion === null ||
      newestVersion > state.serverVersion
    ) {
      state.serverVersion = newestVersion;
    }

    closeDialogForReload();
    trackCache.clear();
    renderFacets();
    renderRegions();
    renderSeries();
    renderResults();
    renderSearchMode();
    albumGrid.removeAttribute('aria-busy');
    trackList.removeAttribute('aria-busy');
    hideError();
    window.scrollTo({ top: 0 });
    void pollStatus();
  } catch (error) {
    if (controller.signal.aborted) return;
    showError(describe(error));
  } finally {
    if (albumAbort === controller) albumAbort = null;
    if (trackAbort === controller) trackAbort = null;
    state.reloadingLibrary = false;
    loadMoreButton.disabled = false;
    albumGrid.removeAttribute('aria-busy');
    trackList.removeAttribute('aria-busy');
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
  if (state.searchMode === 'tracks') {
    if (state.tracks.length > 0) renderTrackResults();
  } else if (state.albums.length > 0) {
    renderAlbums();
  }
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

function applyFilterParams(params: URLSearchParams): void {
  state.q = (params.get('q') ?? '').slice(0, 200);
  const sort = params.get('sort');
  state.sort = isSortKey(sort) ? sort : 'recent';
  state.searchMode = params.get('view') === 'tracks' ? 'tracks' : 'albums';
  searchInput.value = state.q;
  sortSelect.value = state.sort;
  syncSelectionsFromQuery();
  renderSearchMode();
}

function readFilterState(): void {
  applyFilterParams(new URLSearchParams(location.search));
}

function readUrlState(): void {
  const params = new URLSearchParams(location.search);
  applyFilterParams(params);

  const login = params.get('login') === '1';
  const playTrackId = params.get('playTrack');
  const playKey = params.get('play');
  const playQuery = params.get('playQuery');
  if (login && playTrackId && /^\d+$/.test(playTrackId)) {
    state.loginRequestedFromUrl = true;
    state.pendingPlayUrl = `/play/track/${encodeURIComponent(playTrackId)}`;
  } else if (login && playKey) {
    state.loginRequestedFromUrl = true;
    state.pendingPlayUrl = `/play/${encodeURIComponent(playKey)}${
      playQuery ? `?q=${encodeURIComponent(playQuery)}` : ''
    }`;
  }
}

function albumFromHistoryState(): AlbumSummary | null {
  const candidate = (history.state as { album?: unknown } | null)?.album;
  if (!candidate || typeof candidate !== 'object') return null;
  const album = candidate as Partial<AlbumSummary>;
  if (
    typeof album.key !== 'string' ||
    typeof album.album !== 'string' ||
    typeof album.artist !== 'string'
  ) {
    return null;
  }
  return album as AlbumSummary;
}

function currentUrl(): string {
  return `${location.pathname}${location.search}`;
}

function buildFilterUrl(): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.sort !== 'recent') params.set('sort', state.sort);
  if (state.searchMode === 'tracks') params.set('view', 'tracks');
  const query = params.toString();
  return query ? `${location.pathname}?${query}` : location.pathname;
}

interface SyncUrlOptions {
  push?: boolean;
  /** undefined preserves the current history state; null clears the modal. */
  album?: AlbumSummary | null;
}

function syncUrl(options: SyncUrlOptions = {}): void {
  const url = buildFilterUrl();
  let nextState: unknown = history.state;
  if (options.album !== undefined) {
    nextState = options.album === null ? null : { album: options.album };
  }

  if (options.push) {
    searchSessionActive = false;
    history.pushState(nextState, '', url);
  } else {
    history.replaceState(nextState, '', url);
  }
  lastSyncedUrl = currentUrl();
}

/** Record a search/filter/sort state without changing the open album modal. */
function pushFilterState(): boolean {
  const url = buildFilterUrl();
  if (url === currentUrl() && albumFromHistoryState() === null) return false;
  searchSessionActive = false;
  history.pushState(null, '', url);
  lastSyncedUrl = currentUrl();
  return true;
}

function handlePopState(): void {
  window.clearTimeout(searchTimer);
  searchSessionActive = false;

  const url = currentUrl();
  const filtersChanged = url !== lastSyncedUrl;
  lastSyncedUrl = url;

  if (filtersChanged) {
    readFilterState();
    renderFacets();
    renderRegions();
    renderSeries();
    renderActiveFilters();
  }

  const album = albumFromHistoryState();
  if (album) {
    void openAlbum(album, { recordHistory: false });
  } else if (dialog.open) {
    closeDialogWithoutHistory();
  }

  if (filtersChanged) {
    window.scrollTo({ top: 0 });
    void loadResults(true);
  }
}

async function loadLibrary(): Promise<void> {
  window.clearTimeout(retryTimer);
  renderCurrentSkeletons();
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
      renderCurrentSkeletons(0);
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
    state.seriesFacets = response.series;
    state.totalAlbums = response.totalAlbums;
    renderFacets();
    renderRegions();
    renderSeries();
    hideError();
    const resultsVersion = await loadResults(true);
    if (resultsVersion !== null) {
      state.loadedVersion = Math.min(facetsVersion, resultsVersion);
    }
    updateRefreshControl();
  } catch (error) {
    state.libraryReady = false;
    renderCurrentSkeletons(0);
    setSummary('Unable to load the library');
    showError(describe(error));
    updateRefreshControl();
    retryTimer = window.setTimeout(() => void loadLibrary(), 5000);
  }
}

function renderStats(status: StatusResponse): void {
  state.totalAlbums = status.albumCount;
  state.totalTracks = status.trackCount;
  statsEl.textContent = `${formatCount(status.albumCount)} albums · ${formatCount(status.trackCount)} tracks`;
  statsEl.title = status.lastRefreshed
    ? `Library indexed ${formatDateTime(status.lastRefreshed)}`
    : '';
}

/* ------------------------------------------------------------------ */
/* Albums                                                              */
/* ------------------------------------------------------------------ */

async function loadAlbums(reset: boolean): Promise<number | null> {
  albumAbort?.abort();
  const controller = new AbortController();
  albumAbort = controller;
  const sequence = ++requestSequence;

  albumsLoading = true;
  if (reset) {
    state.albums = [];
    loadMoreButton.hidden = true;
    emptyState.hidden = true;
    renderAlbumSkeletons();
  }
  setSummary(reset ? 'Loading…' : `Loading more of ${formatCount(state.total)}…`);
  loadMoreButton.disabled = true;

  try {
    const response = await api.albums(
      {
        q: state.q,
        sort: state.sort,
        offset: reset ? 0 : state.albums.length,
        limit: PAGE_SIZE,
      },
      controller.signal,
    );
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
    if (sequence !== requestSequence || controller.signal.aborted) {
      return null;
    }
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
    if (albumAbort === controller) {
      albumAbort = null;
      albumsLoading = false;
    }
    if (sequence === requestSequence) {
      albumGrid.removeAttribute('aria-busy');
      coverflowEl.removeAttribute('aria-busy');
      loadMoreButton.disabled = false;
      updateRefreshControl();
    }
  }
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (sector < 1) {
    r = chroma;
    g = x;
  } else if (sector < 2) {
    r = x;
    g = chroma;
  } else if (sector < 3) {
    g = chroma;
    b = x;
  } else if (sector < 4) {
    g = x;
    b = chroma;
  } else if (sector < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const base = l - chroma / 2;
  const channel = (value: number): string =>
    Math.round((value + base) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Placeholder accent matching the grid covers' key-derived hue. */
function coverAccent(key: string): string {
  return hslToHex(hashString(key) % 360, 42, 38);
}

function coverflowItems(): CoverflowItem[] {
  return state.albums.map((album) => ({
    id: album.key,
    title: album.album,
    subtitle: [album.artist, album.year === null ? '' : String(album.year)]
      .filter(Boolean)
      .join(' · '),
    artwork: `/api/albums/${encodeURIComponent(album.key)}/cover`,
    accent: coverAccent(album.key),
  }));
}

function renderCoverflowCaption(album: AlbumSummary | undefined): void {
  if (!album) {
    coverflowCaption.hidden = true;
    coverflowCaption.replaceChildren();
    return;
  }

  const title = el('button', {
    class: 'coverflow-caption-title',
    type: 'button',
    text: album.album,
    'aria-haspopup': 'dialog',
    'aria-label': `Open ${album.album} by ${album.artist}`,
  });
  title.addEventListener('click', () => void openAlbum(album));

  const meta: Array<Node | string> = [
    ...artistNodes(album.artists, album.artist),
  ];
  if (album.year !== null) meta.push(' · ', String(album.year));

  coverflowCaption.replaceChildren(
    title,
    el('span', { class: 'coverflow-caption-meta' }, ...meta),
  );
  coverflowCaption.hidden = false;
}

function disposeCoverflow(): void {
  coverflow?.dispose();
  coverflow = null;
  coverflowEl.replaceChildren();
  coverflowEl.removeAttribute('aria-busy');
  renderCoverflowCaption(undefined);
}

function renderCoverflowStatus(text: string | null): void {
  disposeCoverflow();
  if (text === null) return;
  coverflowEl.setAttribute('aria-busy', 'true');
  coverflowEl.append(
    el(
      'p',
      { class: 'coverflow-status' },
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('span', { text }),
    ),
  );
}

function renderAlbumSkeletons(count = SKELETON_COUNT): void {
  if (state.albumView === 'coverflow') {
    renderCoverflowStatus(count === 0 ? null : 'Loading albums…');
    return;
  }
  renderSkeletons(count);
}

function renderCoverflow(): void {
  coverflowEl.removeAttribute('aria-busy');
  if (state.albums.length === 0) {
    disposeCoverflow();
    return;
  }

  const items = coverflowItems();
  if (coverflow) {
    coverflow.setItems(items);
    renderCoverflowCaption(state.albums[coverflow.state.selectedIndex]);
    return;
  }

  coverflowEl.replaceChildren();
  coverflow = new Coverflow(coverflowEl, {
    items,
    label: 'Album covers',
    reflection: true,
    maxCardSize: 360,
    onSelect: (item) => {
      renderCoverflowCaption(
        state.albums.find((candidate) => candidate.key === item.id),
      );
    },
    onAction: (item) => {
      const album = state.albums.find((candidate) => candidate.key === item.id);
      if (album) void openAlbum(album);
    },
  });
  renderCoverflowCaption(state.albums[coverflow.state.selectedIndex]);
}

function renderAlbums(): void {
  if (state.searchMode === 'albums' && state.albumView === 'coverflow') {
    renderCoverflow();
  } else {
    albumGrid.replaceChildren(...state.albums.map(renderAlbumCard));
  }
  emptyState.hidden = state.albums.length > 0;
  loadMoreButton.hidden =
    state.albums.length === 0 || state.albums.length >= state.total;
  updateSummary();
  renderActiveFilters();
}

async function loadTrackResults(reset: boolean): Promise<number | null> {
  trackAbort?.abort();
  const controller = new AbortController();
  trackAbort = controller;
  const sequence = ++requestSequence;

  if (reset) {
    state.tracks = [];
    loadMoreButton.hidden = true;
    emptyState.hidden = true;
    renderTrackSkeletons();
  }
  setSummary(
    reset ? 'Loading…' : `Loading more of ${formatCount(state.trackTotal)}…`,
  );
  loadMoreButton.disabled = true;

  try {
    const response = await api.searchTracks(
      {
        q: state.q,
        sort: state.sort,
        offset: reset ? 0 : state.tracks.length,
        limit: PAGE_SIZE,
      },
      controller.signal,
    );
    if (sequence !== requestSequence) return null;

    state.trackTotal = response.total;
    state.tracks = reset
      ? response.tracks
      : [...state.tracks, ...response.tracks];
    state.libraryReady = true;
    if (
      state.serverVersion === null ||
      response.libraryVersion > state.serverVersion
    ) {
      state.serverVersion = response.libraryVersion;
    }
    renderTrackResults();
    hideError();
    updateRefreshControl();
    return response.libraryVersion;
  } catch (error) {
    if (sequence !== requestSequence || controller.signal.aborted) {
      return null;
    }
    showError(describe(error));
    if (reset) {
      state.tracks = [];
      state.trackTotal = 0;
      renderTrackResults();
      // An API failure is not the same thing as an empty result set.
      emptyState.hidden = true;
    }
    updateRefreshControl();
    return null;
  } finally {
    if (trackAbort === controller) trackAbort = null;
    if (sequence === requestSequence) {
      trackList.removeAttribute('aria-busy');
      loadMoreButton.disabled = false;
      updateRefreshControl();
    }
  }
}

function renderTrackResults(): void {
  trackList.replaceChildren(...state.tracks.map(renderTrackResult));
  emptyState.hidden = state.tracks.length > 0;
  loadMoreButton.hidden =
    state.tracks.length === 0 || state.tracks.length >= state.trackTotal;
  updateSummary();
  renderActiveFilters();
}

function updateSummary(): void {
  const filtered =
    state.q.length > 0 ||
    state.selectedGenres.length > 0 ||
    state.selectedRegions.length > 0 ||
    state.selectedSeries.length > 0;

  if (state.searchMode === 'tracks') {
    setSummary(
      filtered
        ? `${formatCount(state.trackTotal)} of ${formatCount(state.totalTracks)} tracks`
        : `${formatCount(state.trackTotal)} tracks`,
    );
    return;
  }

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

function createCover(
  album: Pick<AlbumSummary, 'key' | 'album'>,
  extraClass = '',
): HTMLElement {
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
  query = value,
): HTMLButtonElement {
  const button = el('button', {
    class: className,
    type: 'button',
    text: label,
    title: `Search for ${value}`,
    'aria-label': `Search for ${value}`,
  });
  button.addEventListener('click', () => navigateToSearch(query));
  return button;
}

function composerQueryFor(name: string): string {
  return `composer:"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
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

/**
 * Close the album dialog as part of another navigation. The new search/filter
 * state becomes the next history entry, while the album entry stays behind it
 * so Back can reopen the dialog.
 */
function closeDialogWithoutHistory(): void {
  if (!dialog.open) return;
  suppressDialogCloseHistory = true;
  dialog.close();
}

/** Refresh closes the dialog too, but should not traverse history. */
function closeDialogForReload(): void {
  if (!dialog.open) return;
  closeDialogWithoutHistory();
  syncUrl({ album: null });
}

function navigateToSearch(value: string): void {
  const query = value.trim();
  if (!query) return;

  window.clearTimeout(searchTimer);
  state.q = query;
  syncSelectionsFromQuery();
  searchInput.value = query;
  closeDialogWithoutHistory();
  pushFilterState();
  renderFacets();
  renderRegions();
  renderSeries();
  renderActiveFilters();
  window.scrollTo({ top: 0 });
  void loadResults(true);
}

function clearSerie(): void {
  if (state.selectedSeries.length === 0) return;
  state.selectedSeries = [];
  applyFacetSelection();
}

function activateGenre(name: string): void {
  const key = genreKey(name);
  const changed = !state.selectedGenres.some(
    (value) => genreKey(value) === key,
  );
  closeDialogWithoutHistory();
  setGenreSelected(name, true);
  if (!changed) pushFilterState();
  window.scrollTo({ top: 0 });
}

function activateRegion(name: string): void {
  const key = regionKey(name);
  const changed = !state.selectedRegions.some(
    (value) => regionKey(value) === key,
  );
  closeDialogWithoutHistory();
  setRegionSelected(name, true);
  if (!changed) pushFilterState();
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

  const tags = el('div', { class: 'album-genres tag-list' });

  if (state.playbackEnabled && state.session.authenticated) {
    tags.append(
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
        el('span', { class: 'play-icon', 'aria-hidden': 'true' }),
        el('span', { text: 'Play' }),
      ),
    );
  }

  appendTagChips(tags, album.genres, album.regions, {
    genres: 3,
    regions: 2,
  });

  return el(
    'article',
    { class: 'album-card' },
    coverButton,
    info,
    tags,
  );
}

/* ------------------------------------------------------------------ */
/* Tracks                                                              */
/* ------------------------------------------------------------------ */

function createGenreChip(name: string): HTMLElement {
  const key = genreKey(name);
  const selected = selectedGenreKeys().has(key);
  const chip = el(
    'button',
    {
      class: `chip chip-small${selected ? ' is-active' : ''}`,
      type: 'button',
      title: `Filter by ${name}`,
      'aria-pressed': selected ? 'true' : 'false',
    },
    el('span', { text: name }),
  );
  chip.addEventListener('click', () => activateGenre(name));
  return chip;
}

function createRegionChip(name: string): HTMLElement {
  const key = regionKey(name);
  const selected = selectedRegionKeys().has(key);
  const chip = el(
    'button',
    {
      class: `chip chip-small chip-region${selected ? ' is-active' : ''}`,
      type: 'button',
      title: `Filter by region: ${name}`,
      'aria-pressed': selected ? 'true' : 'false',
    },
    el('span', { text: name }),
  );
  chip.addEventListener('click', () => activateRegion(name));
  return chip;
}

interface TagLimits {
  genres: number;
  regions: number;
}

/**
 * Append genre and region chips to a container, hiding the overflow behind a
 * +N button. The container needs the `tag-list` class so the `chip-extra`
 * chips can be revealed by toggling `is-expanded`.
 */
function appendTagChips(
  container: HTMLElement,
  genres: readonly string[],
  regions: readonly string[],
  limits: TagLimits,
): void {
  let hidden = 0;
  const append = (chip: HTMLElement, visible: boolean): void => {
    if (!visible) {
      chip.classList.add('chip-extra');
      hidden += 1;
    }
    container.append(chip);
  };

  genres.forEach((name, index) => {
    append(createGenreChip(name), index < limits.genres);
  });
  regions.forEach((name, index) => {
    append(createRegionChip(name), index < limits.regions);
  });

  if (hidden === 0) return;

  const hiddenNames = [
    ...genres.slice(limits.genres),
    ...regions.slice(limits.regions),
  ];
  const more = el('button', {
    class: 'chip chip-more',
    type: 'button',
    'aria-expanded': 'false',
    'aria-label': `Show ${hidden} more tags`,
    title: hiddenNames.join(', '),
    text: `+${hidden} more`,
  });
  more.addEventListener('click', () => {
    const expanded = container.classList.toggle('is-expanded');
    more.setAttribute('aria-expanded', String(expanded));
    more.setAttribute(
      'aria-label',
      expanded ? 'Show fewer tags' : `Show ${hidden} more tags`,
    );
    more.textContent = expanded ? 'Show less' : `+${hidden} more`;
  });
  container.append(more);
}

/** Open the album dialog for a track result with no track-list filter. */
async function openAlbumFromTrack(track: TrackSummary): Promise<void> {
  try {
    const album = await api.album(track.albumKey);
    await openAlbum(album, { query: '' });
  } catch (error) {
    showError(describe(error));
  }
}

function renderTrackResult(track: TrackSummary): HTMLElement {
  const openLabel = `Open ${track.album} by ${track.albumArtist}`;

  const coverButton = el(
    'button',
    {
      class: 'track-result-cover',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': openLabel,
    },
    createCover({ key: track.albumKey, album: track.album }),
  );
  coverButton.addEventListener('click', () => void openAlbumFromTrack(track));

  const titleButton = el('button', {
    class: 'track-result-title',
    type: 'button',
    text: track.title,
    'aria-haspopup': 'dialog',
    'aria-label': openLabel,
  });
  titleButton.addEventListener('click', () => void openAlbumFromTrack(track));

  const albumButton = el('button', {
    class: 'track-result-album link-like',
    type: 'button',
    text: track.album,
    title:
      track.sourceAlbum && track.sourceAlbum !== track.album
        ? track.sourceAlbum
        : track.album,
    'aria-haspopup': 'dialog',
    'aria-label': openLabel,
  });
  albumButton.addEventListener('click', () => void openAlbumFromTrack(track));

  const tags = el('div', { class: 'track-result-tags tag-list' });
  appendTagChips(tags, track.genres, track.regions, {
    genres: 2,
    regions: 2,
  });

  const play =
    state.playbackEnabled && state.session.authenticated
      ? el(
          'a',
          {
            class: 'track-play',
            href: `/play/track/${track.id}`,
            target: '_blank',
            rel: 'noopener',
            title: `Play ${track.title} in Audio Station`,
            'aria-label': `Play ${track.title} in Audio Station`,
          },
          el('span', { class: 'play-icon', 'aria-hidden': 'true' }),
        )
      : null;

  return el(
    'li',
    { class: 'track-result' },
    coverButton,
    el(
      'div',
      { class: 'track-result-main' },
      titleButton,
      el(
        'span',
        { class: 'track-result-artist' },
        ...artistNodes(track.artists, track.artist),
      ),
    ),
    albumButton,
    tags,
    el('span', {
      class: 'track-result-duration',
      text: formatDuration(track.duration),
    }),
    ...(play ? [play] : []),
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
          title:
            state.searchMode === 'tracks'
              ? 'Count of matching albums'
              : undefined,
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

function updateSerieChrome(): void {
  clearSerieButton.hidden = state.selectedSeries.length === 0;
  const hasQuery = state.serieQuery.trim().length > 0;
  const canToggle = state.seriesFacets.length > FACET_PREVIEW && !hasQuery;
  toggleAllSeriesButton.hidden = !canToggle;
  if (canToggle) {
    toggleAllSeriesButton.textContent = state.serieExpanded
      ? 'Show fewer series'
      : `Show all ${formatCount(state.seriesFacets.length)} series`;
  }
}

function renderSeries(): void {
  const selected = selectedSeriesKeys();
  const query = state.serieQuery.trim();
  serieSearch.hidden = state.seriesFacets.length <= 12;

  const items = visibleFacetItems(
    state.seriesFacets,
    selected,
    query,
    state.serieExpanded,
    serieKey,
  );
  const rows: HTMLElement[] = items.map((facet) => {
    const input = el('input', {
      type: 'checkbox',
      value: facet.key,
      'data-serie-key': facet.key,
    });
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
        title:
          state.searchMode === 'tracks'
            ? 'Count of matching albums'
            : undefined,
      }),
    );
  });

  if (rows.length === 0) {
    rows.push(
      el('p', {
        class: 'facet-empty',
        text: `No series match “${state.serieQuery.trim()}”.`,
      }),
    );
  }

  serieList.replaceChildren(...rows);
  serieList.classList.toggle('is-expanded', state.serieExpanded);
  updateSerieChrome();
}

function renderFacets(): void {
  const selected = selectedGenreKeys();
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
  genreList.classList.toggle('is-expanded', state.genreExpanded);
  updateFacetChrome();
}

function renderRegions(): void {
  const selected = selectedRegionKeys();
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
  regionList.classList.toggle('is-expanded', state.regionExpanded);
  updateRegionChrome();
}

function setGenreSelected(name: string, selected: boolean): void {
  const key = genreKey(name);
  const next = state.selectedGenres.filter(
    (value) => genreKey(value) !== key,
  );
  if (selected) next.push(name);
  state.selectedGenres = next;
  applyFacetSelection();
}

function setRegionSelected(name: string, selected: boolean): void {
  const key = regionKey(name);
  const next = state.selectedRegions.filter(
    (value) => regionKey(value) !== key,
  );
  if (selected) next.push(name);
  state.selectedRegions = next;
  applyFacetSelection();
}

function setSerieSelected(name: string, selected: boolean): void {
  const key = serieKey(name);
  const next = state.selectedSeries.filter(
    (value) => serieKey(value) !== key,
  );
  if (selected) next.push(name);
  state.selectedSeries = next;
  applyFacetSelection();
}

function clearFilters(): void {
  state.selectedGenres = [];
  state.genreMode = 'any';
  state.selectedRegions = [];
  state.regionMode = 'any';
  state.selectedSeries = [];
  state.q = '';
  searchInput.value = '';
  renderModeControls();
  pushFilterState();
  renderFacets();
  renderRegions();
  renderSeries();
  renderActiveFilters();
  void loadResults(true);
}

function renderActiveFilters(): void {
  const chips: HTMLElement[] = [];

  for (const name of state.selectedGenres) {
    const term = facetTerm('genre', name);
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active',
          type: 'button',
          'data-remove-genre': name,
          'aria-label': `Remove ${term}`,
          title: `Remove ${term}`,
        },
        el('span', { text: term }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  for (const name of state.selectedRegions) {
    const term = facetTerm('region', name);
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active chip-region',
          type: 'button',
          'data-remove-region': name,
          'aria-label': `Remove ${term}`,
          title: `Remove ${term}`,
        },
        el('span', { text: term }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  for (const name of state.selectedSeries) {
    const term = facetTerm('serie', name);
    chips.push(
      el(
        'button',
        {
          class: 'chip is-active',
          type: 'button',
          'data-remove-serie': name,
          'aria-label': `Remove ${term}`,
          title: `Remove ${term}`,
        },
        el('span', { text: term }),
        el('span', { class: 'chip-x', 'aria-hidden': 'true', text: '×' }),
      ),
    );
  }

  const hasFacets =
    state.selectedGenres.length > 0 ||
    state.selectedRegions.length > 0 ||
    state.selectedSeries.length > 0;
  if (state.q && !hasFacets) {
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
        el('span', { text: `${state.q}` }),
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

async function openAlbum(
  album: AlbumSummary,
  options: { recordHistory?: boolean; query?: string } = {},
): Promise<void> {
  if (options.recordHistory !== false) {
    syncUrl({ push: true, album });
  }

  const sequence = ++dialogSequence;
  // In Tracks mode the top search filters track rows, not the album's track
  // list, so the dialog opens unfiltered. This also covers reopening a dialog
  // from history after a reload.
  const query =
    options.query ??
    (state.searchMode === 'tracks' ? '' : state.q.trim());
  const cacheKey = `${album.key}\u0000${query}`;
  state.dialogShowAllTracks = query.length === 0;

  const cached = trackCache.get(cacheKey);
  let currentTracks: TracksResponse | null = cached ?? null;
  let loading = !cached;
  let currentError: string | undefined;
  let artworkAvailable = false;

  const render = (focusClose: boolean): void => {
    if (sequence !== dialogSequence) return;
    renderDialog(
      album,
      currentTracks,
      loading,
      currentError,
      focusClose,
      artworkAvailable,
    );
  };

  render(true);
  if (!dialog.open) dialog.showModal();

  void api.artworkAvailable(album.key).then((available) => {
    if (sequence !== dialogSequence || !available) return;
    artworkAvailable = true;
    render(false);
  });

  if (cached) return;

  try {
    const response = await api.tracks(album.key, query);
    if (sequence !== dialogSequence) return;
    trackCache.set(cacheKey, response);
    currentTracks = response;
    loading = false;
    render(false);
  } catch (error) {
    if (sequence !== dialogSequence) return;
    loading = false;
    currentError = describe(error);
    render(false);
  }
}

/**
 * The album's deduplicated track comments, shown in the dialog header beneath
 * the tag pills. Comments are kept whole; the dialog body scrolls separately.
 */
function renderDialogComments(comments: string[]): HTMLElement | null {
  if (comments.length === 0) return null;

  const list = el('ul', {
    class: 'dialog-comments',
    'aria-label': 'Track comments',
  });
  for (const comment of comments) {
    list.append(
      el(
        'li',
        { class: 'dialog-comment', title: comment },
        ...linkifiedText(comment),
      ),
    );
  }
  return list;
}

function renderDialog(
  album: AlbumSummary,
  tracks: TracksResponse | null,
  loading: boolean,
  error?: string,
  focusClose = true,
  artworkAvailable = false,
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

  // Genres and regions share one wrapping row, regions following genres.
  const tags = el('div', { class: 'dialog-genres tag-list' });
  appendTagChips(tags, album.genres, album.regions, {
    genres: 6,
    regions: 6,
  });
  if (tags.childElementCount > 0) heading.append(tags);

  const series = album.series ?? [];
  if (series.length > 0) {
    const serieChips = series.map((name) => {
      const query = facetTerm('serie', name);
      const chip = el(
        'button',
        {
          class: 'chip chip-small chip-serie',
          type: 'button',
          title: `Search for ${query}`,
          'aria-label': `Search for ${query}`,
        },
        el('span', { text: name }),
      );
      chip.addEventListener('click', () => navigateToSearch(query));
      return chip;
    });
    heading.append(
      el('div', { class: 'dialog-genres dialog-series' }, ...serieChips),
    );
  }

  const comments = renderDialogComments(album.comments ?? []);
  if (comments) heading.append(comments);

  const query = state.q.trim();
  const matchedCount = tracks
    ? tracks.tracks.filter((track) => track.matches).length
    : 0;
  const allTracksMatch =
    tracks !== null && matchedCount === tracks.tracks.length;
  const showAllTracks =
    tracks === null || state.dialogShowAllTracks || allTracksMatch;

  if (tracks && query && !allTracksMatch) {
    const modeButton = (showAll: boolean, label: string) => {
      const button = el('button', {
        class: 'track-filter-option',
        type: 'button',
        'aria-pressed': String(state.dialogShowAllTracks === showAll),
        text: label,
      });
      if (state.dialogShowAllTracks === showAll) {
        button.classList.add('is-active');
      }
      button.addEventListener('click', () => {
        if (state.dialogShowAllTracks === showAll) return;
        state.dialogShowAllTracks = showAll;
        renderDialog(
          album,
          tracks,
          loading,
          error,
          false,
          artworkAvailable,
        );
        dialog
          .querySelector<HTMLButtonElement>('.track-filter-option.is-active')
          ?.focus();
      });
      return button;
    };

    heading.append(
      el(
        'div',
        {
          class: 'dialog-track-filter',
          role: 'group',
          'aria-label': 'Track filter',
        },
        modeButton(false, 'Matching tracks'),
        modeButton(true, 'Show all'),
      ),
    );
    heading.append(
      el('p', {
        class: 'dialog-track-summary',
        text: state.dialogShowAllTracks
          ? `Showing all ${tracks.tracks.length} tracks (${matchedCount} match)`
          : `Showing ${matchedCount} of ${tracks.tracks.length} tracks matching this search`,
      }),
    );
  }

  const actions: HTMLElement[] = [];
  const playQuery = query && !showAllTracks ? query : null;
  if (
    state.playbackEnabled &&
    state.session.authenticated &&
    (!playQuery || matchedCount > 0)
  ) {
    const playUrl = `/play/${encodeURIComponent(album.key)}${
      playQuery ? `?q=${encodeURIComponent(playQuery)}` : ''
    }`;
    actions.push(
      el(
        'a',
        {
          class: 'dialog-play',
          href: playUrl,
          target: '_blank',
          rel: 'noopener',
        },
        el('span', { 'aria-hidden': 'true', text: '▶' }),
        el('span', {
          text: 'Play in Audio Station',
        }),
      ),
    );
  }

  if (artworkAvailable) {
    actions.push(
      el(
        'a',
        {
          class: 'dialog-artwork',
          href: `/api/albums/${encodeURIComponent(album.key)}/artwork`,
          target: '_blank',
          rel: 'noopener',
          title: 'Open the album artwork PDF',
        },
        el('span', { 'aria-hidden': 'true', text: '▤' }),
        el('span', { text: 'Artwork' }),
      ),
    );
  }

  if (actions.length > 0) {
    heading.append(el('div', { class: 'dialog-actions' }, ...actions));
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
    const visibleTracks = showAllTracks
      ? tracks.tracks
      : tracks.tracks.filter((track) => track.matches);
    body.append(
      renderTrackGroups(
        { ...tracks, tracks: visibleTracks },
        query && !showAllTracks
          ? 'No tracks in this album match this search.'
          : undefined,
      ),
    );
  }

  dialog.replaceChildren(el('div', { class: 'dialog-inner' }, header, body));
  if (dialog.open && focusClose) closeButton.focus();
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

function renderTrackGroups(
  response: TracksResponse,
  emptyMessage = 'No tracks found for this album.',
): HTMLElement {
  const { album, sourceAlbums, tracks } = response;
  if (tracks.length === 0) {
    return el('p', { class: 'dialog-status', text: emptyMessage });
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

function normalizedMetadata(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function renderTrackRow(track: Track): HTMLElement {
  const titleRow: Array<Node | string> = [];
  if (state.playbackEnabled && state.session.authenticated) {
    titleRow.push(
      el(
        'a',
        {
          class: 'track-play',
          href: `/play/track/${track.id}`,
          target: '_blank',
          rel: 'noopener',
          title: `Play ${track.title} in Audio Station`,
          'aria-label': `Play ${track.title} in Audio Station`,
        },
        el('span', { class: 'play-icon', 'aria-hidden': 'true' }),
      ),
    );
  }
  titleRow.push(
    el('span', { class: 'track-title', text: track.title }),
  );

  const main = el(
    'div',
    { class: 'track-main' },
    el('span', { class: 'track-title-row' }, ...titleRow),
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

  const composer = track.composer?.trim();
  if (
    composer &&
    normalizedMetadata(composer) !== normalizedMetadata(track.artist) &&
    normalizedMetadata(composer) !== normalizedMetadata(track.albumArtist)
  ) {
    const segments = artistSegments(composer, track.composers);
    const composerNodes: Array<Node | string> = segments
      ? segments.map((segment) =>
          segment.name
            ? createSearchButton(
                segment.name,
                'composer-link link-inline',
                segment.text,
                composerQueryFor(segment.name),
              )
            : segment.text,
        )
      : [
          createSearchButton(
            composer,
            'composer-link link-inline',
            composer,
            composerQueryFor(composer),
          ),
        ];

    main.append(
      el(
        'span',
        { class: 'track-sub track-composer' },
        el('span', { class: 'track-role', text: 'Composer' }),
        ' ',
        el(
          'span',
          { class: 'track-composer-name', title: composer },
          ...composerNodes,
        ),
      ),
    );
  }

  return el(
    'li',
    { class: 'track-row' },
    el('span', {
      class: 'track-number',
      text: track.track === null ? '—' : String(track.track),
    }),
    main,
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

function renderTrackSkeletons(count = SKELETON_COUNT): void {
  if (count === 0) {
    trackList.replaceChildren();
    trackList.removeAttribute('aria-busy');
    return;
  }

  trackList.setAttribute('aria-busy', 'true');
  const rows = Array.from({ length: count }, () =>
    el(
      'li',
      { class: 'track-result skeleton-track', 'aria-hidden': 'true' },
      el('div', { class: 'skeleton-cover skeleton-thumb' }),
      el(
        'div',
        { class: 'skeleton-lines' },
        el('div', { class: 'skeleton-line skeleton-line-lg' }),
        el('div', { class: 'skeleton-line skeleton-line-sm' }),
      ),
    ),
  );
  trackList.replaceChildren(...rows);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function applySearchValue(value: string, mode: 'live' | 'commit'): void {
  const trimmed = value.trim();
  if (trimmed === state.q) {
    if (mode === 'commit') searchSessionActive = false;
    return;
  }

  state.q = trimmed;
  syncSelectionsFromQuery();

  if (mode === 'commit') {
    // Replace the transient live entry; otherwise start a new entry.
    if (searchSessionActive) syncUrl();
    else pushFilterState();
    searchSessionActive = false;
  } else if (searchSessionActive) {
    syncUrl();
  } else {
    searchSessionActive = pushFilterState();
  }

  renderFacets();
  renderRegions();
  renderSeries();
  renderActiveFilters();
  void loadResults(true);
}

function applySearch(): void {
  window.clearTimeout(searchTimer);
  applySearchValue(searchInput.value, 'live');
}

/** Enter/blur: apply pending text immediately and close the live session. */
function commitSearch(): void {
  window.clearTimeout(searchTimer);
  applySearchValue(searchInput.value, 'commit');
}

function bindEvents(): void {
  window.addEventListener('popstate', handlePopState);
  setAllFacetsCollapsed(true);
  for (const disclosure of facetDisclosures) {
    disclosure.toggle.addEventListener('click', () => {
      const currentlyExpanded =
        disclosure.toggle.getAttribute('aria-expanded') === 'true';
      setFacetCollapsed(disclosure, currentlyExpanded);
    });
  }

  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSearch();
    }
  });
  searchInput.addEventListener('blur', commitSearch);

  sortSelect.addEventListener('change', () => {
    if (!isSortKey(sortSelect.value) || sortSelect.value === state.sort) return;
    state.sort = sortSelect.value;
    pushFilterState();
    void loadResults(true);
  });

  modeAlbumsButton.addEventListener('click', () => setSearchMode('albums'));
  modeTracksButton.addEventListener('click', () => setSearchMode('tracks'));

  genreSearch.addEventListener('input', () => {
    state.genreQuery = genreSearch.value;
    renderFacets();
  });

  regionSearch.addEventListener('input', () => {
    state.regionQuery = regionSearch.value;
    renderRegions();
  });

  serieSearch.addEventListener('input', () => {
    state.serieQuery = serieSearch.value;
    renderSeries();
  });

  clearSerieButton.addEventListener('click', clearSerie);

  const hasFacetSelection = (): boolean =>
    state.selectedGenres.length > 0 ||
    state.selectedRegions.length > 0 ||
    state.selectedSeries.length > 0;

  for (const input of genreModeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || !isFilterMode(input.value)) return;
      state.genreMode = input.value;
      if (hasFacetSelection()) applyFacetSelection();
      else renderModeControls();
    });
  }

  for (const input of regionModeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked || !isFilterMode(input.value)) return;
      state.regionMode = input.value;
      if (hasFacetSelection()) applyFacetSelection();
      else renderModeControls();
    });
  }

  clearGenresButton.addEventListener('click', () => {
    if (state.selectedGenres.length === 0 && state.genreMode === 'any') {
      return;
    }
    state.selectedGenres = [];
    state.genreMode = 'any';
    applyFacetSelection();
  });

  clearRegionsButton.addEventListener('click', () => {
    if (state.selectedRegions.length === 0 && state.regionMode === 'any') {
      return;
    }
    state.selectedRegions = [];
    state.regionMode = 'any';
    applyFacetSelection();
  });

  toggleAllButton.addEventListener('click', () => {
    state.genreExpanded = !state.genreExpanded;
    renderFacets();
  });

  toggleAllRegionsButton.addEventListener('click', () => {
    state.regionExpanded = !state.regionExpanded;
    renderRegions();
  });

  toggleAllSeriesButton.addEventListener('click', () => {
    state.serieExpanded = !state.serieExpanded;
    renderSeries();
  });

  serieList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== 'checkbox') return;
    const key = target.dataset.serieKey;
    if (!key) return;
    const facet = state.seriesFacets.find((serie) => serie.key === key);
    if (facet) setSerieSelected(facet.name, target.checked);
  });

  genreList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.dataset.genreKey;
    if (!key) return;
    const facet = state.facetByKey.get(key);
    if (facet) setGenreSelected(facet.name, target.checked);
  });

  regionList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.dataset.regionKey;
    if (!key) return;
    const facet = state.regionByKey.get(key);
    if (facet) setRegionSelected(facet.name, target.checked);
  });

  activeFilters.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const removeGenre = target.closest<HTMLElement>('[data-remove-genre]');
    if (removeGenre) {
      const name = removeGenre.dataset.removeGenre;
      if (name) setGenreSelected(name, false);
      return;
    }

    const removeRegion = target.closest<HTMLElement>('[data-remove-region]');
    if (removeRegion) {
      const name = removeRegion.dataset.removeRegion;
      if (name) setRegionSelected(name, false);
      return;
    }

    const removeSerie = target.closest<HTMLElement>('[data-remove-serie]');
    if (removeSerie) {
      const name = removeSerie.dataset.removeSerie;
      if (name) setSerieSelected(name, false);
      return;
    }

    if (target.closest('[data-remove-query]')) {
      state.q = '';
      searchInput.value = '';
      syncSelectionsFromQuery();
      pushFilterState();
      renderFacets();
      renderRegions();
      renderSeries();
      renderActiveFilters();
      void loadResults(true);
      return;
    }

    if (target.closest('[data-clear-filters]')) clearFilters();
  });

  loadMoreButton.addEventListener('click', () => void loadResults(false));

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

  searchHelpButton.addEventListener('click', () => {
    if (!searchHelpDialog.open) searchHelpDialog.showModal();
  });
  searchHelpClose.addEventListener('click', () => searchHelpDialog.close());
  searchHelpDialog.addEventListener('click', (event) => {
    const target = event.target;
    if (target === searchHelpDialog) {
      searchHelpDialog.close();
      return;
    }
    if (!(target instanceof Element)) return;
    const example = target.closest<HTMLElement>('[data-search-example]');
    const query = example?.dataset.searchExample;
    if (!query) return;
    searchHelpDialog.close();
    navigateToSearch(query);
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
    if (suppressDialogCloseHistory) {
      suppressDialogCloseHistory = false;
      return;
    }
    // Opening an album pushes a history entry; closing it by any UI gesture
    // consumes that entry so Back continues from the previous app state.
    if (albumFromHistoryState()) {
      history.back();
    }
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

  // A reload keeps history.state, so restore a dialog that was open when the
  // page was refreshed.
  const album = albumFromHistoryState();
  if (album && state.libraryReady) {
    void openAlbum(album, { recordHistory: false });
  }
}

renderViewSwitch();
readUrlState();
lastSyncedUrl = currentUrl();
bindEvents();
void boot();
