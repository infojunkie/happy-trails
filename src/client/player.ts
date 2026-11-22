import { unsupportedFormatBadge } from './badges.js';
import { createCover } from './cover.js';
import { $, el } from './dom.js';
import { openCoverLightbox } from './lightbox.js';
import {
  commitPage,
  isStoredQueueSource,
  planRefill,
  QUEUE_REFILL_THRESHOLD,
  QUEUE_WINDOW_SIZE,
  type QueueSourceDescriptor,
  type QueueSourceState,
} from './queueSource.js';

/** One queue entry. `musicId` is the id consumed by `/api/stream/:id`. */
export interface PlayerTrack {
  musicId: number;
  title: string;
  /** Visible track artist (falls back to the album artist upstream). */
  artist: string;
  album: string;
  albumKey: string;
  duration: number | null;
  /** False when the browser cannot play this track's format natively. */
  playable: boolean;
}

interface QueueItem extends PlayerTrack {
  /** Stable within the page; survives reorder/removal. */
  uid: number;
}

/** One page fetched for a Play all source. */
export interface QueuePage {
  tracks: PlayerTrack[];
  total: number;
  libraryVersion: number;
}

export type QueuePageFetcher = (
  descriptor: QueueSourceDescriptor,
  offset: number,
  limit: number,
  signal: AbortSignal,
) => Promise<QueuePage>;

interface PlayerConfig {
  nativeEnabled: boolean;
  fallbackEnabled: boolean;
  /** Hold a screen wake lock while playing, when the browser allows it. */
  screenWakeLockEnabled: boolean;
  /** The footer (including its transport controls) is only shown signed in. */
  signedIn: boolean;
  queueWindowSize: number;
  queueRefillThreshold: number;
  fetchQueuePage: QueuePageFetcher | null;
  /** Lets the app invalidate a pending Play all start when the queue clears. */
  onQueueCleared: () => void;
  /**
   * Returns true when a stream request may be made. When it returns false the
   * caller is expected to open the sign-in dialog and resume later.
   */
  ensureAuthenticated: () => boolean;
}

type PlaybackMode =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

/** Older stored queues predate the `playable` flag. */
interface StoredPlayerTrack extends Omit<PlayerTrack, 'playable'> {
  playable?: boolean;
}

interface StoredPlayerState {
  version: 1;
  queue: StoredPlayerTrack[];
  currentIndex: number;
  position: number;
  /** Present when the queue came from a Play all source. */
  source?: QueueSourceState;
}

const STORAGE_KEY = 'happy-trails.player';
const VOLUME_KEY = 'happy-trails.player-volume';
const MUTE_KEY = 'happy-trails.player-muted';
const STORAGE_VERSION = 1;
const SAVE_INTERVAL_MS = 5_000;
const SKIP_DELAY_MS = 700;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

function isStoredState(value: unknown): value is StoredPlayerState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== STORAGE_VERSION) return false;
  if (!Array.isArray(record.queue) || record.queue.length === 0) return false;
  if (typeof record.currentIndex !== 'number') return false;
  if (typeof record.position !== 'number') return false;
  if (
    record.source !== undefined &&
    !isStoredQueueSource(record.source)
  ) {
    return false;
  }

  return record.queue.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const track = item as Record<string, unknown>;
    return (
      typeof track.musicId === 'number' &&
      Number.isSafeInteger(track.musicId) &&
      track.musicId > 0 &&
      typeof track.title === 'string' &&
      typeof track.artist === 'string' &&
      typeof track.album === 'string' &&
      typeof track.albumKey === 'string' &&
      (track.duration === null || typeof track.duration === 'number') &&
      (track.playable === undefined || typeof track.playable === 'boolean')
    );
  });
}

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}

function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

const footer = $<HTMLElement>('#player');
const coverHost = $('#player-cover');
const titleEl = $('#player-title');
const subtitleEl = $('#player-subtitle');
const toggleButton = $<HTMLButtonElement>('#player-toggle');
const restartButton = $<HTMLButtonElement>('#player-restart');
const previousButton = $<HTMLButtonElement>('#player-previous');
const nextButton = $<HTMLButtonElement>('#player-next');
const elapsedEl = $('#player-elapsed');
const remainingEl = $('#player-remaining');
const seekInput = $<HTMLInputElement>('#player-seek');
const muteButton = $<HTMLButtonElement>('#player-mute');
const volumeInput = $<HTMLInputElement>('#player-volume');
const errorEl = $<HTMLElement>('#player-error');
const queueToggle = $<HTMLButtonElement>('#player-queue-toggle');
const queueCountEl = $('#player-queue-count');
const queuePanel = $<HTMLElement>('#player-queue-panel');
const queueList = $<HTMLOListElement>('#player-queue-list');
const queueEmpty = $('#player-queue-empty');
const queueClose = $<HTMLButtonElement>('#player-queue-close');
const clearButton = $<HTMLButtonElement>('#player-clear');
const audioHost = $('#player-audio');

