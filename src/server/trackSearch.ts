import { parseArtists } from './artists.js';
import type { TrackRow } from './db.js';
import { foldSearch, searchTokens } from './search.js';
import {
  parseSearchQuery,
  type SearchField,
  type SearchNode,
} from './searchQuery.js';

type TrackFields = Record<SearchField, string>;

// eslint-disable-next-line no-control-regex -- control characters are the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function legacySearchNode(input: string): SearchNode | null {
  let node: SearchNode | null = null;
  for (const token of searchTokens(input)) {
    const term: SearchNode = {
      kind: 'term',
      field: 'all',
      value: token,
      quoted: false,
    };
    node = node
      ? { kind: 'and', left: node, right: term }
      : term;
  }
  return node;
}

function trackFields(track: TrackRow, album: string): TrackFields {
  const source = track.source_album ?? '(Unknown Album)';
  const albumArtists = parseArtists(track.album_artist);
  const trackArtists = parseArtists(track.artist);
  const allArtists = [
    track.album_artist,
    ...albumArtists,
    track.artist ?? '',
    ...trackArtists,
  ].join(' ');
  const albumText = [album, source].join(' ');
  const composer = track.composer ?? '';

  return {
    all: foldSearch([albumText, allArtists, composer].join(' ')),
    album: foldSearch(albumText),
    artist: foldSearch(allArtists),
    source: foldSearch(source),
    trackartist: foldSearch(
      [track.artist ?? '', ...trackArtists].join(' '),
    ),
    composer: foldSearch(composer),
  };
}

function matchesNode(node: SearchNode, fields: TrackFields): boolean {
  switch (node.kind) {
    case 'term': {
      const value = foldSearch(node.value).trim();
      if (!value || CONTROL_CHARS.test(value)) return false;
      return fields[node.field].includes(value);
    }
    case 'and':
      return matchesNode(node.left, fields) && matchesNode(node.right, fields);
    case 'or':
      return matchesNode(node.left, fields) || matchesNode(node.right, fields);
  }
}

/**
 * Build a predicate for track-level search. The query uses the same parser and
 * folding as the album index; each track is evaluated independently so fielded
 * searches such as `composer:beatles` narrow the track list.
 */
export function createTrackMatcher(
  album: string,
  query: string,
): (track: TrackRow) => boolean {
  const trimmed = query.trim();
  if (!trimmed) return () => true;

  const node = parseSearchQuery(query) ?? legacySearchNode(trimmed);
  if (!node) return () => true;

  return (track) => matchesNode(node, trackFields(track, album));
}
