/**
 * Fields recognized by the search expression parser.
 *
 * Shared by the server-side parser and the client-side search dialog so the
 * operator summary shown to users cannot drift from what the parser accepts.
 */
export const SEARCH_FIELDS = [
  'all',
  'album',
  'artist',
  'track',
  'genre',
  'region',
  'serie',
  'source',
  'composer',
] as const;

export type SearchField = (typeof SEARCH_FIELDS)[number];