class Player {
  private queue: QueueItem[] = [];
  private currentUid: number | null = null;
  private uidSequence = 0;
  private readonly audios: [HTMLAudioElement, HTMLAudioElement];
  private currentSlot: 0 | 1 = 0;
  private mode: PlaybackMode = 'idle';
  private buffering = false;
  private error: string | null = null;
  private generation = 0;
  private preloadedUid: number | null = null;
  private restorePosition = 0;
  private consecutiveErrors = 0;
  private handlingError = false;
  private seeking = false;
  private pendingSeek: number | null = null;
  private dragUid: number | null = null;
  private volume = 1;
  private muted = false;
  private lastVolume = 1;
  private lastPositionSyncAt = 0;
  private source: QueueSourceState | null = null;
  private refilling = false;
  private refillAbort: AbortController | null = null;
  private refillToken = 0;
  private saveTimer: number | undefined;
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockPending = false;
  private config: PlayerConfig = {
    nativeEnabled: false,
    fallbackEnabled: false,
    screenWakeLockEnabled: false,
    signedIn: false,
    queueWindowSize: QUEUE_WINDOW_SIZE,
    queueRefillThreshold: QUEUE_REFILL_THRESHOLD,
    fetchQueuePage: null,
    onQueueCleared: () => {},
    ensureAuthenticated: () => true,
  };

  constructor() {
    this.volume = readStoredVolume();
    this.muted = readStoredMuted();
    this.lastVolume = this.volume > 0 ? this.volume : 1;

    const first = this.createAudio(0);
    const second = this.createAudio(1);
    this.audios = [first, second];
    this.markCurrentAudio();

    toggleButton.addEventListener('click', () => this.toggle());
    restartButton.addEventListener('click', () => this.restart());
    previousButton.addEventListener('click', () => this.previous());
    nextButton.addEventListener('click', () => this.next());
    coverHost.addEventListener('click', () => {
      const item = this.currentItem;
      if (item) openCoverLightbox(item.albumKey, item.album, item.artist);
    });

    muteButton.addEventListener('click', () => this.toggleMute());
    volumeInput.addEventListener('input', () => {
      this.setVolume(Number(volumeInput.value));
    });

    seekInput.addEventListener('input', () => {
      this.seeking = true;
      this.renderProgress();
    });
    seekInput.addEventListener('change', () => {
      const value = Number(seekInput.value);
      this.seeking = false;
      this.seek(value);
    });

    queueToggle.addEventListener('click', () => {
      this.setQueueOpen(queuePanel.hidden !== false);
    });
    queueClose.addEventListener('click', () => {
      this.setQueueOpen(false);
      queueToggle.focus();
    });
    clearButton.addEventListener('click', () => this.clear());

    document.addEventListener('click', (event) => {
      if (queuePanel.hidden) return;
      if (!(event.target instanceof Node)) return;
      // The queue row is rebuilt by selectItem/removeItem, so the target may be
      // detached by the time the event bubbles here. The composed path still
      // records that the click started inside this footer.
      if (event.composedPath().includes(footer)) return;
      this.setQueueOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      this.handleKeyDown(event);
    });

    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => this.syncWakeLock());
    this.saveTimer = window.setInterval(() => {
      if (this.mode === 'playing') this.save();
    }, SAVE_INTERVAL_MS);

