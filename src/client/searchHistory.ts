/**
 * Pure helpers for the search dialog's recent-query history. Storage access is
 * left to the caller so a denied/throwing localStorage can fall back to an
 * in-memory list.
 */

/** localStorage key holding a JSON array of queries, newest first. */
export const SEARCH_HISTORY_KEY = 'happy-trails.search-history';

/** Matches the server's maximum search-expression length. */
export const MAX_SEARCH_HISTORY_QUERY_LENGTH = 200;

function normalizeQuery(query: string): string | null {
  const trimmed = query.trim().slice(0, MAX_SEARCH_HISTORY_QUERY_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeHistory(values: readonly unknown[], limit: number): string[] {
  if (limit <= 0) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = normalizeQuery(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

/** Parse stored JSON, keeping at most `limit` sanitized entries. */
export function parseSearchHistory(
  raw: string | null,
  limit: number,
): string[] {
  if (!raw || limit <= 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? sanitizeHistory(parsed, limit) : [];
}

/**
 * Put `query` at the front, removing case-insensitive duplicates and capping
 * the list at `limit`. Empty queries leave the existing list unchanged.
 */
export function rememberSearch(
  history: readonly string[],
  query: string,
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const normalized = normalizeQuery(query);
  if (!normalized) return sanitizeHistory(history, limit);

  const key = normalized.toLowerCase();
  return [
    normalized,
    ...sanitizeHistory(history, limit).filter(
      (entry) => entry.toLowerCase() !== key,
    ),
  ].slice(0, limit);
}
