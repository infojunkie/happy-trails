import {
  isSortKey,
  type PlaybackTrackMode,
  type SortKey,
} from '../shared/types.js';

/** Visible queue size, matching the existing Load-more page size. */
export const QUEUE_WINDOW_SIZE = 48;
/** Refill when fewer than this many tracks remain after the current one. */
export const QUEUE_REFILL_THRESHOLD = 12;

/** The query snapshot that owns a Play all queue. */
export interface QueueSourceDescriptor {
  mode: PlaybackTrackMode;
  q: string;
  sort: SortKey;
}

/** Serializable cursor for one Play all source. */
export interface QueueSourceState {
  descriptor: QueueSourceDescriptor;
  /** Number of source tracks already fetched into the queue. */
  nextOffset: number;
  total: number;
  libraryVersion: number;
  exhausted: boolean;
}

export interface QueueRefillPlan {
  /** Items before the current track that can be removed at commit time. */
  trimCount: number;
  /** Number of tracks to fetch from the source cursor. */
  fetchLimit: number;
}

export interface QueuePageSummary {
  requested: number;
  received: number;
  total: number;
  libraryVersion: number;
}

/** Build the initial source state from the first Play all page. */
export function createQueueSource(
  descriptor: QueueSourceDescriptor,
  page: QueuePageSummary,
): QueueSourceState {
  return {
    descriptor,
    nextOffset: page.received,
    total: Math.max(page.total, page.received),
    libraryVersion: page.libraryVersion,
    exhausted:
      page.received === 0 ||
      page.received < page.requested ||
      page.received >= page.total,
  };
}

/**
 * Decide whether the visible window needs more tracks.
 *
 * The current track stays at its index until a refill commits. At that point
 * the `trimCount` tracks before it are removed, and `fetchLimit` new tracks are
 * appended so the visible queue returns to `windowSize` (unless the source
 * runs out).
 */
export function planRefill(
  queueLength: number,
  currentIndex: number,
  source: QueueSourceState | null,
  windowSize = QUEUE_WINDOW_SIZE,
  threshold = QUEUE_REFILL_THRESHOLD,
): QueueRefillPlan | null {
  if (!source || source.exhausted) return null;
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) {
    return null;
  }

  const trimCount = currentIndex;
  const remaining = queueLength - trimCount; // current + upcoming
  if (remaining > windowSize) return null;

  const upcoming = remaining - 1;
  if (upcoming >= threshold) return null;

  return {
    trimCount,
    fetchLimit: Math.max(1, windowSize - remaining),
  };
}

/** Advance the source cursor after a page is committed to the queue. */
export function commitPage(
  source: QueueSourceState,
  page: QueuePageSummary,
): QueueSourceState {
  const nextOffset = source.nextOffset + page.received;
  const total = Math.max(page.total, nextOffset);
  return {
    ...source,
    nextOffset,
    total,
    libraryVersion: page.libraryVersion,
    exhausted:
      page.received === 0 ||
      page.received < page.requested ||
      nextOffset >= total,
  };
}

/** Validate a source read back from localStorage; invalid sources are ignored. */
export function isStoredQueueSource(
  value: unknown,
): value is QueueSourceState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.descriptor !== 'object' || record.descriptor === null) {
    return false;
  }
  const descriptor = record.descriptor as Record<string, unknown>;
  if (descriptor.mode !== 'albums' && descriptor.mode !== 'tracks') {
    return false;
  }
  if (typeof descriptor.q !== 'string') return false;
  if (!isSortKey(descriptor.sort)) return false;
  if (
    typeof record.nextOffset !== 'number' ||
    !Number.isSafeInteger(record.nextOffset) ||
    record.nextOffset < 0
  ) {
    return false;
  }
  if (
    typeof record.total !== 'number' ||
    !Number.isSafeInteger(record.total) ||
    record.total < 0
  ) {
    return false;
  }
  if (
    typeof record.libraryVersion !== 'number' ||
    !Number.isSafeInteger(record.libraryVersion) ||
    record.libraryVersion < 0
  ) {
    return false;
  }
  return typeof record.exhausted === 'boolean';
}