    if ('mediaSession' in navigator) {
      const setHandler = (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler,
      ): void => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch {
          // Some browsers expose Media Session without every action.
        }
      };
      setHandler('play', () => this.play());
      setHandler('pause', () => this.pause());
      setHandler('previoustrack', () => this.previous());
      setHandler('nexttrack', () => this.next());
      setHandler('seekbackward', (details) => {
        this.seek(this.positionSeconds() - (details.seekOffset ?? 10));
      });
      setHandler('seekforward', (details) => {
        this.seek(this.positionSeconds() + (details.seekOffset ?? 10));
      });
      setHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          this.seek(details.seekTime);
        }
      });
    }

    this.renderVolume();
    this.renderAll();
  }

  /** Merge new feature flags (for example after /api/status). */
  configure(config: Partial<PlayerConfig>): void {
    this.config = { ...this.config, ...config };
    if (!this.config.nativeEnabled || !this.config.signedIn) {
      this.cancelRefill();
      this.stopAudio();
      this.mode = 'paused';
      this.clearMediaSession();
      footer.hidden = true;
      document.body.classList.remove('player-visible');
      return;
    }
    this.renderState();
  }

  /** Restore the last queue (paused) after a reload. */
  restore(): void {
    if (!this.config.nativeEnabled || this.queue.length > 0) return;

    let stored: unknown;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      return;
    }
    if (!isStoredState(stored)) return;

    this.queue = stored.queue.map((track) => ({
      ...track,
      playable: track.playable ?? true,
      uid: ++this.uidSequence,
    }));
    const index = Math.min(
      Math.max(Math.trunc(stored.currentIndex), 0),
      this.queue.length - 1,
    );
    this.currentUid = this.queue[index]?.uid ?? null;
    this.restorePosition = Number.isFinite(stored.position)
      ? Math.max(0, stored.position)
      : 0;
    this.source = stored.source ?? null;
    this.mode = 'paused';
    this.error = null;
    this.renderAll();
  }

  /** Replace the queue and start playing at `startIndex`. */
  playTracks(tracks: PlayerTrack[], startIndex = 0): void {
    this.cancelRefill();
    this.source = null;
    this.adoptQueue(tracks, startIndex);
    this.save();
    if (!this.currentItem) return;
    if (!this.guardAuth()) return;
    this.startCurrent(0, true);
  }

  /**
   * Start a lazily refilled queue from a Play all source. `tracks` is the first
   * fetched page and `source` carries the original query snapshot/cursor.
   */
  playAll(
    source: QueueSourceState,
    tracks: PlayerTrack[],
    startIndex = 0,
  ): void {
    this.cancelRefill();
    this.adoptQueue(tracks, startIndex);
    this.source = this.queue.length > 0 ? source : null;
    this.save();
    if (!this.currentItem) return;
    if (!this.guardAuth()) return;
    this.startCurrent(0, true);
  }

  play(): void {
    if (!this.currentItem) return;
    if (!this.guardAuth()) return;

    if (this.mode === 'ended') {
      this.restorePosition = 0;
      this.startCurrent(0, true);
      return;
    }

    const audio = this.currentAudio;
    if (!audio.getAttribute('src')) {
      this.startCurrent(this.restorePosition, true);
      return;
    }
    if (!audio.paused) {
      this.mode = 'playing';
      this.renderState();
      return;
    }

    this.mode = 'loading';
    this.renderState();
    void audio.play().catch((error: unknown) => {
      this.handlePlayRejection(error);
    });
  }

  pause(): void {
    this.currentAudio.pause();
    this.mode = 'paused';
    this.renderState();
    this.updatePositionState(true);
    this.save();
  }

  toggle(): void {
    if (this.mode === 'playing' || this.mode === 'loading') this.pause();
    else this.play();
  }

  restart(): void {
    const audio = this.currentAudio;
    if (!audio.getAttribute('src')) {
      this.restorePosition = 0;
      this.play();
      return;
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Seeking before metadata is available can throw; play() will load it.
    }
    this.restorePosition = 0;
    if (audio.paused) this.play();
    else {
      this.renderProgress();
      this.save();
    }
  }

  next(): void {
    if (!this.guardAuth()) return;
    const index = this.currentIndex;
    const next = index >= 0 ? this.queue[index + 1] : null;
    if (!next) return;
    this.goToUid(next.uid, this.mode === 'playing' || this.mode === 'loading');
  }

  previous(): void {
    if (!this.guardAuth()) return;
    const audio = this.currentAudio;
    if (audio.getAttribute('src') && audio.currentTime > 3) {
      this.restart();
      return;
    }
    const index = this.currentIndex;
    const previous = index > 0 ? this.queue[index - 1] : null;
    if (!previous) {
      this.restart();
      return;
    }
    this.goToUid(previous.uid, this.mode === 'playing' || this.mode === 'loading');
  }

  clear(): void {
    this.cancelRefill();
    this.source = null;
    this.stopAudio();
    this.queue = [];
    this.currentUid = null;
    this.preloadedUid = null;
    this.restorePosition = 0;
    this.error = null;
    this.buffering = false;
    this.consecutiveErrors = 0;
    this.mode = 'idle';
    this.setQueueOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable; the in-memory player still clears.
    }
    this.renderAll();
    this.config.onQueueCleared();
  }

  private cancelRefill(): void {
    this.refillToken += 1;
    this.refillAbort?.abort();
    this.refillAbort = null;
    this.refilling = false;
  }

  /**
   * Keep a Play all queue near its visible window. History is removed only
   * after a page is successfully fetched, so a failed request cannot lose
   * already-queued tracks.
   */
  private maybeRefill(): void {
    if (this.refilling || !this.source || !this.config.fetchQueuePage) return;
    if (!this.config.nativeEnabled || !this.config.signedIn) return;

    const source = this.source;
    const plan = planRefill(
      this.queue.length,
      this.currentIndex,
      source,
      this.config.queueWindowSize,
      this.config.queueRefillThreshold,
    );
    if (!plan) return;

    const token = ++this.refillToken;
    const controller = new AbortController();
    this.refilling = true;
    this.refillAbort = controller;
    const requested = plan.fetchLimit;

    void this.config
      .fetchQueuePage(
        source.descriptor,
        source.nextOffset,
        requested,
        controller.signal,
      )
      .then((page) => {
        if (token !== this.refillToken || this.source !== source) return;

        // Recompute the trim against the current item: the user may have
        // skipped ahead while the page was in flight.
        const trimCount = Math.min(
          Math.max(this.currentIndex, 0),
          this.queue.length,
        );
        if (trimCount > 0) this.queue.splice(0, trimCount);
        this.queue.push(
          ...page.tracks.map((track) => ({
            ...track,
            uid: ++this.uidSequence,
          })),
        );
        this.source = commitPage(source, {
          requested,
          received: page.tracks.length,
          total: page.total,
          libraryVersion: page.libraryVersion,
        });
        this.renderQueue();
        this.renderState();
        this.preloadNext();
        this.save();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || token !== this.refillToken) return;
        // Keep the queue and cursor intact; a later trigger retries.
        console.error('[player] could not refill the play queue:', error);
      })
      .finally(() => {
        if (token !== this.refillToken) return;
        this.refilling = false;
        this.refillAbort = null;
      });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (!queuePanel.hidden) {
        this.setQueueOpen(false);
        queueToggle.focus();
      }
      return;
    }
    if (footer.hidden) return;
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }
    if (document.querySelector('dialog[open]')) return;

    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      if (target.closest('input, textarea, select')) return;
      // Space activates the focused button or link; do not steal it.
      if (event.key === ' ' && target.closest('button, a')) return;
    }

    switch (event.key) {
      case ' ':
        if (event.repeat) return;
        event.preventDefault();
        this.toggle();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) this.previous();
        else this.seek(this.positionSeconds() - 5);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) this.next();
        else this.seek(this.positionSeconds() + 5);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.adjustVolume(0.05);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.adjustVolume(-0.05);
        break;
      case 'm':
      case 'M':
        if (event.repeat) return;
        event.preventDefault();
        this.toggleMute();
        break;
      case 'r':
      case 'R':
        if (event.repeat) return;
        event.preventDefault();
        this.restart();
        break;
    }
  }

  private setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.min(1, Math.max(0, value));
    if (this.volume > 0) {
      this.lastVolume = this.volume;
      this.muted = false;
    }
    this.applyVolume();
    this.saveVolume();
  }

  private adjustVolume(delta: number): void {
    this.setVolume(this.volume + delta);
  }

  private toggleMute(): void {
    const muted = this.muted || this.volume === 0;
    if (muted) {
      this.muted = false;
      this.volume = this.lastVolume > 0 ? this.lastVolume : 0.5;
      this.lastVolume = this.volume;
    } else {
      this.muted = true;
    }
    this.applyVolume();
    this.saveVolume();
  }

  private applyVolume(): void {
    for (const audio of this.audios) {
      audio.volume = this.volume;
      audio.muted = this.muted;
    }
    this.renderVolume();
  }

  private renderVolume(): void {
    const muted = this.muted || this.volume === 0;
    volumeInput.value = String(this.volume);
    volumeInput.setAttribute(
      'aria-valuetext',
      `${Math.round(this.volume * 100)}%`,
    );
    muteButton.textContent = muted ? '🔇' : '🔊';
    muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    muteButton.title = muted ? 'Unmute' : 'Mute';
  }

  private saveVolume(): void {
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage may be unavailable; the setting still applies in memory.
    }
  }

  private createAudio(slot: 0 | 1): HTMLAudioElement {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.volume = this.volume;
    audio.muted = this.muted;
    audio.setAttribute('playsinline', '');
    audioHost.append(audio);
    this.bindAudio(slot, audio);
    return audio;
  }

  private bindAudio(slot: 0 | 1, audio: HTMLAudioElement): void {
    audio.addEventListener('ended', () => {
      if (slot === this.currentSlot) this.handleEnded();
    });
    audio.addEventListener('error', () => {
      if (slot === this.currentSlot && audio.getAttribute('src')) {
        this.handleError();
      }
    });
    audio.addEventListener('timeupdate', () => {
      if (slot !== this.currentSlot) return;
      this.renderProgress();
      this.updatePositionState();
    });
    audio.addEventListener('seeked', () => {
      if (slot !== this.currentSlot) return;
      this.pendingSeek = null;
      this.renderProgress();
      this.updatePositionState(true);
    });
    audio.addEventListener('durationchange', () => {
      if (slot !== this.currentSlot) return;
      this.renderProgress();
      this.updatePositionState(true);
    });
    audio.addEventListener('loadedmetadata', () => {
      if (slot !== this.currentSlot) return;
      this.renderProgress();
      this.updatePositionState(true);
    });
    audio.addEventListener('waiting', () => {
      if (slot !== this.currentSlot) return;
      this.buffering = true;
      this.renderState();
    });
    audio.addEventListener('stalled', () => {
      if (slot !== this.currentSlot) return;
      this.buffering = true;
      this.renderState();
    });
    audio.addEventListener('canplay', () => {
      if (slot !== this.currentSlot) return;
      this.buffering = false;
      this.renderState();
    });
    audio.addEventListener('playing', () => {
      if (slot === this.currentSlot) this.handlePlaying();
    });
    audio.addEventListener('pause', () => {
      if (slot !== this.currentSlot) return;
      if (this.mode !== 'playing' && this.mode !== 'loading') return;
      this.mode = 'paused';
      this.renderState();
      this.save();
    });
  }

  private get currentAudio(): HTMLAudioElement {
    return this.audios[this.currentSlot];
  }

  private get standbyAudio(): HTMLAudioElement {
    return this.audios[this.currentSlot === 0 ? 1 : 0];
  }

  /** Mark the active element for tests and debugging. */
  private markCurrentAudio(): void {
    for (const [slot, audio] of this.audios.entries()) {
      if (slot === this.currentSlot) audio.dataset.playerCurrent = 'true';
      else delete audio.dataset.playerCurrent;
    }
  }

  private get currentIndex(): number {
    if (this.currentUid === null) return -1;
    return this.queue.findIndex((item) => item.uid === this.currentUid);
  }

  private get currentItem(): QueueItem | null {
    const index = this.currentIndex;
    return index >= 0 ? (this.queue[index] ?? null) : null;
  }

  private streamUrl(item: QueueItem): string {
    return `/api/stream/${encodeURIComponent(String(item.musicId))}`;
  }

  private guardAuth(): boolean {
    if (!this.config.nativeEnabled) return false;
    if (this.config.ensureAuthenticated()) return true;
    this.mode = 'paused';
    this.renderState();
    return false;
  }

  private adoptQueue(tracks: PlayerTrack[], startIndex: number): void {
    this.stopAudio();
    this.queue = tracks.map((track) => ({ ...track, uid: ++this.uidSequence }));
    const index = Math.min(
      Math.max(Math.trunc(startIndex), 0),
      Math.max(this.queue.length - 1, 0),
    );
    this.currentUid = this.queue[index]?.uid ?? null;
    this.preloadedUid = null;
    this.restorePosition = 0;
    this.error = null;
    this.buffering = false;
    this.consecutiveErrors = 0;
    this.mode = this.queue.length > 0 ? 'paused' : 'idle';
    this.renderAll();
  }

  private stopAudio(): void {
    this.releaseWakeLock();
    this.generation += 1;
    for (const audio of this.audios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.buffering = false;
  }

  private clearStandby(): void {
    const audio = this.standbyAudio;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    this.preloadedUid = null;
  }

  /**
   * Hold a screen wake lock while the player is actively playing and the page
   * is visible. This keeps Android browsers in the foreground so their media
   * session is not suspended at a track boundary. It is best-effort: browsers
   * may not support the API, may deny the request (battery saver, insecure
   * context), or release the lock when the page becomes hidden.
   */
  private shouldHoldWakeLock(): boolean {
    return (
      this.config.screenWakeLockEnabled &&
      this.config.nativeEnabled &&
      this.config.signedIn &&
      (this.mode === 'playing' || this.mode === 'loading') &&
      document.visibilityState === 'visible' &&
      'wakeLock' in navigator
    );
  }

  private syncWakeLock(): void {
    if (!this.shouldHoldWakeLock()) {
      this.releaseWakeLock();
      return;
    }
    if (this.wakeLock !== null || this.wakeLockPending) return;

    this.wakeLockPending = true;
    let pending: Promise<WakeLockSentinel>;
    try {
      pending = navigator.wakeLock.request('screen');
    } catch {
      this.wakeLockPending = false;
      return;
    }

    void pending
      .then((sentinel) => {
        this.wakeLockPending = false;
        // The player may have paused or the page may have been hidden while
        // the request was in flight; do not keep a lock nobody needs.
        if (!this.shouldHoldWakeLock()) {
          void sentinel.release().catch(() => {});
          return;
        }
        this.wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) this.wakeLock = null;
        });
      })
      .catch(() => {
        this.wakeLockPending = false;
      });
  }

  private releaseWakeLock(): void {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (sentinel) void sentinel.release().catch(() => {});
  }

  private startCurrent(position: number, autoplay: boolean): void {
    const item = this.currentItem;
    if (!item) return;

    const audio = this.currentAudio;
    const generation = ++this.generation;
    this.mode = 'loading';
    this.error = null;
    this.buffering = position > 0;
    this.renderState();

    audio.pause();
    audio.src = this.streamUrl(item);
    audio.load();

    if (position > 0) {
      let started = false;
      const begin = (): void => {
        if (started || generation !== this.generation) return;
        started = true;
        const duration = Number.isFinite(audio.duration)
          ? audio.duration
          : position;
        audio.currentTime = Math.min(
          position,
          Math.max(0, duration - 0.25),
        );
        if (autoplay) this.playCurrent();
        else this.markPaused();
      };
      audio.addEventListener('loadedmetadata', begin, { once: true });
      // Metadata should arrive quickly; do not strand the player if it does not.
      window.setTimeout(() => {
        if (generation === this.generation && audio.readyState < 1) begin();
      }, 5_000);
      this.maybeRefill();
      return;
    }

    if (autoplay) this.playCurrent();
    else this.markPaused();
    this.maybeRefill();
  }

  private playCurrent(): void {
    const audio = this.currentAudio;
    const generation = this.generation;
    this.mode = 'loading';
    this.renderState();
    void audio.play().catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.handlePlayRejection(error);
    });
  }

  private markPaused(): void {
    this.buffering = false;
    this.mode = 'paused';
    this.renderState();
  }

  private handlePlayRejection(error: unknown): void {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      this.mode = 'paused';
      this.buffering = false;
      this.renderState();
      return;
    }
    this.handleError();
  }

  private handlePlaying(): void {
    this.mode = 'playing';
    this.buffering = false;
    this.error = null;
    this.handlingError = false;
    this.consecutiveErrors = 0;
    this.renderState();
    this.preloadNext();
    this.renderProgress();
    this.updatePositionState(true);
    this.maybeRefill();
    this.save();
  }

  private handleEnded(): void {
    const index = this.currentIndex;
    const next = index >= 0 ? this.queue[index + 1] : null;
    if (next) {
      this.goToUid(next.uid, true);
      return;
    }
    this.mode = 'ended';
    this.buffering = false;
    this.renderState();
    this.renderProgress();
    this.updatePositionState(true);
    this.save();
  }

  private handleError(): void {
    if (this.handlingError) return;
    const item = this.currentItem;
    const errorCode = this.currentAudio.error?.code;
    const canSkip =
      this.consecutiveErrors + 1 < this.queue.length &&
      this.currentIndex < this.queue.length - 1;

    this.handlingError = true;
    this.buffering = false;
    this.consecutiveErrors += 1;

    if (canSkip) {
      this.error = item
        ? `Skipped “${item.title}”: this browser cannot play it.`
        : 'Skipped an unplayable track.';
      this.renderState();
      const failedUid = this.currentUid;
      window.setTimeout(() => {
        this.handlingError = false;
        if (this.currentUid !== failedUid) return;
        const index = this.currentIndex;
        const next = index >= 0 ? this.queue[index + 1] : null;
        if (next) this.goToUid(next.uid, true);
      }, SKIP_DELAY_MS);
      return;
    }

    this.mode = 'error';
    this.error =
      errorCode === 4
        ? 'This track’s format is not supported by your browser.'
        : 'This track could not be played.';
    this.renderState();
    this.save();
    window.setTimeout(() => {
      this.handlingError = false;
    }, SKIP_DELAY_MS);
  }

  private goToUid(uid: number, autoplay: boolean): void {
    const target = this.queue.find((item) => item.uid === uid);
    if (!target) return;

    this.currentAudio.pause();
    this.generation += 1;
    this.currentUid = uid;
    this.restorePosition = 0;
    const useStandby =
      this.preloadedUid === uid &&
      Boolean(this.standbyAudio.getAttribute('src'));

    if (useStandby) {
      const nextSlot = this.currentSlot === 0 ? 1 : 0;
      this.currentSlot = nextSlot;
      this.markCurrentAudio();
      this.preloadedUid = null;
      const audio = this.currentAudio;
      try {
        audio.currentTime = 0;
      } catch {
        // Metadata may not be ready yet.
      }
      this.mode = 'loading';
      this.buffering = false;
      this.renderAll();
      if (autoplay) this.playCurrent();
      else this.markPaused();
      this.maybeRefill();
      return;
    }

    this.clearStandby();
    this.mode = 'loading';
    this.renderAll();
    this.startCurrent(0, autoplay);
    this.maybeRefill();
  }

  private preloadNext(): void {
    if (!this.config.nativeEnabled) return;
    const index = this.currentIndex;
    const next = index >= 0 ? this.queue[index + 1] : null;
    if (!next) {
      if (this.preloadedUid !== null) this.clearStandby();
      return;
    }
    if (
      this.preloadedUid === next.uid &&
      this.standbyAudio.getAttribute('src')
    ) {
      return;
    }
    const audio = this.standbyAudio;
    this.preloadedUid = next.uid;
    audio.src = this.streamUrl(next);
    audio.load();
  }

  private seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const audio = this.currentAudio;
    const duration = this.durationSeconds();
    const target = Math.max(0, Math.min(seconds, Math.max(duration - 0.25, 0)));
    this.restorePosition = target;
    this.pendingSeek = target;
    if (audio.getAttribute('src')) {
      try {
        audio.currentTime = target;
      } catch {
        // The metadata listener in startCurrent will apply the position.
      }
    }
    this.renderProgress();
    this.updatePositionState(true);
    this.save();
  }

  private durationSeconds(): number {
    const audio = this.currentAudio;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }
    return this.currentItem?.duration ?? 0;
  }

  private positionSeconds(): number {
    if (this.pendingSeek !== null) return this.pendingSeek;
    const audio = this.currentAudio;
    if (audio.getAttribute('src') && Number.isFinite(audio.currentTime)) {
      return audio.currentTime;
    }
    return this.restorePosition;
  }

  private selectItem(uid: number): void {
    if (!this.guardAuth()) return;
    this.goToUid(uid, true);
  }

  private moveBy(uid: number, delta: number): void {
    const from = this.queue.findIndex((item) => item.uid === uid);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= this.queue.length) return;
    const [item] = this.queue.splice(from, 1);
    if (!item) return;
    this.queue.splice(to, 0, item);
    this.afterQueueEdit();
  }

  private moveTo(uid: number, toIndex: number): void {
    const from = this.queue.findIndex((item) => item.uid === uid);
    if (from < 0) return;
    const [item] = this.queue.splice(from, 1);
    if (!item) return;
    let target = toIndex;
    if (from < toIndex) target -= 1;
    target = Math.max(0, Math.min(target, this.queue.length));
    this.queue.splice(target, 0, item);
    this.afterQueueEdit();
  }

  private afterQueueEdit(): void {
    this.renderQueue();
    this.renderState();
    this.preloadNext();
    this.maybeRefill();
    this.save();
  }

  private removeItem(uid: number): void {
    const index = this.queue.findIndex((item) => item.uid === uid);
    if (index < 0) return;

    const wasCurrent = this.currentUid === uid;
    const wasPreloaded = this.preloadedUid === uid;
    this.queue.splice(index, 1);

    if (this.queue.length === 0) {
      this.clear();
      return;
    }

    if (wasCurrent) {
      const autoplay =
        this.mode === 'playing' || this.mode === 'loading';
      const replacement = this.queue[Math.min(index, this.queue.length - 1)];
      if (!replacement) {
        this.clear();
        return;
      }
      const wasLast = index >= this.queue.length;
      this.clearStandby();
      this.currentUid = replacement.uid;
      this.restorePosition = 0;
      this.goToUid(replacement.uid, autoplay && !wasLast);
      return;
    }

    if (wasPreloaded) this.clearStandby();
    this.afterQueueEdit();
  }

  private setQueueOpen(open: boolean): void {
    queuePanel.hidden = !open;
    queueToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      this.renderQueue();
      queuePanel.focus();
    }
  }

  private save(): void {
    if (!this.config.nativeEnabled) return;
    try {
      if (this.queue.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const position = this.positionSeconds();
      const data: StoredPlayerState = {
        version: STORAGE_VERSION,
        queue: this.queue.map((item) => ({
          musicId: item.musicId,
          title: item.title,
          artist: item.artist,
          album: item.album,
          albumKey: item.albumKey,
          duration: item.duration,
          playable: item.playable,
        })),
        currentIndex: Math.max(this.currentIndex, 0),
        position: Number.isFinite(position) ? position : 0,
        ...(this.source ? { source: this.source } : {}),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage may be unavailable; playback still works.
    }
  }

  private renderAll(): void {
    this.renderTrack();
    this.renderQueue();
    this.renderState();
    this.renderProgress();
  }

  private renderTrack(): void {
    const item = this.currentItem;
    if (!item) {
      coverHost.replaceChildren();
      coverHost.setAttribute('aria-label', 'View cover');
      titleEl.textContent = 'Nothing playing';
      subtitleEl.textContent = '';
      this.updateMediaSession();
      return;
    }
    coverHost.replaceChildren(
      createCover({ key: item.albumKey, album: item.album }, 'cover-player'),
    );
    coverHost.setAttribute(
      'aria-label',
      item.artist
        ? `View cover for ${item.album} by ${item.artist}`
        : `View cover for ${item.album}`,
    );
    titleEl.textContent = item.title;
    titleEl.title = item.title;
    subtitleEl.textContent = [item.artist, item.album]
      .filter((value) => value.trim().length > 0)
      .join(' · ');
    subtitleEl.title = subtitleEl.textContent;
    this.updateMediaSession();
    this.updatePositionState(true);
  }

  private coverUrl(item: QueueItem): string {
    return new URL(
      `/api/albums/${encodeURIComponent(item.albumKey)}/cover`,
      window.location.href,
    ).toString();
  }

  private updateMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    if (!this.config.nativeEnabled || !this.config.signedIn) {
      this.clearMediaSession();
      return;
    }
    const item = this.currentItem;
    if (!item) {
      this.clearMediaSession();
      return;
    }
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title,
        artist: item.artist,
        album: item.album,
        artwork: [{ src: this.coverUrl(item), sizes: '512x512' }],
      });
    }
    navigator.mediaSession.playbackState =
      this.mode === 'playing' || this.mode === 'loading'
        ? 'playing'
        : 'paused';
  }

  private clearMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    this.clearPositionState();
  }

  private clearPositionState(): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (typeof session.setPositionState !== 'function') return;
    try {
      session.setPositionState();
    } catch {
      // The browser may not support clearing position state.
    }
  }

  /**
   * Keep the OS media UI's timeline in sync with the in-page player. The
   * in-page progress bar does not depend on this; it is for lock screens,
   * notifications, and hardware/car media controls.
   */
  private updatePositionState(force = false): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (typeof session.setPositionState !== 'function') return;
    if (!this.config.nativeEnabled || !this.config.signedIn) {
      this.clearPositionState();
      return;
    }

    const item = this.currentItem;
    if (!item) {
      this.clearPositionState();
      return;
    }
    const duration = this.durationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) {
      this.clearPositionState();
      return;
    }
    const rawPosition = this.positionSeconds();
    const position = Math.min(
      Math.max(Number.isFinite(rawPosition) ? rawPosition : 0, 0),
      duration,
    );
    const now = Date.now();
    if (!force && now - this.lastPositionSyncAt < 1_000) return;
    this.lastPositionSyncAt = now;

    const rate = this.currentAudio.playbackRate;
    try {
      session.setPositionState({
        duration,
        playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        position,
      });
    } catch {
      // Duration can be transiently invalid while a stream settles.
    }
  }

  private renderQueue(): void {
    const rows: HTMLElement[] = [];
    for (const [index, item] of this.queue.entries()) {
      const isCurrent = item.uid === this.currentUid;
      const isNext =
        this.currentIndex >= 0 && index === this.currentIndex + 1;

      const playButton = el(
        'button',
        {
          class: 'player-queue-track',
          type: 'button',
          title: `Play ${item.title}`,
          'aria-label': `Play ${item.title}`,
        },
        el(
          'span',
          { class: 'player-queue-title-line' },
          el('span', {
            class: 'player-queue-title',
            text: item.title,
          }),
          ...(item.playable ? [] : [unsupportedFormatBadge()]),
        ),
        el('span', {
          class: 'player-queue-artist',
          text: [item.artist, item.album].filter(Boolean).join(' · '),
        }),
      );
      playButton.addEventListener('click', () => this.selectItem(item.uid));

      const up = el('button', {
        class: 'player-queue-move',
        type: 'button',
        text: '▲',
        title: 'Move up',
        'aria-label': `Move ${item.title} up`,
        disabled: index === 0,
      });
      up.addEventListener('click', (event) => {
        event.stopPropagation();
        this.moveBy(item.uid, -1);
      });

      const down = el('button', {
        class: 'player-queue-move',
        type: 'button',
        text: '▼',
        title: 'Move down',
        'aria-label': `Move ${item.title} down`,
        disabled: index === this.queue.length - 1,
      });
      down.addEventListener('click', (event) => {
        event.stopPropagation();
        this.moveBy(item.uid, 1);
      });

      const remove = el('button', {
        class: 'player-queue-remove',
        type: 'button',
        text: '✕',
        title: 'Remove from queue',
        'aria-label': `Remove ${item.title} from the queue`,
      });
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeItem(item.uid);
      });

      const row = el(
        'li',
        {
          class: [
            'player-queue-item',
            isCurrent ? 'is-current' : '',
            isNext ? 'is-next' : '',
          ]
            .filter(Boolean)
            .join(' '),
          draggable: 'true',
          ...(isCurrent ? { 'aria-current': 'true' } : {}),
        },
        el('span', { class: 'player-queue-index', text: String(index + 1) }),
        playButton,
        el('span', {
          class: 'player-queue-duration',
          text:
            item.duration === null ? '—' : formatTime(item.duration),
        }),
        el(
          'span',
          { class: 'player-queue-actions' },
          up,
          down,
          remove,
        ),
      );

      row.addEventListener('dragstart', (event) => {
        this.dragUid = item.uid;
        row.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(item.uid));
        }
      });
      row.addEventListener('dragend', () => {
        this.dragUid = null;
        row.classList.remove('is-dragging');
        this.renderQueue();
      });
      row.addEventListener('dragover', (event) => {
        if (this.dragUid === null) return;
        event.preventDefault();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        const uid = this.dragUid;
        this.dragUid = null;
        if (uid !== null) this.moveTo(uid, index);
      });

      rows.push(row);
    }

    queueList.replaceChildren(...rows);
    queueEmpty.hidden = rows.length > 0;
    clearButton.disabled = rows.length === 0;
    queueCountEl.textContent = String(rows.length);
  }

  private renderState(): void {
    const visible =
      this.config.nativeEnabled &&
      this.config.signedIn &&
      this.queue.length > 0;
    this.syncWakeLock();
    footer.hidden = !visible;
    document.body.classList.toggle('player-visible', visible);
    if (!visible) return;

    const playing = this.mode === 'playing' || this.mode === 'loading';
    toggleButton.textContent = playing ? '❚❚' : '▶';
    toggleButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    toggleButton.title = playing ? 'Pause' : 'Play';
    toggleButton.disabled = !this.currentItem;
    restartButton.disabled = !this.currentItem;
    previousButton.disabled = !this.currentItem;
    nextButton.disabled =
      this.currentIndex < 0 || this.currentIndex >= this.queue.length - 1;
    footer.classList.toggle('is-buffering', this.buffering);
    restartButton.title = 'Restart track';
    this.updateMediaSession();

    errorEl.hidden = this.error === null;
    if (this.error) {
      errorEl.replaceChildren(document.createTextNode(this.error));
      const item = this.currentItem;
      if (this.config.fallbackEnabled && item) {
        errorEl.append(
          ' ',
          el('a', {
            href: `/play/track/${encodeURIComponent(String(item.musicId))}`,
            target: '_blank',
            rel: 'noopener',
            text: 'Open in Audio Station',
          }),
        );
      }
    }
  }

  private renderProgress(): void {
    const item = this.currentItem;
    const duration = item ? this.durationSeconds() : 0;
    const position = item
      ? this.seeking
        ? Number(seekInput.value)
        : this.positionSeconds()
      : 0;

    seekInput.max = String(Math.max(duration, 0.1));
    seekInput.step = '0.1';
    seekInput.disabled = !item || duration <= 0;
    if (!this.seeking) seekInput.value = String(Math.max(0, position));

    elapsedEl.textContent = formatTime(Math.max(0, position));
    remainingEl.textContent =
      duration > 0
        ? `-${formatTime(Math.max(0, duration - position))}`
        : '—';
    seekInput.setAttribute(
      'aria-valuetext',
      `${formatTime(Math.max(0, position))} of ${formatTime(duration)}`,
    );
  }
}

export const player = new Player();
